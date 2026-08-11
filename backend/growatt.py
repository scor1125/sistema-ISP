"""Growatt ShinePhone / Open API v1 integration.

Provides a single async helper that reads the storage device's realtime data
from Growatt Open API v1. The value is cached in the ``energia_estado``
Mongo collection for ~4 min so we can safely poll every 5 min from the UI
without exceeding Growatt's rate limits or hammering their servers.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

import httpx


logger = logging.getLogger("growatt")


def _num(data: dict, *names: str, default: float = 0.0) -> float:
    """Best-effort numeric coercion accepting Growatt's variant field names."""
    for name in names:
        v = data.get(name)
        if v is None or v == "":
            continue
        try:
            return float(v)
        except (TypeError, ValueError):
            continue
    return default


def _unwrap(payload: Any) -> dict:
    """Growatt sometimes puts the payload under `data`, `result` or `obj`."""
    if not isinstance(payload, dict):
        raise ValueError("Growatt response is not an object")
    for key in ("data", "result", "obj"):
        v = payload.get(key)
        if isinstance(v, dict):
            return v
    return payload


async def _discover_device_sn(client: httpx.AsyncClient, base_url: str, plant_id: str) -> str:
    """List devices for the plant and return the first storage/SPH serial."""
    r = await client.get(
        f"{base_url}/device/list",
        params={"plant_id": plant_id, "page": 1, "perpage": 100},
    )
    r.raise_for_status()
    body = _unwrap(r.json())
    devices = body.get("devices") or body.get("deviceList") or body.get("list") or []
    if isinstance(devices, dict):
        devices = list(devices.values())
    for d in devices:
        dtype = str(d.get("type", "")).lower()
        model = str(d.get("model", "")).lower()
        if dtype in {"2", "storage", "sph", "spa", "noah"} or any(
            x in model for x in ("sph", "spa", "noah", "storage")
        ):
            sn = d.get("device_sn") or d.get("deviceSn") or d.get("sn")
            if sn:
                return str(sn)
    raise RuntimeError("Ningún dispositivo tipo storage encontrado en la planta")


async def read_growatt_estado(
    api_key: str,
    plant_id: str,
    base_url: str = "https://openapi.growatt.com/v1",
    device_sn: Optional[str] = None,
) -> dict:
    """Return {soc, load_w, charge_w, updated_at, device_sn} from Growatt live API."""
    headers = {"TOKEN": api_key, "Accept": "application/json"}
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
        sn = device_sn or await _discover_device_sn(client, base_url, plant_id)
        r = await client.post(
            f"{base_url}/device/storage/storage_last_data",
            data={"storage_sn": sn},
        )
        r.raise_for_status()
        raw = _unwrap(r.json())

    if raw.get("error_code") not in (None, 0, "0"):
        raise RuntimeError(f"Growatt error: {raw.get('error_code')} {raw.get('error_msg')}")

    soc = _num(raw, "capacity", "soc", "SOC", "batterySoc")
    load_w = _num(raw, "pacToUser", "loadPower", "load_w", "userPower")
    charge = _num(raw, "pCharge", "chargePower", "charge_w")
    discharge = _num(raw, "pDischarge", "dischargePower", "discharge_w")

    if not 0 <= soc <= 100:
        raise RuntimeError(f"SOC inválido devuelto por Growatt: {soc}")
    if load_w < 0:
        load_w = abs(load_w)

    # pCharge / pDischarge are documented as positive magnitudes.
    return {
        "soc": round(soc, 1),
        "load_w": round(load_w, 1),
        "charge_w": round(charge - discharge, 1),
        "device_sn": sn,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


async def get_estado_cached(db, plant_id: Optional[str] = None,
                            device_sn: Optional[str] = None,
                            ttl_seconds: int = 240) -> dict:
    """Read Growatt but keep a Mongo-side cache so 2 clients don't double-poll.

    ``plant_id`` / ``device_sn`` override the env defaults so a single deployment
    can serve several plants (office, home, ...).
    """
    api_key = os.environ.get("GROWATT_API_KEY")
    base_url = os.environ.get("GROWATT_BASE_URL") or "https://openapi.growatt.com/v1"
    pid = plant_id or os.environ.get("GROWATT_PLANT_ID")
    sn = device_sn if device_sn is not None else (os.environ.get("GROWATT_DEVICE_SN") or None)

    if not api_key or not pid:
        raise RuntimeError("Growatt no configurado: falta GROWATT_API_KEY o plant_id")

    cache_key = f"current-{pid}"
    now = datetime.now(timezone.utc)
    cached = await db.energia_estado.find_one({"_id": cache_key})
    if cached:
        try:
            cached_at = datetime.fromisoformat(cached["updated_at"].replace("Z", "+00:00"))
            if (now - cached_at).total_seconds() < ttl_seconds:
                cached.pop("_id", None)
                cached["cached"] = True
                return cached
        except Exception:
            pass

    state = await read_growatt_estado(api_key, pid, base_url, sn)
    state["plant_id"] = pid
    await db.energia_estado.replace_one(
        {"_id": cache_key},
        {"_id": cache_key, **state},
        upsert=True,
    )
    state["cached"] = False
    return state
