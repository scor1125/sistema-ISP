"""Tuya / Smart Life IoT Core Cloud integration.

Provides a minimal async client for the Tuya IoT Core Cloud Development 2.0 API:

- Authentication: HMAC-SHA256 signed token (grant_type=1, auto-refreshed on expiry).
- Device listing under the project (with online/offline status).
- Device status snapshot (current dps values like `switch`, `temp_set`, `mode`).
- Send commands (on/off, temperature, mode, fan speed).
- Rename device inside the project.
- Remove device from the project.

Signature algorithm (per official Tuya docs):

    stringToSign = HTTPMethod + "\\n" + Content-SHA256 + "\\n" + Headers + "\\n" + Url

    Where:
      - Content-SHA256 = SHA256(request_body) hex-lowercase
      - Headers = "" (we don't sign optional headers)
      - Url = path + "?" + sorted_query_string  (or just path if no query)

    For the /token endpoint (no access_token yet):
        str = client_id + t + nonce + stringToSign
    For all other endpoints (with access_token):
        str = client_id + access_token + t + nonce + stringToSign

    sign = HMAC_SHA256(str, secret).hexdigest().upper()

Headers sent on every request:
    client_id, t, sign, sign_method=HMAC-SHA256, nonce, access_token (when set)

The client caches the access token in-memory + Mongo (`tuya_token` collection)
so we don't re-issue tokens on every request. Tokens are valid ~2h; we refresh
if less than 60s remain.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import time
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("tuya")

REGION_ENDPOINTS = {
    "us": "https://openapi.tuyaus.com",
    "eu": "https://openapi.tuyaeu.com",
    "cn": "https://openapi.tuyacn.com",
    "in": "https://openapi.tuyain.com",
    "we": "https://openapi-weaz.tuyaus.com",  # US-west
    "ue": "https://openapi-ueaz.tuyaus.com",  # US-east
}


class TuyaError(Exception):
    """Raised when Tuya returns a non-success response (`success=false`)."""

    def __init__(self, code: int, msg: str, http_status: int = 502):
        super().__init__(f"Tuya {code}: {msg}")
        self.code = code
        self.msg = msg
        self.http_status = http_status


class TuyaClient:
    """Async Tuya IoT Core client.

    Usage::

        client = TuyaClient(access_id, access_secret, region="us")
        devices = await client.list_devices()
        await client.send_commands(device_id, [{"code": "switch", "value": True}])
    """

    def __init__(self, access_id: str, access_secret: str, region: str = "us",
                 project_code: Optional[str] = None, db=None):
        if not access_id or not access_secret:
            raise ValueError("Tuya access_id + access_secret son obligatorios")
        self.access_id = access_id.strip()
        self.access_secret = access_secret.strip()
        self.region = (region or "us").lower()
        self.project_code = (project_code or "").strip()
        self.base_url = REGION_ENDPOINTS.get(self.region, REGION_ENDPOINTS["us"])
        self._token: Optional[str] = None
        self._token_expires_at: float = 0.0
        self._db = db  # optional Motor DB for persistence

    # ------------------------------------------------------------------ signing
    def _sign(self, method: str, path: str, query: Dict[str, Any] | None,
              body: str, t: str, nonce: str, token: str = "") -> str:
        content_sha256 = hashlib.sha256((body or "").encode()).hexdigest()
        headers_str = ""  # we don't sign optional headers
        url = path
        if query:
            # Tuya requires the query string to be sorted by key
            sorted_q = urlencode(sorted(query.items()))
            url = f"{path}?{sorted_q}"
        string_to_sign = f"{method.upper()}\n{content_sha256}\n{headers_str}\n{url}"
        payload = self.access_id + token + t + nonce + string_to_sign
        return hmac.new(self.access_secret.encode(),
                        payload.encode(),
                        hashlib.sha256).hexdigest().upper()

    def _base_headers(self, t: str, nonce: str, sign: str,
                      token: Optional[str] = None) -> Dict[str, str]:
        h = {
            "client_id": self.access_id,
            "t": t,
            "sign_method": "HMAC-SHA256",
            "nonce": nonce,
            "sign": sign,
            "Content-Type": "application/json",
        }
        if token:
            h["access_token"] = token
        return h

    # ------------------------------------------------------------------- token
    async def _fetch_token(self) -> str:
        """Call GET /v1.0/token?grant_type=1 to obtain a fresh access token."""
        path = "/v1.0/token"
        query = {"grant_type": 1}
        t = str(int(time.time() * 1000))
        nonce = uuid.uuid4().hex
        sign = self._sign("GET", path, query, "", t, nonce)
        headers = self._base_headers(t, nonce, sign)
        url = f"{self.base_url}{path}?{urlencode(query)}"
        async with httpx.AsyncClient(timeout=15.0) as hc:
            r = await hc.get(url, headers=headers)
        return self._handle(r, want="access_token")

    def _handle(self, r: httpx.Response, want: Optional[str] = None):
        """Parse Tuya's envelope: `{success, code, msg, result, t}`."""
        try:
            data = r.json()
        except Exception:
            raise TuyaError(0, f"Respuesta no-JSON de Tuya (HTTP {r.status_code}): {r.text[:200]}")
        if not data.get("success", False):
            code = int(data.get("code") or 0)
            msg = data.get("msg") or "Error desconocido"
            # 1004 = sign invalid → suele ser secret/region mala
            # 1010 = token invalid → forzamos refresh
            raise TuyaError(code, msg)
        result = data.get("result")
        if want == "access_token" and isinstance(result, dict):
            token = result.get("access_token")
            expire_time = int(result.get("expire_time") or 7200)
            self._token = token
            self._token_expires_at = time.time() + max(60, expire_time - 60)
            logger.info("Tuya token OK (expira en %ss)", expire_time)
            return token
        return result

    async def _ensure_token(self, force: bool = False) -> str:
        if not force and self._token and time.time() < self._token_expires_at:
            return self._token
        return await self._fetch_token()

    # -------------------------------------------------------------- request
    async def _request(self, method: str, path: str, *, query: Dict[str, Any] | None = None,
                       body: Any = None, _retry: bool = True) -> Any:
        import json as _json
        body_str = "" if body is None else _json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        token = await self._ensure_token()
        t = str(int(time.time() * 1000))
        nonce = uuid.uuid4().hex
        sign = self._sign(method, path, query, body_str, t, nonce, token)
        headers = self._base_headers(t, nonce, sign, token)
        url = self.base_url + path
        if query:
            url = f"{url}?{urlencode(query)}"
        async with httpx.AsyncClient(timeout=15.0) as hc:
            r = await hc.request(method.upper(), url, headers=headers,
                                 content=body_str if body_str else None)
        try:
            return self._handle(r)
        except TuyaError as e:
            # Token expired mid-flight: refresh once and retry
            if e.code in (1010, 1011, 1012) and _retry:
                logger.info("Tuya token stale (%s) — refreshing", e.code)
                await self._ensure_token(force=True)
                return await self._request(method, path, query=query, body=body, _retry=False)
            raise

    # ---------------------------------------------------------------- devices
    async def test_auth(self) -> Dict[str, Any]:
        """Force a token fetch. Returns {"ok": True, "expires_in": ...} on success."""
        await self._ensure_token(force=True)
        return {
            "ok": True,
            "region": self.region,
            "endpoint": self.base_url,
            "expires_at": self._token_expires_at,
        }

    async def get_uid(self) -> Optional[str]:
        """Return the first user_id linked to this project (needed for /v1.0 device lists).

        Endpoint: GET /v1.0/apps/{schema}/users  (uses project's schema).
        Since we don't know the schema, we prefer /v1.3/iot-03/devices instead
        which returns devices under the whole project without needing a uid.
        """
        return None  # placeholder — /v1.3/iot-03/devices doesn't need it

    async def list_devices(self, page_size: int = 100) -> List[Dict[str, Any]]:
        """List all devices under this project.

        Strategy (Tuya requires source_id when calling /v1.3/iot-03/devices with
        source_type=tuyaUser). We:
          1. List linked app-account users via /v1.0/iot-01/associated-users/users
          2. For each uid, fetch their devices via /v1.0/users/{uid}/devices
          3. Deduplicate by device_id
          4. Fall back to /v1.0/iot-01/associated-users/devices if step 1 returns none
        """
        all_devices: Dict[str, Dict[str, Any]] = {}

        # Step 1 — get uids of linked app users
        uids: List[str] = []
        try:
            users_res = await self._request(
                "GET", "/v1.0/iot-01/associated-users/users",
                query={"page_no": 1, "page_size": 50},
            )
            users = []
            if isinstance(users_res, list):
                users = users_res
            elif isinstance(users_res, dict):
                users = users_res.get("list") or users_res.get("users") or users_res.get("records") or []
            for u in users:
                if not isinstance(u, dict):
                    continue
                uid = u.get("uid") or u.get("user_id") or u.get("id")
                if uid:
                    uids.append(str(uid))
        except TuyaError as e:
            logger.warning("associated-users/users failed: %s", e)

        # Step 2 — fetch devices per uid
        for uid in uids:
            try:
                devs = await self._request(
                    "GET", f"/v1.0/users/{uid}/devices",
                    query={"page_no": 1, "page_size": page_size},
                )
                items = []
                if isinstance(devs, list):
                    items = devs
                elif isinstance(devs, dict):
                    items = devs.get("list") or devs.get("devices") or devs.get("records") or []
                for d in items:
                    if not isinstance(d, dict):
                        continue
                    did = d.get("id") or d.get("device_id") or d.get("dev_id")
                    if did:
                        all_devices.setdefault(did, d)
            except TuyaError as e:
                logger.warning("users/%s/devices failed: %s", uid, e)

        if all_devices:
            return list(all_devices.values())

        # Step 3 — fallback: /v1.0/iot-01/associated-users/devices
        try:
            fallback = await self._request(
                "GET", "/v1.0/iot-01/associated-users/devices",
                query={"size": page_size},
            )
            items = []
            if isinstance(fallback, list):
                items = fallback
            elif isinstance(fallback, dict):
                items = fallback.get("list") or fallback.get("devices") or fallback.get("records") or []
            for d in items:
                if not isinstance(d, dict):
                    continue
                did = d.get("id") or d.get("device_id") or d.get("dev_id")
                if did:
                    all_devices.setdefault(did, d)
        except TuyaError as e:
            logger.warning("associated-users/devices fallback failed: %s", e)

        return list(all_devices.values())

    async def get_device(self, device_id: str) -> Dict[str, Any]:
        """Return device metadata (name, product, online, model, category)."""
        return await self._request("GET", f"/v1.1/iot-03/devices/{device_id}")

    async def get_status(self, device_id: str) -> List[Dict[str, Any]]:
        """Return live status list `[{"code": "switch", "value": true}, ...]`."""
        result = await self._request("GET", f"/v1.0/iot-03/devices/{device_id}/status")
        return result if isinstance(result, list) else []

    # DP-code aliases used to remap unsupported codes to whatever the device
    # actually exposes via /functions. Ordered from most likely to least likely.
    _ALIASES: Dict[str, List[str]] = {
        "switch":         ["power", "switch_1", "switch_led"],
        "switch_1":       ["switch", "power"],
        "temp_set":       ["temp", "temperature_set", "temp_value"],
        "temp":           ["temp_set", "temperature_set", "temp_value"],
        "mode":           ["work_mode", "mode_enum"],
        "fan_speed_enum": ["fan", "fan_speed", "wind_speed"],
        "fan_speed":      ["fan", "fan_speed_enum", "wind_speed"],
        "fan":            ["fan_speed_enum", "fan_speed"],
    }

    # Cached supported DP codes per device id (avoid re-fetching /functions on
    # every command). Populated lazily on first 1109/2008 error.
    _fn_cache: Dict[str, set] = {}

    # Device metadata cache (category + gateway_id used for IR AC routing).
    _meta_cache: Dict[str, Dict[str, Any]] = {}

    # ---- IR (infrared_ac) mappings for the scene endpoint ---------------------
    # Our internal enums → Tuya IR AC scene integer values.
    _IR_MODE_MAP = {
        "cold": 0, "cool": 0,
        "hot": 1, "heat": 1,
        "auto": 2,
        "wind": 3, "fan": 3, "wind_dry": 3,
        "wet": 4, "dry": 4, "dehumidification": 4,
    }
    _IR_WIND_MAP = {
        "auto": 0,
        "low": 1, "1": 1,
        "mid": 2, "medium": 2, "2": 2,
        "high": 3, "3": 3, "4": 3,
    }

    async def _device_meta(self, device_id: str) -> Dict[str, Any]:
        """Return (cached) device metadata — used to route IR ACs to the
        special /v2.0/infrareds/… endpoint instead of the /commands path."""
        if device_id in self._meta_cache:
            return self._meta_cache[device_id]
        try:
            meta = await self.get_device(device_id) or {}
        except Exception as e:
            logger.warning("Tuya get_device meta failed for %s: %s", device_id, e)
            meta = {}
        self._meta_cache[device_id] = meta
        return meta

    def _to_ir_body(self, commands: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Translate generic DP commands into an IR AC scene body.

        Output keys (Tuya IR AC scene endpoint):
          - power  0=off 1=on   (mandatory)
          - mode   0=cool 1=heat 2=auto 3=fan 4=dry
          - temp   16..30 °C
          - wind   0=auto 1=low 2=med 3=high
        """
        body: Dict[str, Any] = {}
        power_set = False
        for c in commands:
            code = c["code"]
            val = c["value"]
            if code in ("switch", "switch_1", "power"):
                body["power"] = 1 if bool(val) else 0
                power_set = True
            elif code in ("temp_set", "temp", "temperature_set", "temp_value"):
                try:
                    body["temp"] = int(val)
                except (TypeError, ValueError):
                    pass
            elif code in ("mode", "work_mode", "mode_enum"):
                m = self._IR_MODE_MAP.get(str(val).lower())
                if m is not None:
                    body["mode"] = m
            elif code in ("fan_speed_enum", "fan_speed", "fan", "wind_speed"):
                w = self._IR_WIND_MAP.get(str(val).lower())
                if w is not None:
                    body["wind"] = w
        # 'power' is mandatory for the scene endpoint. If the batch only carries
        # setpoint changes (e.g. temp), assume the user wants the A/C ON.
        if not power_set:
            body["power"] = 1
        return body

    async def _send_ir_ac(self, gateway_id: str, remote_id: str,
                          commands: List[Dict[str, Any]]) -> bool:
        """Send commands to an A/C via its IR bridge using the scene endpoint."""
        body = self._to_ir_body(commands)
        path = (f"/v2.0/infrareds/{gateway_id}/air-conditioners/"
                f"{remote_id}/scenes/command")
        logger.info("Tuya IR AC: gateway=%s remote=%s body=%s",
                    gateway_id, remote_id, body)
        # Tuya's IR scene endpoint returns success=true with an empty result
        # on success — treat any non-error response as OK.
        try:
            await self._request("POST", path, body=body)
            return True
        except TuyaError as e:
            # 28841101 → the Cloud Project has not subscribed to the "Universal
            # Infrared" API service. Enrich the message with actionable steps.
            if e.code == 28841101:
                raise TuyaError(
                    e.code,
                    "El proyecto Tuya Cloud no tiene habilitada la API "
                    "\"Universal Infrared\" (necesaria para A/Cs por IR). "
                    "Entra a iot.tuya.com → Cloud → Development → tu Proyecto → "
                    "Service API → Add → busca \"Industry Basic Service\" o "
                    "\"IR Control Hub\" y suscríbete (es gratis). Luego intenta "
                    "de nuevo.",
                )
            # If power=1 fails because A/C had no baseline scene, retry with the
            # PowerOn single-command endpoint as a last resort.
            if e.code in (2007, 2008) and body.get("power") == 1:
                single_path = (f"/v2.0/infrareds/{gateway_id}/air-conditioners/"
                               f"{remote_id}/command")
                try:
                    await self._request("POST", single_path,
                                        body={"code": "PowerOn", "value": "PowerOn"})
                    return True
                except TuyaError:
                    pass
            if e.code in (2007, 2008) and body.get("power") == 0:
                single_path = (f"/v2.0/infrareds/{gateway_id}/air-conditioners/"
                               f"{remote_id}/command")
                try:
                    await self._request("POST", single_path,
                                        body={"code": "PowerOff", "value": "PowerOff"})
                    return True
                except TuyaError:
                    pass
            raise

    async def _supported_codes(self, device_id: str) -> set:
        """Return the set of DP codes this device advertises via /functions."""
        if device_id in self._fn_cache:
            return self._fn_cache[device_id]
        try:
            fns = await self.get_functions(device_id)
            fn_list = fns.get("functions") if isinstance(fns, dict) else fns
            codes = {f.get("code") for f in (fn_list or [])
                     if isinstance(f, dict) and f.get("code")}
            self._fn_cache[device_id] = codes
            return codes
        except Exception as e:
            logger.warning("Tuya get_functions failed for %s: %s", device_id, e)
            self._fn_cache[device_id] = set()
            return set()

    def _remap_batch(self, commands: List[Dict[str, Any]],
                     supported: set) -> Optional[List[Dict[str, Any]]]:
        """Rewrite each command's code to one supported by the device.

        Returns the remapped batch, or None if nothing had to change (i.e.
        the caller should NOT retry — the codes were already correct)."""
        if not supported:
            return None
        remapped = []
        changed = False
        for c in commands:
            code = c["code"]
            if code in supported:
                remapped.append(c)
                continue
            alt = next((a for a in self._ALIASES.get(code, []) if a in supported), None)
            if alt:
                remapped.append({"code": alt, "value": c["value"]})
                changed = True
            else:
                # Nothing matches — keep the original so Tuya returns a
                # coherent error for the caller.
                remapped.append(c)
        return remapped if changed else None

    async def send_commands(self, device_id: str, commands: List[Dict[str, Any]]) -> bool:
        """Send one or more commands to a device.

        Each command: `{"code": "<dp_code>", "value": <bool|int|str>}`
        Common A/C codes:
          - switch (bool)
          - temp_set / temp (int, °C)
          - mode (str: "cold" | "hot" | "wet" | "wind" | "auto")
          - fan_speed_enum / fan (str: "low" | "mid" | "high" | "auto")

        Strategy:
          1. POST /v1.0/devices/{id}/commands  (original codes)
          2. POST /v1.0/iot-03/devices/{id}/commands  (original codes)
          3. Fetch the device's real DP codes via /functions and remap the
             entire batch (e.g. temp_set → temp, fan_speed_enum → fan for
             infrared_ac categories), then retry on both endpoints.

        Errors that trigger the fallback: 1108/1109 (param invalid) and 2008
        (command not supported).
        """
        # 0. Route IR A/Cs (category=infrared_ac) to the dedicated IR endpoint.
        # The generic /commands path returns 1109 for infrared_ac devices because
        # they don't accept raw DP codes — Tuya requires
        # /v2.0/infrareds/{gateway_id}/air-conditioners/{remote_id}/scenes/command.
        meta = await self._device_meta(device_id)
        if (meta.get("category") or "").lower() == "infrared_ac":
            gateway_id = meta.get("gateway_id") or meta.get("owner_id")
            if gateway_id:
                return await self._send_ir_ac(gateway_id, device_id, commands)
            logger.warning("Tuya: infrared_ac %s has no gateway_id — falling "
                           "back to /commands (will likely fail)", device_id)

        body = {"commands": commands}
        path_primary = f"/v1.0/devices/{device_id}/commands"
        path_iot03 = f"/v1.0/iot-03/devices/{device_id}/commands"
        RETRY_CODES = (1108, 1109, 2008)

        # 1. Try primary endpoint
        try:
            result = await self._request("POST", path_primary, body=body)
            if result:
                return True
            original: Optional[TuyaError] = None
        except TuyaError as e:
            if e.code not in RETRY_CODES:
                raise
            original = e

        # 2. Try iot-03 endpoint
        try:
            result = await self._request("POST", path_iot03, body=body)
            if result:
                logger.info("Tuya: %s recovered via /iot-03 endpoint", device_id)
                return True
        except TuyaError as e:
            if e.code not in RETRY_CODES:
                raise
            if original is None:
                original = e

        # 3. Remap the whole batch based on the device's real DP codes
        supported = await self._supported_codes(device_id)
        remapped = self._remap_batch(commands, supported)
        if remapped:
            logger.info("Tuya remap %s: %s → %s (supported=%s)",
                        device_id,
                        [c["code"] for c in commands],
                        [c["code"] for c in remapped],
                        sorted(supported))
            for path in (path_primary, path_iot03):
                try:
                    result = await self._request("POST", path, body={"commands": remapped})
                    if result:
                        logger.info("Tuya: %s recovered via remap on %s", device_id, path)
                        return True
                except TuyaError as e:
                    if e.code not in RETRY_CODES:
                        raise
                    if original is None:
                        original = e

        # All retries failed → surface the most informative error
        if original:
            raise original
        return False

    async def get_functions(self, device_id: str) -> Dict[str, Any]:
        """List the DP codes / functions this specific device supports."""
        return await self._request("GET", f"/v1.0/devices/{device_id}/functions")

    async def rename_device(self, device_id: str, name: str) -> bool:
        body = {"name": name}
        result = await self._request("PUT", f"/v1.0/iot-03/devices/{device_id}", body=body)
        return bool(result)

    async def delete_device(self, device_id: str) -> bool:
        result = await self._request("DELETE", f"/v1.0/iot-03/devices/{device_id}")
        return bool(result)

    async def create_pairing_token(self, uid: Optional[str] = None) -> Dict[str, Any]:
        """Genera un token de pairing (10 min de validez) que el usuario ingresa
        en la app Smart Life para vincular un dispositivo directamente a este
        Cloud Project. Endpoint: POST /v1.3/iot-03/access/register-tokens.
        """
        body: Dict[str, Any] = {}
        if uid:
            body["uid"] = uid
        return await self._request("POST", "/v1.3/iot-03/access/register-tokens", body=body)

    async def device_exists(self, device_id: str) -> Dict[str, Any]:
        """Verifica que un device_id exista en este project y devuelve su metadata."""
        return await self._request("GET", f"/v1.1/iot-03/devices/{device_id}")
