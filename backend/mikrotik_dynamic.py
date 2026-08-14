"""Dynamic Mikrotik router config for CGNAT / Proton VPN Port-Forwarding setups.

The router is behind CGNAT and reachable only through a Proton VPN tunnel with
Port Forwarding enabled. Both the public IP and the forwarded port change
periodically when the tunnel restarts, so the "live" address must be updatable
at runtime via a webhook (`POST /api/update-router-ip`) without redeploying.

Data model
----------
Singleton document in `db.mikrotik_dynamic`::

    {
      "_singleton": "mikrotik_dynamic",
      "host":        "<current public IP or DNS provided by Proton>",
      "port":        45678,       # forwarded port assigned by Proton
      "user":        "api-emergent",
      "password":    "<router api password>",
      "use_ssl":     false,
      "last_updated_at": "2026-02-14T12:34:56Z",
      "last_updated_source": "webhook"|"manual"|"env",
      "last_test_at":     "...",
      "last_test_ok":     true|false,
      "last_test_error":  "...",
      "last_test_snapshot": {board_name, cpu_load, version, ...}
    }

If the DB has no doc, values fall back to environment variables
``MIKROTIK_HOST``, ``MIKROTIK_PORT``, ``MIKROTIK_USER``, ``MIKROTIK_PASSWORD``.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

SINGLETON = "mikrotik_dynamic"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _env_defaults() -> Dict[str, Any]:
    port_raw = os.environ.get("MIKROTIK_PORT") or ""
    try:
        port = int(port_raw) if port_raw.strip() else 8728
    except ValueError:
        port = 8728
    return {
        "host": os.environ.get("MIKROTIK_HOST") or "",
        "port": port,
        "user": os.environ.get("MIKROTIK_USER") or "",
        "password": os.environ.get("MIKROTIK_PASSWORD") or "",
        "use_ssl": False,
        "last_updated_at": None,
        "last_updated_source": "env",
    }


def mask_password(pwd: Optional[str]) -> str:
    if not pwd:
        return ""
    if len(pwd) <= 4:
        return "•" * len(pwd)
    return pwd[:2] + "•" * (len(pwd) - 4) + pwd[-2:]


async def get_config(db) -> Dict[str, Any]:
    """Read effective config: DB doc if present, else env defaults."""
    doc = await db.mikrotik_dynamic.find_one({"_singleton": SINGLETON}, {"_id": 0})
    if not doc:
        return _env_defaults()
    # merge: env fills gaps
    env = _env_defaults()
    merged = {**env, **{k: v for k, v in doc.items() if v not in (None, "")}}
    # If DB never had a host/port, keep the source as env; otherwise DB source
    if not doc.get("host"):
        merged["last_updated_source"] = merged.get("last_updated_source") or "env"
    return merged


async def get_public_config(db) -> Dict[str, Any]:
    """Same as get_config but masks the password for API responses."""
    cfg = await get_config(db)
    return {
        "host": cfg.get("host") or "",
        "port": int(cfg.get("port") or 8728),
        "user": cfg.get("user") or "",
        "password_masked": mask_password(cfg.get("password")),
        "has_password": bool(cfg.get("password")),
        "use_ssl": bool(cfg.get("use_ssl", False)),
        "last_updated_at": cfg.get("last_updated_at"),
        "last_updated_source": cfg.get("last_updated_source"),
        "last_test_at": cfg.get("last_test_at"),
        "last_test_ok": cfg.get("last_test_ok"),
        "last_test_error": cfg.get("last_test_error"),
        "last_test_snapshot": cfg.get("last_test_snapshot"),
    }


async def upsert_config(db, patch: Dict[str, Any], source: str) -> Dict[str, Any]:
    """Upsert the singleton with the given partial update.

    `source` must be one of: 'webhook', 'manual', 'env'.
    Empty strings are ignored so callers can PATCH only what changed.
    """
    allowed = {"host", "port", "user", "password", "use_ssl"}
    clean: Dict[str, Any] = {}
    for k, v in patch.items():
        if k not in allowed:
            continue
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        if k == "port":
            try:
                clean[k] = int(v)
            except (TypeError, ValueError):
                continue
        elif k == "use_ssl":
            clean[k] = bool(v)
        else:
            clean[k] = v
    if not clean:
        return await get_config(db)
    clean["last_updated_at"] = _now_iso()
    clean["last_updated_source"] = source
    await db.mikrotik_dynamic.update_one(
        {"_singleton": SINGLETON},
        {"$set": clean, "$setOnInsert": {"_singleton": SINGLETON}},
        upsert=True,
    )
    return await get_config(db)


async def record_test_result(db, ok: bool, snapshot: Optional[Dict[str, Any]] = None,
                             error: Optional[str] = None) -> None:
    """Persist last connection test outcome on the singleton."""
    set_doc: Dict[str, Any] = {
        "last_test_at": _now_iso(),
        "last_test_ok": bool(ok),
        "last_test_error": (error or "")[:400] if not ok else "",
    }
    if ok and snapshot:
        # Only keep compact fields
        keep = ("identity", "board_name", "version", "uptime",
                "cpu", "cpu_count", "cpu_frequency", "cpu_load",
                "free_memory", "total_memory", "architecture", "platform")
        set_doc["last_test_snapshot"] = {k: snapshot.get(k) for k in keep if k in snapshot}
    await db.mikrotik_dynamic.update_one(
        {"_singleton": SINGLETON},
        {"$set": set_doc, "$setOnInsert": {"_singleton": SINGLETON}},
        upsert=True,
    )
