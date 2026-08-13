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

        Uses the v1.3 project-scoped endpoint. Returns Tuya's raw device dicts,
        each containing at least: id, name, product_name, category, online, ip,
        time_zone, active_time, update_time.
        """
        # v1.3 endpoint (project-scoped, most stable)
        path = "/v1.3/iot-03/devices"
        query = {"page_size": page_size, "source_type": "tuyaUser"}
        try:
            result = await self._request("GET", path, query=query)
        except TuyaError as e:
            # Some accounts only expose v1.0 — fall back to /users list
            if e.code in (1106, 28841105, 2007):
                # fall back to the legacy user devices path
                path = "/v1.0/iot-01/associated-users/devices"
                result = await self._request("GET", path, query={"size": page_size})
            else:
                raise
        # normalize: result may be {"list": [...], "total": ...} or a bare list
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            for key in ("list", "devices", "records"):
                v = result.get(key)
                if isinstance(v, list):
                    return v
        return []

    async def get_device(self, device_id: str) -> Dict[str, Any]:
        """Return device metadata (name, product, online, model, category)."""
        return await self._request("GET", f"/v1.1/iot-03/devices/{device_id}")

    async def get_status(self, device_id: str) -> List[Dict[str, Any]]:
        """Return live status list `[{"code": "switch", "value": true}, ...]`."""
        result = await self._request("GET", f"/v1.0/iot-03/devices/{device_id}/status")
        return result if isinstance(result, list) else []

    async def send_commands(self, device_id: str, commands: List[Dict[str, Any]]) -> bool:
        """Send one or more commands to a device.

        Each command: `{"code": "<dp_code>", "value": <bool|int|str>}`
        Common A/C codes:
          - switch (bool)
          - temp_set (int, °C)
          - mode (str: "cold" | "hot" | "wet" | "wind" | "auto")
          - fan_speed_enum (str: "low" | "mid" | "high" | "auto")
        """
        body = {"commands": commands}
        result = await self._request("POST", f"/v1.0/iot-03/devices/{device_id}/commands", body=body)
        # Tuya returns `true` on success (bare bool)
        return bool(result)

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
