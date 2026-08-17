"""Mikrotik RouterOS API integration (native port 8728 / 8729-SSL).

Uses the `routeros_api` (RouterOS-api) library. Since the library is
synchronous, calls are wrapped with `asyncio.to_thread` so they don't block
the FastAPI event loop.

Provides:
  - `connect_and_test(host, port, username, password, use_ssl=False)`
    Opens a session, runs `/system/resource/print`, closes, and returns a
    normalized dict with board, version, uptime, cpu-load, memory, etc.

Requires on the RouterOS side:
  /ip service enable api            (or api-ssl for port 8729)
  /user add group=api,read,write name=<user> password=<pass>
  (or use an existing full-access user)
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict

import routeros_api

logger = logging.getLogger("mikrotik_ros")

DEFAULT_API_PORT = 8728
DEFAULT_API_SSL_PORT = 8729


class MikrotikRosError(Exception):
    pass


def _connect_sync(host: str, port: int, user: str, password: str,
                  use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    """Blocking RouterOS API call — run inside `asyncio.to_thread`."""
    conn = None
    try:
        pool = routeros_api.RouterOsApiPool(
            host=host,
            username=user,
            password=password,
            port=port,
            use_ssl=use_ssl,
            plaintext_login=True,
            ssl_verify=False,
            ssl_verify_hostname=False,
        )
        try:
            pool.socket_timeout = timeout
        except Exception:
            pass
        conn = pool.get_api()

        # /system/resource/print
        resource = conn.get_resource("/system/resource")
        rows = resource.get()
        if not rows:
            raise MikrotikRosError("Sin respuesta de /system/resource")
        info = rows[0]

        # /system/identity/print — hostname
        try:
            ident = conn.get_resource("/system/identity").get()
            identity = ident[0].get("name") if ident else ""
        except Exception:
            identity = ""

        pool.disconnect()

        return {
            "ok": True,
            "identity": identity,
            "board_name": info.get("board-name"),
            "version": info.get("version"),
            "architecture": info.get("architecture-name"),
            "uptime": info.get("uptime"),
            "cpu": info.get("cpu"),
            "cpu_count": info.get("cpu-count"),
            "cpu_frequency": info.get("cpu-frequency"),
            "cpu_load": info.get("cpu-load"),
            "free_memory": info.get("free-memory"),
            "total_memory": info.get("total-memory"),
            "free_hdd_space": info.get("free-hdd-space"),
            "total_hdd_space": info.get("total-hdd-space"),
            "platform": info.get("platform"),
            "build_time": info.get("build-time"),
            "raw": info,
        }
    except routeros_api.exceptions.RouterOsApiConnectionError as e:
        raise MikrotikRosError(f"No se pudo conectar a {host}:{port} — {e}") from e
    except routeros_api.exceptions.RouterOsApiCommunicationError as e:
        # Includes login failures ("invalid user name or password")
        raise MikrotikRosError(f"Autenticación falló — verifica usuario/contraseña API: {e}") from e
    except Exception as e:
        raise MikrotikRosError(f"{type(e).__name__}: {e}") from e
    finally:
        try:
            if conn is not None:
                # pool.disconnect is idempotent-ish; already called on success path
                pass
        except Exception:
            pass


async def connect_and_test(host: str, *, port: int = DEFAULT_API_PORT,
                            user: str, password: str,
                            use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    """Async wrapper — runs the blocking RouterOS API test in a thread."""
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API")
    return await asyncio.to_thread(
        _connect_sync, host, int(port), user, password, use_ssl, int(timeout)
    )
