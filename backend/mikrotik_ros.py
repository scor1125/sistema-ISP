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
from typing import Any, Dict, List

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


def _interfaces_and_addresses_sync(host: str, port: int, user: str, password: str,
                                   use_ssl: bool, timeout: int) -> Dict[str, Any]:
    """Una sola conexión: nombres de interfaz + qué red IP tiene configurada
    cada una (para poder ofrecer, por interfaz, qué IPs de esa red están
    libres al dar de alta un cliente)."""
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
        iface_rows = api.get_resource("/interface").get()
        names = [r.get("name") for r in iface_rows if r.get("name")]

        addr_rows = api.get_resource("/ip/address").get()
        networks: Dict[str, list] = {}
        for r in addr_rows:
            iface = r.get("interface")
            cidr = r.get("address")  # ej. "192.168.50.1/24" — es la IP del propio router
            if not iface or not cidr:
                continue
            networks.setdefault(iface, []).append(cidr)

        return {"ok": True, "interfaces": names, "networks": networks}
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


async def list_interfaces_and_addresses(host: str, *, port: int = DEFAULT_API_PORT, user: str,
                                        password: str, use_ssl: bool = False,
                                        timeout: int = 8) -> Dict[str, Any]:
    """Interfaces + la(s) red(es) IP configuradas en cada una, en una sola
    conexión al router."""
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    return await asyncio.to_thread(
        _interfaces_and_addresses_sync, host, int(port), user, password, use_ssl, int(timeout)
    )


# --------------------------------------------------------------------------
# Simple Queue por cliente (límite de velocidad según su plan)
# --------------------------------------------------------------------------
def _queue_sync(host: str, port: int, user: str, password: str, use_ssl: bool,
                timeout: int, action: str, name: str, target: str = "",
                max_limit: str = "", comment: str = "", burst_limit: str = "",
                burst_threshold: str = "", burst_time: str = "") -> Dict[str, Any]:
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
        res = pool.get_api().get_resource("/queue/simple")
        existing = list(res.get(name=name))

        if action == "remove":
            if not existing:
                return {"ok": True, "changed": False, "detail": "no existía"}
            for r in existing:
                res.remove(id=r.get("id"))
            return {"ok": True, "changed": True, "removed": len(existing)}

        if action == "set":
            burst_kwargs = {}
            if burst_limit:
                burst_kwargs["burst-limit"] = burst_limit
            if burst_threshold:
                burst_kwargs["burst-threshold"] = burst_threshold
            if burst_time:
                burst_kwargs["burst-time"] = burst_time
            if existing:
                res.set(id=existing[0].get("id"), target=target, comment=comment,
                        **{"max-limit": max_limit}, **burst_kwargs)
                return {"ok": True, "changed": True, "action": "updated"}
            res.add(name=name, target=target, comment=comment,
                    **{"max-limit": max_limit}, **burst_kwargs)
            return {"ok": True, "changed": True, "action": "created"}

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


