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
        # Algunos fallos de esta librería llegan sin texto (p. ej. cuando el
        # puerto acepta la conexión pero no habla el protocolo de RouterOS),
        # y "No se pudo conectar a X — " a secas no le dice nada al operador.
        detail = str(e).strip() or (
            f"el puerto {port} respondió pero no con el protocolo de la API de RouterOS. "
            "Revisa que /ip service tenga 'api' habilitado en ese puerto"
        )
        raise MikrotikRosError(f"No se pudo conectar a {host}:{port} — {detail}") from e
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


# --------------------------------------------------------------------------
# Address-list de morosos
# --------------------------------------------------------------------------
# El corte por falta de pago se hace metiendo la IP del cliente en una
# address-list del router, no deshabilitando su PPPoE: así la sesión sigue
# levantada (el cliente no ve "usuario/contraseña incorrectos", y al pagar
# vuelve el servicio sin reconectar) y es el firewall el que decide qué dejar
# pasar. La regla que usa esa lista la instala el script de vinculación.

DEFAULT_OVERDUE_LIST = "morosos"


def _addr_list_sync(host: str, port: int, user: str, password: str, use_ssl: bool,
                    timeout: int, action: str, address: str, list_name: str,
                    comment: str = "") -> Dict[str, Any]:
    """Bloqueante — se invoca desde `asyncio.to_thread`."""
    pool = None
    try:
        pool = routeros_api.RouterOsApiPool(
            host=host, username=user, password=password, port=port,
            use_ssl=use_ssl, plaintext_login=True,
            ssl_verify=False, ssl_verify_hostname=False,
        )
        try:
            pool.socket_timeout = timeout
        except Exception:
            pass
        api = pool.get_api()
        res = api.get_resource("/ip/firewall/address-list")

        existing = [r for r in res.get(list=list_name)
                    if r.get("address") == address]

        if action == "add":
            if existing:
                return {"ok": True, "changed": False, "detail": "ya estaba en la lista"}
            res.add(list=list_name, address=address,
                    comment=comment or "Sistema ISP - moroso")
            return {"ok": True, "changed": True}

        if action == "remove":
            if not existing:
                return {"ok": True, "changed": False, "detail": "no estaba en la lista"}
            for r in existing:
                res.remove(id=r.get("id") or r.get(".id"))
            return {"ok": True, "changed": True, "removed": len(existing)}

        raise MikrotikRosError(f"Acción desconocida: {action}")

    except routeros_api.exceptions.RouterOsApiConnectionError as e:
        detail = str(e).strip() or f"el puerto {port} no respondió con la API de RouterOS"
        raise MikrotikRosError(f"No se pudo conectar a {host}:{port} — {detail}") from e
    except routeros_api.exceptions.RouterOsApiCommunicationError as e:
        raise MikrotikRosError(f"Autenticación falló — revisa usuario/contraseña API: {e}") from e
    except MikrotikRosError:
        raise
    except Exception as e:
        raise MikrotikRosError(f"{type(e).__name__}: {e}") from e
    finally:
        try:
            if pool is not None:
                pool.disconnect()
        except Exception:
            pass


async def set_overdue(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                      address: str, blocked: bool, use_ssl: bool = False,
                      timeout: int = 8, list_name: str = DEFAULT_OVERDUE_LIST,
                      comment: str = "") -> Dict[str, Any]:
    """Mete (`blocked=True`) o saca (`False`) la IP del cliente de la lista."""
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    if not address:
        raise MikrotikRosError("El cliente no tiene IP asignada")
    return await asyncio.to_thread(
        _addr_list_sync, host, int(port), user, password, use_ssl, int(timeout),
        "add" if blocked else "remove", address, list_name, comment,
    )


async def list_overdue(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                       use_ssl: bool = False, timeout: int = 8,
                       list_name: str = DEFAULT_OVERDUE_LIST) -> Dict[str, Any]:
    """Lee la lista tal como está en el router (para comparar con el CRM)."""
    def _read():
        pool = routeros_api.RouterOsApiPool(
            host=host, username=user, password=password, port=int(port),
            use_ssl=use_ssl, plaintext_login=True,
            ssl_verify=False, ssl_verify_hostname=False,
        )
        try:
            pool.socket_timeout = int(timeout)
        except Exception:
            pass
        try:
            rows = pool.get_api().get_resource("/ip/firewall/address-list").get(list=list_name)
            return {"ok": True, "addresses": [r.get("address") for r in rows if r.get("address")]}
        finally:
            try:
                pool.disconnect()
            except Exception:
                pass

    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    try:
        return await asyncio.to_thread(_read)
    except MikrotikRosError:
        raise
    except Exception as e:
        raise MikrotikRosError(f"{type(e).__name__}: {e}") from e


# --------------------------------------------------------------------------
# Interfaces del router (para el selector de "Interfaz" al editar un cliente)
# --------------------------------------------------------------------------
def _list_interfaces_sync(host: str, port: int, user: str, password: str,
                          use_ssl: bool, timeout: int) -> Dict[str, Any]:
    pool = None
    try:
        pool = routeros_api.RouterOsApiPool(
            host=host, username=user, password=password, port=port,
            use_ssl=use_ssl, plaintext_login=True,
            ssl_verify=False, ssl_verify_hostname=False,
        )
        try:
            pool.socket_timeout = timeout
        except Exception:
            pass
        rows = pool.get_api().get_resource("/interface").get()
        names = [r.get("name") for r in rows if r.get("name")]
        return {"ok": True, "interfaces": names}
    except routeros_api.exceptions.RouterOsApiConnectionError as e:
        detail = str(e).strip() or f"el puerto {port} no respondió con la API de RouterOS"
        raise MikrotikRosError(f"No se pudo conectar a {host}:{port} — {detail}") from e
    except routeros_api.exceptions.RouterOsApiCommunicationError as e:
        raise MikrotikRosError(f"Autenticación falló — revisa usuario/contraseña API: {e}") from e
    except Exception as e:
        raise MikrotikRosError(f"{type(e).__name__}: {e}") from e
    finally:
        try:
            if pool is not None:
                pool.disconnect()
        except Exception:
            pass


async def list_interfaces(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                          use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    """Nombres de todas las interfaces del router (ether, bridge, vlan,
    pppoe-out, el propio túnel ovpn-crm, etc.), vía la misma API nativa que
    ya se usa para probar la conexión."""
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    return await asyncio.to_thread(
        _list_interfaces_sync, host, int(port), user, password, use_ssl, int(timeout)
    )
