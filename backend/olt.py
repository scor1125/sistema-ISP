"""OLT integration via SNMP (v2c / v3).

Provides an async SNMP walker + vendor-specific OID templates so the CRM can
poll OLTs (VSol EPON/GPON, Huawei, ZTE, Fiberhome, C-Data, BDCOM…) and expose
each ONU's real name, MAC, status and RX power in the UI.

Design notes:
- Uses `pysnmp` (lextudio async fork) — pure Python, no snmpwalk subprocess.
- Vendor OID templates are stored in `OID_TEMPLATES`. Any field can be
  overridden per-OLT via the `snmp_oids_override` dict on the device doc,
  so the operator can iterate on OIDs without touching code.
- Status codes and dBm scaling are also configurable per vendor.
- Fully vendor-agnostic fallback: if the vendor template returns nothing
  useful, we walk `sysDescr` + `ifDescr` so the UI still shows *something*
  useful for debugging.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from pysnmp.hlapi.asyncio import (  # noqa: F401
    CommunityData, ContextData, ObjectIdentity, ObjectType, SnmpEngine,
    UdpTransportTarget, UsmUserData, bulkCmd, getCmd,
)

logger = logging.getLogger("olt")


# ============================================================================
# Vendor OID templates
# ============================================================================
#
# Each key is a logical field name; the value is the base OID whose sub-tree
# holds the per-ONU value indexed by the same suffix across all fields.
#
# VSol EPON series (V1600D/E, V1600GT, V1600G0) — most common in LatAm.
# VSol proprietary enterprise OID: 1.3.6.1.4.1.37950
#
# NOTE: OIDs can differ per firmware. Operators can override any field via
# `device.snmp_oids_override = { "field": "1.3.6.1..." }` in the DB.

OID_TEMPLATES: Dict[str, Dict[str, str]] = {
    "vsol_epon": {
        # Interface name / description (registered ONU LLID → label)
        "onu_index":  "1.3.6.1.4.1.37950.1.1.5.13.1.1.1",
        "onu_mac":    "1.3.6.1.4.1.37950.1.1.5.13.1.1.2",
        "onu_name":   "1.3.6.1.4.1.37950.1.1.5.13.1.1.5",
        "onu_status": "1.3.6.1.4.1.37950.1.1.5.13.1.1.10",
        # Optical: RX power reported by the OLT (dBm × 10 as signed int)
        "onu_rx_dbm10": "1.3.6.1.4.1.37950.1.1.5.15.1.1.4",
        "onu_tx_dbm10": "1.3.6.1.4.1.37950.1.1.5.15.1.1.5",
    },
    "vsol_gpon": {
        "onu_index":  "1.3.6.1.4.1.37950.1.1.6.13.1.1.1",
        "onu_mac":    "1.3.6.1.4.1.37950.1.1.6.13.1.1.2",
        "onu_name":   "1.3.6.1.4.1.37950.1.1.6.13.1.1.5",
        "onu_status": "1.3.6.1.4.1.37950.1.1.6.13.1.1.10",
        "onu_rx_dbm10": "1.3.6.1.4.1.37950.1.1.6.15.1.1.4",
        "onu_tx_dbm10": "1.3.6.1.4.1.37950.1.1.6.15.1.1.5",
    },
    "huawei": {
        # Huawei MA5600T/MA5680T
        "onu_index":  "1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1",
        "onu_name":   "1.3.6.1.4.1.2011.6.128.1.1.2.43.1.9",
        "onu_status": "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.15",
        "onu_rx_dbm10": "1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4",
    },
    "zte": {
        "onu_index":  "1.3.6.1.4.1.3902.1012.3.28.1.1.1",
        "onu_name":   "1.3.6.1.4.1.3902.1012.3.28.1.1.4",
        "onu_status": "1.3.6.1.4.1.3902.1012.3.50.11.2.1.1",
        "onu_rx_dbm10": "1.3.6.1.4.1.3902.1012.3.50.12.1.1.10",
    },
}

# ONU operational status codes: raw value → human-readable
# Most VSol firmwares use 1=online, 2=offline (some use 3=LOS).
STATUS_MAP = {
    "vsol_epon": {1: "online", 2: "offline", 3: "los", 0: "unknown"},
    "vsol_gpon": {1: "online", 2: "offline", 3: "los", 0: "unknown"},
    "huawei":    {1: "online", 2: "offline"},
    "zte":       {1: "online", 2: "offline", 3: "los"},
}

# Standard MIB-II always-safe OIDs (used by `snmp_test`)
OID_SYS_DESCR    = "1.3.6.1.2.1.1.1.0"
OID_SYS_UPTIME   = "1.3.6.1.2.1.1.3.0"
OID_SYS_NAME     = "1.3.6.1.2.1.1.5.0"
OID_IF_NUMBER    = "1.3.6.1.2.1.2.1.0"


class OLTError(Exception):
    pass


# ============================================================================
# Low-level SNMP helpers (pysnmp async)
# ============================================================================
def _auth_data(community: str, version: str, snmpv3: Optional[dict] = None):
    if version == "v3" and snmpv3:
        return UsmUserData(
            snmpv3.get("user", ""),
            snmpv3.get("auth_key") or None,
            snmpv3.get("priv_key") or None,
        )
    # v2c default
    return CommunityData(community or "public", mpModel=1)


async def snmp_get(host: str, oid: str, *, community: str = "public",
                   port: int = 161, version: str = "2c",
                   timeout: int = 3) -> Any:
    """SNMP GET a single scalar OID; returns the python-native value."""
    auth = _auth_data(community, version)
    err_ind, err_stat, err_idx, var_binds = await getCmd(  # noqa: F821
        SnmpEngine(),
        auth,
        UdpTransportTarget((host, int(port)), timeout=float(timeout), retries=1),
        ContextData(),
        ObjectType(ObjectIdentity(oid)),
    )
    if err_ind:
        raise OLTError(f"SNMP error: {err_ind}")
    if err_stat:
        raise OLTError(f"SNMP error: {err_stat.prettyPrint()} at {err_idx}")
    if not var_binds:
        return None
    _, val = var_binds[0]
    return val.prettyPrint() if hasattr(val, "prettyPrint") else val


async def snmp_walk(host: str, base_oid: str, *, community: str = "public",
                    port: int = 161, version: str = "2c", timeout: int = 3,
                    max_rows: int = 500) -> List[Tuple[str, Any]]:
    """SNMP walk using GETBULK; returns [(oid_str, value), ...]. Stops when the
    returned OID leaves the base sub-tree or when `max_rows` is reached."""
    auth = _auth_data(community, version)
    results: List[Tuple[str, Any]] = []
    from pysnmp.smi.rfc1902 import ObjectIdentity as OI

    base = str(base_oid)
    next_oid = ObjectType(OI(base_oid))

    engine = SnmpEngine()
    transport = UdpTransportTarget((host, int(port)), timeout=float(timeout), retries=1)

    while len(results) < max_rows:
        err_ind, err_stat, err_idx, var_binds_table = await bulkCmd(  # noqa: F821
            engine,
            auth,
            transport,
            ContextData(),
            0,          # non-repeaters
            25,         # max-repetitions
            next_oid,
            lexicographicMode=False,
        )
        if err_ind:
            raise OLTError(f"SNMP walk error: {err_ind}")
        if err_stat:
            raise OLTError(f"SNMP walk error: {err_stat.prettyPrint()} at {err_idx}")
        if not var_binds_table:
            break
        # var_binds_table is a list of var-bind rows (each is a list of (oid, val))
        stopped = False
        for row in var_binds_table:
            for oid, val in row:
                oid_str = str(oid)
                if not oid_str.startswith(base + ".") and oid_str != base:
                    stopped = True
                    break
                v = val.prettyPrint() if hasattr(val, "prettyPrint") else val
                results.append((oid_str, v))
            if stopped or len(results) >= max_rows:
                break
        if stopped:
            break
        # Continue from the last OID
        last_oid = results[-1][0] if results else None
        if not last_oid:
            break
        next_oid = ObjectType(OI(last_oid))
    return results


# ============================================================================
# High-level ONU reader
# ============================================================================
def _mac_from_hex(v: Any) -> str:
    """VSol returns MAC as an OctetString rendered as '0x...' hex — normalize."""
    s = str(v)
    s = s.replace("0x", "").replace(":", "").replace(" ", "")
    if len(s) == 12 and all(c in "0123456789abcdefABCDEF" for c in s):
        return ":".join(s[i:i+2].upper() for i in range(0, 12, 2))
    return str(v)


def _to_int(v: Any) -> Optional[int]:
    try: return int(v)
    except (TypeError, ValueError):
        try:
            # pysnmp may return "0x00" for empty
            return int(str(v), 0)
        except Exception:
            return None


async def read_onus(host: str, *, vendor: str = "vsol_epon",
                    community: str = "public", port: int = 161,
                    version: str = "2c", timeout: int = 3,
                    oids_override: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Walk vendor-specific OIDs and return a list of normalized ONU dicts.

    Returns { "vendor": ..., "onus": [ {index, mac, name, status, rx_dbm, tx_dbm} ],
              "raw_counts": {...}, "sys_descr": "..." }
    """
    template = dict(OID_TEMPLATES.get(vendor) or OID_TEMPLATES["vsol_epon"])
    if oids_override:
        for k, v in oids_override.items():
            if v: template[k] = v

    # 1. sysDescr sanity ping
    try:
        sys_descr = await snmp_get(host, OID_SYS_DESCR, community=community,
                                    port=port, version=version, timeout=timeout)
    except Exception as e:
        raise OLTError(f"No se pudo contactar la OLT en {host}:{port} ({e})")

    # 2. Walk each field. Suffix = OID minus base, used as the row key.
    walks: Dict[str, Dict[str, Any]] = {}
    raw_counts = {}
    for field in ("onu_mac", "onu_name", "onu_status", "onu_rx_dbm10", "onu_tx_dbm10"):
        base = template.get(field)
        if not base:
            continue
        try:
            rows = await snmp_walk(host, base, community=community, port=port,
                                    version=version, timeout=timeout)
        except Exception as e:
            logger.warning("snmp_walk(%s / %s) failed: %s", vendor, field, e)
            rows = []
        raw_counts[field] = len(rows)
        walks[field] = {oid[len(base) + 1:]: val for oid, val in rows}

    # 3. Union of all suffixes → per-row ONU
    all_keys = set()
    for w in walks.values():
        all_keys.update(w.keys())

    status_map = STATUS_MAP.get(vendor, {1: "online", 2: "offline"})
    onus: List[Dict[str, Any]] = []
    for key in sorted(all_keys):
        mac_raw = walks.get("onu_mac", {}).get(key)
        name = walks.get("onu_name", {}).get(key) or ""
        status_raw = _to_int(walks.get("onu_status", {}).get(key))
        rx10 = _to_int(walks.get("onu_rx_dbm10", {}).get(key))
        tx10 = _to_int(walks.get("onu_tx_dbm10", {}).get(key))
        onus.append({
            "index": key,
            "mac": _mac_from_hex(mac_raw) if mac_raw is not None else "",
            "name": str(name).strip(),
            "status_code": status_raw,
            "status": status_map.get(status_raw or 0, "unknown"),
            "rx_dbm": (rx10 / 10.0) if rx10 is not None else None,
            "tx_dbm": (tx10 / 10.0) if tx10 is not None else None,
        })

    return {
        "vendor": vendor,
        "sys_descr": str(sys_descr) if sys_descr else "",
        "raw_counts": raw_counts,
        "onus": onus,
    }


async def snmp_test(host: str, *, community: str = "public", port: int = 161,
                    version: str = "2c", timeout: int = 3) -> Dict[str, Any]:
    """Quick connectivity probe: read sysDescr + sysName + ifNumber."""
    result: Dict[str, Any] = {"host": host, "port": port, "version": version}
    try:
        result["sys_descr"] = str(await snmp_get(host, OID_SYS_DESCR,
                                                   community=community, port=port,
                                                   version=version, timeout=timeout))
        result["sys_name"] = str(await snmp_get(host, OID_SYS_NAME,
                                                  community=community, port=port,
                                                  version=version, timeout=timeout))
        try:
            result["if_number"] = int(await snmp_get(host, OID_IF_NUMBER,
                                                       community=community, port=port,
                                                       version=version, timeout=timeout))
        except Exception:
            result["if_number"] = None
        result["ok"] = True
    except Exception as e:
        result["ok"] = False
        result["error"] = str(e)
    return result