async def set_queue(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                    name: str, target: str, max_limit: str, comment: str = "",
                    burst_limit: str = "", burst_threshold: str = "", burst_time: str = "",
                    use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    """Crea o actualiza la Simple Queue de un cliente (por nombre; se identifica
    por nombre y no por IP porque la IP puede cambiar)."""
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    if not target:
        raise MikrotikRosError("El cliente no tiene IP asignada")
    return await asyncio.to_thread(
        _queue_sync, host, int(port), user, password, use_ssl, int(timeout),
        "set", name, target, max_limit, comment, burst_limit, burst_threshold, burst_time,
    )


async def remove_queue(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                       name: str, use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    return await asyncio.to_thread(
        _queue_sync, host, int(port), user, password, use_ssl, int(timeout),
        "remove", name,
    )


# --------------------------------------------------------------------------
# PPPoE: servidor (una vez por router) + perfiles + secrets (por cliente)
# --------------------------------------------------------------------------
def _pppoe_inventory_sync(host: str, port: int, user: str, password: str,
                          use_ssl: bool, timeout: int) -> Dict[str, Any]:
    """Lo que ya existe en el router para armar los selectores del CRM: no se
    inventa nada, se muestra lo real (los nombres pueden cambiar con el tiempo)."""
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

        profiles = [r.get("name") for r in api.get_resource("/ppp/profile").get() if r.get("name")]

        servers = []
        for r in api.get_resource("/interface/pppoe-server/server").get():
            servers.append({
                "service_name": r.get("service-name"),
                "interface": r.get("interface"),
                "default_profile": r.get("default-profile"),
                "disabled": str(r.get("disabled", "false")).lower() == "true",
            })

        ip_pools = []
        for r in api.get_resource("/ip/pool").get():
            ip_pools.append({"name": r.get("name"), "ranges": r.get("ranges")})

        return {"ok": True, "ppp_profiles": profiles, "pppoe_servers": servers, "ip_pools": ip_pools}
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


async def pppoe_inventory(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                          use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    return await asyncio.to_thread(
        _pppoe_inventory_sync, host, int(port), user, password, use_ssl, int(timeout)
    )


def _pppoe_server_create_sync(host: str, port: int, user: str, password: str, use_ssl: bool,
                              timeout: int, interface: str, pool_name: str, pool_ranges: str,
                              service_name: str, profile_name: str, rate_limit: str) -> Dict[str, Any]:
    """Arma lo mínimo para que un router empiece a aceptar PPPoE: el pool de
    IPs (si hace falta crearlo), el perfil por defecto, y el servidor
    escuchando en la interfaz elegida. Todo por nombre — si ya existe algo con
    ese nombre se actualiza en vez de duplicar, para poder correrlo de nuevo
    sin miedo."""
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

        # 1) Pool de IPs para los clientes PPPoE
        pools_res = api.get_resource("/ip/pool")
        existing_pool = list(pools_res.get(name=pool_name))
        if existing_pool:
            pools_res.set(id=existing_pool[0].get("id"), ranges=pool_ranges)
        else:
            pools_res.add(name=pool_name, ranges=pool_ranges)

        # 2) Perfil por defecto para quien no tenga uno propio por plan
        prof_res = api.get_resource("/ppp/profile")
        existing_profile = list(prof_res.get(name=profile_name))
        if existing_profile:
            prof_res.set(id=existing_profile[0].get("id"),
                        **{"remote-address": pool_name, "rate-limit": rate_limit})
        else:
            prof_res.add(name=profile_name, **{"remote-address": pool_name, "rate-limit": rate_limit})

        # 3) El servidor en sí, escuchando en la interfaz elegida
        srv_res = api.get_resource("/interface/pppoe-server/server")
        existing_srv = list(srv_res.get(**{"service-name": service_name}))
        if existing_srv:
            srv_res.set(id=existing_srv[0].get("id"), interface=interface,
                       **{"default-profile": profile_name}, disabled="no")
        else:
            srv_res.add(**{"service-name": service_name}, interface=interface,
                       **{"default-profile": profile_name}, disabled="no")

        return {"ok": True, "pool": pool_name, "profile": profile_name,
                "service_name": service_name, "interface": interface}
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


async def create_pppoe_server(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                              interface: str, pool_name: str, pool_ranges: str,
                              service_name: str = "isp-pppoe", profile_name: str = "isp-pppoe-default",
                              rate_limit: str = "5M/5M", use_ssl: bool = False,
                              timeout: int = 10) -> Dict[str, Any]:
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    if not interface:
        raise MikrotikRosError("Falta la interfaz donde va a escuchar el servidor PPPoE")
    if not pool_ranges:
        raise MikrotikRosError("Falta el rango de IPs del pool")
    return await asyncio.to_thread(
        _pppoe_server_create_sync, host, int(port), user, password, use_ssl, int(timeout),
        interface, pool_name, pool_ranges, service_name, profile_name, rate_limit,
    )


def _ppp_profile_ensure_sync(host: str, port: int, user: str, password: str, use_ssl: bool,
                             timeout: int, name: str, rate_limit: str) -> Dict[str, Any]:
    """Crea o actualiza un perfil PPP por velocidad de plan, compartido por
    todos los clientes de ese plan.

    Al crearlo (no al actualizar uno que ya existe) copia el remote-address
    de algún perfil que ya tenga uno configurado — normalmente el
    default-profile del servidor PPPoE. Sin esto, un perfil nuevo se queda
    sin pool de IPs y el cliente no recibe dirección al conectarse aunque el
    secret y la velocidad estén perfectos."""
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
        res = pool.get_api().get_resource("/ppp/profile")
        existing = list(res.get(name=name))
        if existing:
            res.set(id=existing[0].get("id"), **{"rate-limit": rate_limit})
            return {"ok": True, "action": "updated"}

        remote_address = ""
        for r in res.get():
            addr = r.get("remote-address")
            if addr:
                remote_address = addr
                break
        fields = {"rate-limit": rate_limit}
        if remote_address:
            fields["remote-address"] = remote_address
        res.add(name=name, **fields)
        return {"ok": True, "action": "created", "remote_address": remote_address}
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


async def ensure_ppp_profile(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                             name: str, rate_limit: str, use_ssl: bool = False,
                             timeout: int = 8) -> Dict[str, Any]:
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    return await asyncio.to_thread(
        _ppp_profile_ensure_sync, host, int(port), user, password, use_ssl, int(timeout), name, rate_limit
    )


def _ppp_secret_sync(host: str, port: int, user: str, password: str, use_ssl: bool, timeout: int,
                     action: str, name: str, secret_password: str = "", profile: str = "",
                     remote_address: str = "", comment: str = "") -> Dict[str, Any]:
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
        res = pool.get_api().get_resource("/ppp/secret")
        existing = list(res.get(name=name))

        if action == "remove":
            if not existing:
                return {"ok": True, "changed": False}
            for r in existing:
                res.remove(id=r.get("id"))
            # Una sesion ya activa no se cae solo con borrar el secret — hay
            # que sacarla tambien de /ppp active para el corte sea inmediato.
            try:
                act_res = pool.get_api().get_resource("/ppp/active")
                for r in act_res.get(name=name):
                    act_res.remove(id=r.get("id"))
            except Exception:
                pass
            return {"ok": True, "changed": True, "removed": len(existing)}

        if action == "set":
            fields = {"password": secret_password, "profile": profile, "service": "pppoe",
                     "comment": comment}
            if remote_address:
                fields["remote-address"] = remote_address
            if existing:
                res.set(id=existing[0].get("id"), **fields)
                return {"ok": True, "changed": True, "action": "updated"}
            res.add(name=name, **fields)
            return {"ok": True, "changed": True, "action": "created"}

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


async def set_ppp_secret(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                         name: str, secret_password: str, profile: str, remote_address: str = "",
                         comment: str = "", use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    if not name or not secret_password:
        raise MikrotikRosError("Falta el usuario o la contraseña PPPoE")
    return await asyncio.to_thread(
        _ppp_secret_sync, host, int(port), user, password, use_ssl, int(timeout),
        "set", name, secret_password, profile, remote_address, comment,
    )


async def remove_ppp_secret(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                            name: str, use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    return await asyncio.to_thread(
        _ppp_secret_sync, host, int(port), user, password, use_ssl, int(timeout), "remove", name,
    )


# --------------------------------------------------------------------------
# Tráfico en vivo (panel "Tráfico en vivo" de cada cliente)
# --------------------------------------------------------------------------
def _bps_to_mbps(raw) -> float:
    try:
        if isinstance(raw, bytes):
            raw = raw.decode()
        return round(int(raw) / 1_000_000, 2)
    except Exception:
        return 0.0


def _queue_rate_sync(host: str, port: int, user: str, password: str, use_ssl: bool,
                     timeout: int, name: str) -> Dict[str, Any]:
    """Lee el `rate` (bps subida/bajada) que RouterOS ya calcula solo para cada
    Simple Queue — no hace falta medir con dos muestras, el router lo trae."""
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
        res = pool.get_api().get_resource("/queue/simple")
        rows = list(res.get(name=name))
        if not rows:
            return {"ok": False, "reason": "la cola ya no existe en el router"}
        rx_raw, _, tx_raw = (rows[0].get("rate") or "0/0").partition("/")
        return {"ok": True, "rx_mbps": _bps_to_mbps(rx_raw), "tx_mbps": _bps_to_mbps(tx_raw)}
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


async def get_queue_rate(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                         name: str, use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    if not name:
        raise MikrotikRosError("El cliente no tiene cola asignada")
    return await asyncio.to_thread(
        _queue_rate_sync, host, int(port), user, password, use_ssl, int(timeout), name,
    )


def _pppoe_rate_sync(host: str, port: int, user: str, password: str, use_ssl: bool,
                     timeout: int, username: str) -> Dict[str, Any]:
    """Si el cliente PPPoE está conectado, mide su interfaz dinámica en vivo
    con `/interface monitor-traffic`. Sin sesión activa no hay nada que medir
    (el cliente está desconectado, no es un error)."""
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
        actives = list(api.get_resource("/ppp/active").get(name=username))
        if not actives:
            return {"ok": True, "online": False, "rx_mbps": 0.0, "tx_mbps": 0.0}
        iface = (actives[0].get("interface") or "").strip() or f"<pppoe-{username}>"

        bres = api.get_binary_resource("/interface")
        rows = list(bres.call("monitor-traffic", {"once": "", "interface": iface}))
        if not rows:
            return {"ok": True, "online": True, "rx_mbps": 0.0, "tx_mbps": 0.0}
        row = rows[0]
        rx = row.get("rx-bits-per-second", 0)
        tx = row.get("tx-bits-per-second", 0)
        return {"ok": True, "online": True, "rx_mbps": _bps_to_mbps(rx), "tx_mbps": _bps_to_mbps(tx)}
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


async def get_pppoe_rate(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                         username: str, use_ssl: bool = False, timeout: int = 8) -> Dict[str, Any]:
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    if not username:
        raise MikrotikRosError("El cliente no tiene usuario PPPoE")
    return await asyncio.to_thread(
        _pppoe_rate_sync, host, int(port), user, password, use_ssl, int(timeout), username,
    )


def _interface_traffic_sync(host: str, port: int, user: str, password: str, use_ssl: bool,
                            timeout: int, interfaces: List[str]) -> Dict[str, Any]:
    """Consumo en vivo de varias interfaces a la vez. RouterOS acepta la lista
    separada por comas en un solo `monitor-traffic`, así que se mide todo en
    una llamada en vez de una por interfaz."""
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
        bres = pool.get_api().get_binary_resource("/interface")
        rows = list(bres.call("monitor-traffic", {
            "once": b"", "interface": ",".join(interfaces).encode(),
        }))
        per_iface, rx_total, tx_total = [], 0.0, 0.0
        for row in rows:
            name = row.get("name")
            if isinstance(name, bytes):
                name = name.decode()
            rx = _bps_to_mbps(row.get("rx-bits-per-second", 0))
            tx = _bps_to_mbps(row.get("tx-bits-per-second", 0))
            rx_total += rx
            tx_total += tx
            per_iface.append({"interface": name, "rx_mbps": rx, "tx_mbps": tx})
        return {"ok": True, "rx_mbps": round(rx_total, 2), "tx_mbps": round(tx_total, 2),
                "interfaces": per_iface}
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


async def interface_traffic(host: str, *, port: int = DEFAULT_API_PORT, user: str, password: str,
                            interfaces: List[str], use_ssl: bool = False,
                            timeout: int = 8) -> Dict[str, Any]:
    if not host or not user or not password:
        raise MikrotikRosError("Faltan host, usuario o contraseña API del router")
    if not interfaces:
        raise MikrotikRosError("No se indicó ninguna interfaz que medir")
    return await asyncio.to_thread(
        _interface_traffic_sync, host, int(port), user, password, use_ssl, int(timeout),
        list(interfaces),
    )
