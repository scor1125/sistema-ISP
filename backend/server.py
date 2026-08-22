from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import asyncio
import logging
import uuid
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any, Literal, Dict
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, status, UploadFile, File
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
from pydantic import BaseModel, Field, EmailStr, model_validator

# ---------- DB ----------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

# ---------- App ----------
app = FastAPI(title="ISP CRM API")
api = APIRouter(prefix="/api")

# ---------- Config ----------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALG = "HS256"
ACCESS_TTL = timedelta(hours=12)
COOKIE_PATH = os.environ.get("COOKIE_PATH", "/")
# Distinct cookie names per deployment. Two deployments on the same host would
# otherwise both send a cookie named "access_token" (the browser sends every
# same-name cookie whose path matches, so a path-scoped cookie does NOT prevent
# the collision) and whichever one the server parses last wins — producing
# "Token inválido" when it was signed with the other deployment's JWT_SECRET.
COOKIE_SUFFIX = os.environ.get("COOKIE_SUFFIX", "")
ACCESS_COOKIE = f"access_token{COOKIE_SUFFIX}"
PORTAL_COOKIE = f"portal_token{COOKIE_SUFFIX}"

# Credenciales de un equipo que nunca deben viajar al navegador. Se muestran
# una sola vez, al generar el script de vinculación.
DEVICE_SECRET_FIELDS = ("api_password", "api_password_enc", "vpn_password", "vpn_password_enc")
# Igual que en dispositivos: la clave compartida de una VPN no tiene por qué
# viajar al navegador solo para pintar la lista de conexiones.
VPN_SECRET_FIELDS = ("preshared_key", "preshared_key_enc")
DEVICE_SECRET_PROJECTION = {f: 0 for f in DEVICE_SECRET_FIELDS}


def _secret_key() -> bytes:
    """Clave AES para cifrar credenciales en reposo. Se puede fijar con
    CREDENTIALS_ENCRYPTION_KEY (32 bytes en base64); si no, se deriva de
    JWT_SECRET para que el cifrado funcione sin configuración extra."""
    import base64
    import hashlib
    raw = os.environ.get("CREDENTIALS_ENCRYPTION_KEY", "").strip()
    if raw:
        try:
            key = base64.b64decode(raw)
            if len(key) == 32:
                return key
        except Exception:
            pass
        logger.warning("CREDENTIALS_ENCRYPTION_KEY inválida (se esperan 32 bytes en base64); se deriva de JWT_SECRET")
    return hashlib.sha256(f"device-credentials::{JWT_SECRET}".encode()).digest()


def encrypt_secret(plaintext: str) -> str:
    """AES-256-GCM. Devuelve 'v1:<base64(nonce|ciphertext|tag)>'."""
    if not plaintext:
        return ""
    import base64
    import secrets as _secrets
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = _secrets.token_bytes(12)
    blob = nonce + AESGCM(_secret_key()).encrypt(nonce, plaintext.encode(), None)
    return "v1:" + base64.b64encode(blob).decode()


def decrypt_secret(blob: str) -> str:
    if not blob:
        return ""
    if not blob.startswith("v1:"):
        return blob  # documento antiguo, guardado en claro antes de cifrar
    import base64
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    try:
        raw = base64.b64decode(blob[3:])
        return AESGCM(_secret_key()).decrypt(raw[:12], raw[12:], None).decode()
    except Exception:
        logger.error("no se pudo descifrar una credencial guardada")
        return ""


def device_secret(device: dict, field: str) -> str:
    """Lee una credencial del equipo aceptando los dos formatos: el cifrado
    nuevo (`<campo>_enc`) y el texto plano de documentos anteriores."""
    enc = device.get(f"{field}_enc")
    if enc:
        return decrypt_secret(enc)
    return device.get(field) or ""

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("isp_crm")

# ---------- Utilities ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def new_id() -> str:
    return str(uuid.uuid4())

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + ACCESS_TTL,
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def create_portal_token(client_id: str, phone: str) -> str:
    payload = {
        "sub": client_id, "phone": phone,
        "exp": datetime.now(timezone.utc) + timedelta(days=30),
        "type": "portal",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

async def get_portal_client(request: Request) -> dict:
    token = request.cookies.get(PORTAL_COOKIE)
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "Portal no autenticado")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token portal inválido")
    if payload.get("type") != "portal":
        raise HTTPException(401, "Token no es de portal")
    client = await db.clients.find_one({"id": payload["sub"]}, {"_id": 0, "portal_pin_hash": 0})
    if not client:
        raise HTTPException(401, "Cliente ya no existe")
    return client

async def generate_portal_pin(max_attempts: int = 50) -> str:
    """Generate an 8-digit portal PIN unique across all existing clients.

    We check uniqueness against both the new plain-text `portal_pin` field
    (fast, indexed) and the legacy bcrypt `portal_pin_hash` field so we never
    hand out a colliding PIN during the transition period.
    """
    import secrets

    # Preload existing plain PINs for O(1) collision check
    existing: set[str] = set()
    async for doc in db.clients.find(
        {"portal_pin": {"$exists": True, "$ne": None}},
        {"portal_pin": 1, "_id": 0},
    ):
        p = doc.get("portal_pin")
        if p:
            existing.add(str(p))

    for _ in range(max_attempts):
        pin = f"{secrets.randbelow(10**8):08d}"
        if pin in existing:
            continue
        # Also cross-check against any legacy bcrypt hashes still around
        collision = False
        async for doc in db.clients.find({"portal_pin_hash": {"$exists": True}}, {"portal_pin_hash": 1, "_id": 0}):
            h = doc.get("portal_pin_hash")
            if h and verify_password(pin, h):
                collision = True
                break
        if not collision:
            return pin
    raise HTTPException(500, "No se pudo generar un PIN único; contacta soporte.")


async def next_contract_number() -> int:
    """Próximo número de contrato: sube de 1 en 1 y nunca se reutiliza, ni
    aunque se borre el cliente que lo tenía — es un contador aparte, no un
    conteo de clientes vivos. `find_one_and_update` con upsert es atómico en
    Mongo, así que dos altas al mismo tiempo nunca chocan en el mismo número.
    """
    doc = await db.counters.find_one_and_update(
        {"_id": "client_contract_number"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return doc["seq"]

async def _enforce_time_restrictions(user: dict):
    """Called by get_current_user. Rejects with 401/403 when the user is
    outside their allowed access window. Owners/admins bypass all checks."""
    role = user.get("role")
    if role in ("owner", "admin"):
        return
    tr = user.get("time_restrictions") or {}
    if not tr:
        return

    now = datetime.now(timezone.utc)

    expires_at = tr.get("expires_at")
    if expires_at:
        try:
            exp = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            if now > exp:
                # Auto-deactivate so future logins are rejected too
                await db.users.update_one({"id": user["id"]}, {"$set": {"active": False}})
                raise HTTPException(401, "Cuenta expirada")
        except ValueError:
            pass

    allowed_days = tr.get("allowed_days")
    if allowed_days:
        # weekday()  Mon=0..Sun=6 → convert to Sun=0..Sat=6 so it matches the UI
        dow_python = now.weekday()
        dow_ui = (dow_python + 1) % 7
        if dow_ui not in allowed_days:
            raise HTTPException(403, "Acceso restringido: día no permitido para tu cuenta")

    hs = tr.get("allowed_hours_start")
    he = tr.get("allowed_hours_end")
    if hs is not None and he is not None:
        h = now.hour
        if hs <= he:
            # normal same-day range
            if not (hs <= h < he):
                raise HTTPException(403, f"Acceso restringido: fuera del horario permitido ({hs:02d}:00 – {he:02d}:00)")
        else:
            # wraparound (e.g. 22 → 06)
            if not (h >= hs or h < he):
                raise HTTPException(403, f"Acceso restringido: fuera del horario permitido ({hs:02d}:00 – {he:02d}:00)")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "No autenticado")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Token inválido")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "Usuario no existe")
    if user.get("active") is False:
        raise HTTPException(401, "Cuenta inactiva")
    await _enforce_time_restrictions(user)
    return user


def require_permission(module: str, action: str):
    """Dependency factory — asserts the caller has a specific module.action bit.

    Owners and admins always pass. Other roles are checked against the
    per-user permissions dict (falling back to role defaults if missing)."""
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        role = user.get("role")
        if role in ("owner", "admin"):
            return user
        perms = user.get("permissions") or default_perms_for(role)
        mod = perms.get(module) or {}
        if not mod.get(action, False):
            raise HTTPException(403, f"Permiso denegado: requiere {module}.{action}")
        return user
    return _dep

def require_roles(*roles):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(403, "Permiso denegado")
        return user
    return _dep

# ---------- Models ----------
Role = Literal["owner", "admin", "technician", "secretary", "cobrador"]

# Modules exposed to the permission editor. Each maps to actual API endpoint
# handlers via require_permission() below.
PERMISSION_MODULES = ("clients", "lugares", "plans", "promesas", "payments")
PERMISSION_ACTIONS = ("read", "write", "delete")

# Default per-role permissions matrix. Owner/admin bypass all checks; the map
# only matters for less-privileged roles that are constrained by default.
DEFAULT_PERMISSIONS_BY_ROLE = {
    "owner":      {m: {"read": True,  "write": True,  "delete": True}  for m in PERMISSION_MODULES},
    "admin":      {m: {"read": True,  "write": True,  "delete": True}  for m in PERMISSION_MODULES},
    "technician": {m: {"read": True,  "write": False, "delete": False} for m in PERMISSION_MODULES},
    "secretary":  {"clients":  {"read": True,  "write": True,  "delete": False},
                   "lugares":  {"read": True,  "write": False, "delete": False},
                   "plans":    {"read": True,  "write": False, "delete": False},
                   "promesas": {"read": True,  "write": True,  "delete": False},
                   "payments": {"read": True,  "write": True,  "delete": False}},
    "cobrador":   {"clients":  {"read": True,  "write": False, "delete": False},   # only name/phone to pick client
                   "lugares":  {"read": False, "write": False, "delete": False},
                   "plans":    {"read": False, "write": False, "delete": False},
                   "promesas": {"read": False, "write": False, "delete": False},
                   "payments": {"read": False, "write": True,  "delete": False}},  # ← only add new payments
}

def default_perms_for(role: str) -> dict:
    base = DEFAULT_PERMISSIONS_BY_ROLE.get(role, DEFAULT_PERMISSIONS_BY_ROLE["technician"])
    # Deep copy so callers don't mutate the shared template
    return {m: dict(base.get(m, {"read": False, "write": False, "delete": False})) for m in PERMISSION_MODULES}


class LoginIn(BaseModel):
    email: EmailStr
    password: str

class ModulePerms(BaseModel):
    read: bool = False
    write: bool = False
    delete: bool = False

class UserPermissions(BaseModel):
    clients:  Optional[ModulePerms] = None
    lugares:  Optional[ModulePerms] = None
    plans:    Optional[ModulePerms] = None
    promesas: Optional[ModulePerms] = None
    payments: Optional[ModulePerms] = None

class UserTimeRestrictions(BaseModel):
    ttl_hours: Optional[float] = None            # counts from created_at
    expires_at: Optional[str] = None             # ISO — computed from ttl_hours OR set explicitly
    allowed_days: Optional[List[int]] = None     # 0=Sun..6=Sat (empty/None = all days)
    allowed_hours_start: Optional[int] = None    # 0-23 inclusive
    allowed_hours_end: Optional[int] = None      # 0-24 exclusive (24 == end of day)

class UserCreate(BaseModel):
    email: EmailStr
    name: str
    role: Role = "technician"
    password: str
    phone: Optional[str] = None
    permissions: Optional[UserPermissions] = None
    time_restrictions: Optional[UserTimeRestrictions] = None

class RegisterIn(BaseModel):
    email: EmailStr
    name: str
    password: str
    phone: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Role] = None
    phone: Optional[str] = None
    password: Optional[str] = None
    active: Optional[bool] = None
    permissions: Optional[UserPermissions] = None
    time_restrictions: Optional[UserTimeRestrictions] = None

class PermissionsPatchIn(BaseModel):
    permissions: UserPermissions

class TimeRestrictionsPatchIn(BaseModel):
    time_restrictions: UserTimeRestrictions

class PlanIn(BaseModel):
    name: str
    upload_mbps: int
    download_mbps: int
    price: float
    install_price: Optional[float] = 0
    description: Optional[str] = ""
    active: bool = True
    # Ráfaga (burst): por un tiempo corto el cliente puede navegar más rápido
    # que su velocidad contratada, mientras el promedio se mantenga bajo. Útil
    # para que cargas de páginas/streaming arranquen más fluidas sin subirle
    # la velocidad contratada de forma permanente.
    burst_enabled: bool = False
    burst_upload_mbps: Optional[int] = None
    burst_download_mbps: Optional[int] = None
    # % de la velocidad normal por debajo del cual se permite la ráfaga.
    burst_threshold_percent: Optional[int] = 80
    # Ventana (segundos) sobre la que se calcula el promedio para decidir si
    # la ráfaga sigue permitida — no es "cuánto dura la ráfaga".
    burst_time_seconds: Optional[int] = 8

class NapBoxIn(BaseModel):
    name: str
    lat: float
    lng: float
    port_type: Literal["1x2","1x4","1x8","1x16","1x32"] = "1x16"
    capacity: int = 16
    used_ports: Optional[int] = 0
    color: Optional[str] = "#ef4444"
    address: Optional[str] = ""
    notes: Optional[str] = ""

    @model_validator(mode="after")
    def _derive_capacity(self):
        cap_map = {"1x2": 2, "1x4": 4, "1x8": 8, "1x16": 16, "1x32": 32}
        self.capacity = cap_map.get(self.port_type, 16)
        return self

class ClientIn(BaseModel):
    full_name: str
    dni: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    community: Optional[str] = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    plan_id: Optional[str] = None
    nap_box_id: Optional[str] = None
    payment_day: int = Field(ge=1, le=31, default=1)
    onu_serial: Optional[str] = ""
    ip_address: Optional[str] = ""
    mikrotik_server: Optional[str] = ""
    mikrotik_interface: Optional[str] = ""
    # Cómo se conecta este cliente al Mikrotik:
    #   "queue" — IP fija + Simple Queue (lo que ya sincroniza el CRM solo).
    #   "pppoe" — usuario/contraseña PPPoE; el límite de velocidad va en el
    #             perfil PPP del router, no en una queue por IP.
    connection_mode: Literal["queue", "pppoe"] = "queue"
    pppoe_user: Optional[str] = ""
    pppoe_password: Optional[str] = ""
    # Perfil PPP a usar (elegido de los que ya existen en el router). Vacío =
    # el CRM administra uno propio según la velocidad del plan.
    pppoe_profile: Optional[str] = ""
    wifi_ssid: Optional[str] = ""
    wifi_password: Optional[str] = ""
    tag: Optional[str] = ""
    installer_id: Optional[str] = None
    installer_ids: Optional[List[str]] = []
    vlan: Optional[int] = None
    onu_mac: Optional[str] = ""
    status: Literal["active","suspended","offline","new"] = "new"
    notes: Optional[str] = ""

class ClientUpdate(BaseModel):
    full_name: Optional[str] = None
    dni: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    community: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    plan_id: Optional[str] = None
    nap_box_id: Optional[str] = None
    payment_day: Optional[int] = None
    onu_serial: Optional[str] = None
    ip_address: Optional[str] = None
    mikrotik_server: Optional[str] = None
    mikrotik_interface: Optional[str] = None
    connection_mode: Optional[Literal["queue", "pppoe"]] = None
    pppoe_user: Optional[str] = None
    pppoe_password: Optional[str] = None
    pppoe_profile: Optional[str] = None
    wifi_ssid: Optional[str] = None
    wifi_password: Optional[str] = None
    tag: Optional[str] = None
    installer_id: Optional[str] = None
    installer_ids: Optional[List[str]] = None
    vlan: Optional[int] = None
    onu_mac: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None

class PaymentIn(BaseModel):
    client_id: str
    amount: float
    method: Literal["cash","transfer","stripe","other"] = "cash"
    concept: Optional[str] = "Mensualidad"
    notes: Optional[str] = ""
    is_promise: bool = False
    promise_date: Optional[str] = None
    extension_days: Optional[int] = None
    invoice_number: Optional[str] = None

class BulkDeleteIn(BaseModel):
    ids: List[str]

class LeadIn(BaseModel):
    full_name: str
    phone: str
    address: Optional[str] = ""
    lat: Optional[float] = None
    lng: Optional[float] = None
    type: Literal["installation","slowness","password_change","address_change","other"] = "installation"
    status: Literal["new","in_progress","done","cancelled"] = "new"
    notes: Optional[str] = ""
    assigned_to: Optional[str] = None

class ExtraServiceIn(BaseModel):
    name: str
    category: Literal["iptv","phone","extra_mbps","backup_power","other"] = "other"
    price: float
    description: Optional[str] = ""
    active: bool = True

class WhatsAppMessageIn(BaseModel):
    client_id: Optional[str] = None
    phone: str
    body: str
    direction: Literal["outgoing","incoming"] = "outgoing"
    kind: Literal["reminder","maintenance","chat","other"] = "chat"
    channel: Literal["whatsapp","telegram"] = "whatsapp"

class WhatsAppConfigIn(BaseModel):
    provider: Literal["simulated","baileys","evolution","waha","wasenderapi","custom"] = "simulated"
    base_url: Optional[str] = ""     # e.g. https://my-baileys.example.com
    api_key: Optional[str] = ""      # sent as Authorization: Bearer / apikey header
    instance: Optional[str] = ""     # instance/session name (Evolution/WAHA)
    webhook_token: Optional[str] = ""  # shared secret required on inbound webhook

class WhatsAppFunnelIn(BaseModel):
    name: str
    color: Optional[str] = "#f59e0b"
    order: Optional[int] = 0
    is_default: Optional[bool] = False

class WhatsAppFunnelUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    order: Optional[int] = None

class WhatsAppConversationUpdate(BaseModel):
    funnel_id: Optional[str] = None
    assigned_to: Optional[str] = None  # user id
    tags: Optional[List[str]] = None
    notes: Optional[str] = None

class WhatsAppWebhookIn(BaseModel):
    phone: str
    body: str
    client_id: Optional[str] = None
    direction: Literal["outgoing","incoming"] = "incoming"
    provider_message_id: Optional[str] = None
    sender_name: Optional[str] = None

class TaskIn(BaseModel):
    title: str
    description: Optional[str] = ""
    stage: Literal["backlog","today","in_progress","done"] = "backlog"
    assigned_to: Optional[str] = None
    client_id: Optional[str] = None
    due_date: Optional[str] = None

class PersonalNoteIn(BaseModel):
    title: str
    body: Optional[str] = ""
    color: Optional[str] = "default"
    pinned: bool = False
    done: bool = False

class PersonalNoteUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    color: Optional[str] = None
    pinned: Optional[bool] = None
    done: Optional[bool] = None

class DeviceIn(BaseModel):
    name: str
    kind: Literal["olt","mikrotik"] = "olt"
    host: str
    port: Optional[int] = None
    username: Optional[str] = ""
    connection: Literal["public_ip","vpn"] = "public_ip"
    location: Optional[str] = ""
    notes: Optional[str] = ""
    # --- Mikrotik wizard extras ---
    vpn_protocol: Optional[Literal["wireguard","l2tp","openvpn"]] = None
    ros_version: Optional[Literal["v6","v7"]] = None  # dialecto OpenVPN del router
    vpn_user: Optional[str] = ""
    vpn_password: Optional[str] = ""
    vpn_public_key: Optional[str] = ""  # router pubkey when WG
    api_enabled: Optional[bool] = False
    api_user: Optional[str] = ""
    api_password: Optional[str] = ""
    api_port: Optional[int] = 8728
    api_use_ssl: Optional[bool] = False
    management_modes: Optional[List[Literal["ppp","queues"]]] = []
    interfaces: Optional[List[str]] = None  # e.g., ["ether1","bridge","pppoe-out1"]
    # --- REST API (Mikrotik RouterOS v7+) ---
    rest_api_url: Optional[str] = ""       # e.g. https://10.100.0.2  (no trailing /)
    rest_verify_ssl: Optional[bool] = False  # RouterOS usa cert self-signed por default
    # --- OLT SNMP (VSol EPON/GPON, Huawei, ZTE, etc.) ---
    snmp_enabled: Optional[bool] = False
    snmp_community: Optional[str] = "public"
    snmp_version: Optional[Literal["2c", "v3"]] = "2c"
    snmp_port: Optional[int] = 161
    snmp_timeout: Optional[int] = 3
    olt_vendor: Optional[Literal["vsol_epon", "vsol_gpon", "huawei", "zte", "fiberhome", "cdata", "bdcom", "custom"]] = "vsol_epon"
    snmp_oids_override: Optional[dict] = None  # advanced: override default OID map

class VpnConnectionIn(BaseModel):
    name: str
    protocol: Literal["wireguard","openvpn","l2tp","ipsec"] = "wireguard"
    mikrotik_id: Optional[str] = None
    remote_host: str
    remote_port: int = 51820
    username: Optional[str] = ""
    preshared_key: Optional[str] = ""
    allowed_ips: Optional[str] = "0.0.0.0/0"
    dns: Optional[str] = "1.1.1.1"
    active: bool = True

class ArqueoIn(BaseModel):
    date_from: str  # ISO date YYYY-MM-DD
    date_to: str    # ISO date YYYY-MM-DD (inclusive)
    payment_ids: List[str]
    total_amount: float
    methods: Optional[List[str]] = []
    user_filter_id: Optional[str] = None
    user_filter_name: Optional[str] = ""
    notes: Optional[str] = ""

class LugarIn(BaseModel):
    name: str
    notes: Optional[str] = ""
    color: Optional[str] = "#38bdf8"

class LugarUpdate(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None

class TrabajadorIn(BaseModel):
    full_name: str
    role: Literal["technician","installer","secretary","supervisor","other"] = "technician"
    phone: Optional[str] = ""
    email: Optional[str] = ""
    community: Optional[str] = ""       # Zona / comunidad asignada
    hire_date: Optional[str] = None     # YYYY-MM-DD
    daily_rate: Optional[float] = None
    active: bool = True
    notes: Optional[str] = ""
    user_id: Optional[str] = None       # Vincular a usuario del sistema (opcional)
    work_days: Optional[List[str]] = []  # ISO dates (YYYY-MM-DD) trabajado

class PortalLoginIn(BaseModel):
    pin: str
    phone: Optional[str] = None  # legacy — kept for backwards-compat, ignored when None

class PortalPaymentUploadMeta(BaseModel):
    amount: Optional[float] = None
    method: Optional[Literal["cash","transfer","other"]] = "transfer"
    notes: Optional[str] = ""

class ReminderConfigIn(BaseModel):
    template: Optional[str] = None
    days_before: Optional[int] = None
    auto_send: Optional[bool] = None
    active_hours_start: Optional[int] = None  # 0-23
    active_hours_end: Optional[int] = None

class ReminderSendIn(BaseModel):
    client_ids: List[str]
    template: Optional[str] = None            # override the saved template
    kind: Literal["reminder","chat","other"] = "reminder"

class TrabajadorUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[Literal["technician","installer","secretary","supervisor","other"]] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    community: Optional[str] = None
    hire_date: Optional[str] = None
    daily_rate: Optional[float] = None
    active: Optional[bool] = None
    notes: Optional[str] = None
    user_id: Optional[str] = None

class BusinessConfigIn(BaseModel):
    business_name: Optional[str] = ""
    legal_name: Optional[str] = ""
    address: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    tax_id: Optional[str] = ""
    currency: str = "MXN"
    logo_url: Optional[str] = ""
    onu_power_high_threshold: float = -8.0
    onu_power_low_threshold: float = -27.0
    disconnect_alert_minutes: int = 30
    network_cidr: str = ""
    network_reserved: List[str] = []

# ---------- Auth Endpoints ----------
@api.post("/auth/register")
async def register(payload: RegisterIn):
    """Public self-registration. New users land as inactive `technician` so an
    owner/admin must approve them before they can log in. Duplicate email →
    400, weak password (<8) → 400."""
    if len(payload.password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres.")
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Ya existe una cuenta con ese correo.")
    doc = {
        "id": new_id(), "email": email, "name": payload.name.strip(),
        "role": "technician", "phone": (payload.phone or "").strip(),
        "password_hash": hash_password(payload.password),
        "active": False, "avatar_url": "",
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.users.insert_one(doc)
    logger.info("[auth] register email=%s (pending approval)", email)
    return {
        "ok": True,
        "message": "Cuenta creada. Un administrador debe aprobar tu acceso antes de que puedas ingresar.",
        "user": {"id": doc["id"], "email": doc["email"], "name": doc["name"], "role": doc["role"], "active": False},
    }

@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(401, "Credenciales inválidas")
    if user.get("active") is False:
        raise HTTPException(403, "Usuario desactivado")
    token = create_access_token(user["id"], user["email"], user["role"])
    _is_https = os.environ.get("PUBLIC_BASE_URL", "").lower().startswith("https")
    response.set_cookie(ACCESS_COOKIE, token, httponly=True, secure=_is_https,
                        samesite="none" if _is_https else "lax",
                        max_age=int(ACCESS_TTL.total_seconds()), path=COOKIE_PATH)
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}
    }

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(ACCESS_COOKIE, path=COOKIE_PATH)
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

MAX_AVATAR_BYTES = 2 * 1024 * 1024
ALLOWED_AVATAR_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}

@api.post("/auth/me/avatar")
async def upload_avatar(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Upload a personal avatar for the current user (PNG/JPEG/WEBP/GIF, ≤2MB)."""
    if file.content_type not in ALLOWED_AVATAR_MIME:
        raise HTTPException(400, "Formato no soportado. Usa PNG, JPEG, WEBP o GIF.")
    data = await file.read()
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(400, "La foto excede 2MB. Reduce el tamaño e inténtalo de nuevo.")
    b64 = base64.b64encode(data).decode("ascii")
    avatar_url = f"data:{file.content_type};base64,{b64}"
    await db.users.update_one({"id": user["id"]}, {"$set": {"avatar_url": avatar_url, "updated_at": now_iso()}})
    return {"avatar_url": avatar_url}

@api.delete("/auth/me/avatar")
async def delete_avatar(user: dict = Depends(get_current_user)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"avatar_url": "", "updated_at": now_iso()}})
    return {"ok": True}

# ---------- System Users ----------
@api.get("/users")
async def list_users(_: dict = Depends(get_current_user)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
    return users

@api.post("/users")
async def create_user(u: UserCreate, _: dict = Depends(require_roles("owner","admin"))):
    email = u.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email ya existe")

    now = datetime.now(timezone.utc)
    perms = (u.permissions.dict(exclude_none=False) if u.permissions else None) or default_perms_for(u.role)
    # Normalize: ensure every module has all 3 action keys
    for m in PERMISSION_MODULES:
        perms.setdefault(m, {"read": False, "write": False, "delete": False})
        for a in PERMISSION_ACTIONS:
            perms[m].setdefault(a, False)

    tr = (u.time_restrictions.dict(exclude_none=True) if u.time_restrictions else None) or {}
    if tr.get("ttl_hours") and not tr.get("expires_at"):
        tr["expires_at"] = (now + timedelta(hours=float(tr["ttl_hours"]))).isoformat()

    doc = {
        "id": new_id(), "email": email, "name": u.name, "role": u.role,
        "phone": u.phone or "", "password_hash": hash_password(u.password),
        "active": True, "created_at": now_iso(),
        "permissions": perms,
        "time_restrictions": tr or None,
    }
    await db.users.insert_one(doc)
    doc.pop("password_hash", None); doc.pop("_id", None)
    return doc

@api.patch("/users/{uid}")
async def update_user(uid: str, u: UserUpdate, _: dict = Depends(require_roles("owner","admin"))):
    updates = u.dict(exclude_none=True)
    if "password" in updates:
        updates["password_hash"] = hash_password(updates.pop("password"))
    # Recompute permissions default when role changes and permissions weren't passed
    if "role" in updates and "permissions" not in updates:
        updates["permissions"] = default_perms_for(updates["role"])
    if "time_restrictions" in updates:
        tr = updates["time_restrictions"] or {}
        if tr.get("ttl_hours") and not tr.get("expires_at"):
            existing = await db.users.find_one({"id": uid}, {"_id": 0, "created_at": 1})
            base = datetime.now(timezone.utc)
            if existing and existing.get("created_at"):
                try:
                    base = datetime.fromisoformat(existing["created_at"].replace("Z", "+00:00"))
                except Exception:
                    pass
            tr["expires_at"] = (base + timedelta(hours=float(tr["ttl_hours"]))).isoformat()
        updates["time_restrictions"] = tr or None
    if updates:
        await db.users.update_one({"id": uid}, {"$set": updates})
    doc = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    return doc

@api.patch("/users/{uid}/permissions")
async def update_user_permissions(uid: str, payload: PermissionsPatchIn,
                                  _: dict = Depends(require_roles("owner","admin"))):
    """Fine-grained switch update for a single user's module permissions."""
    perms = payload.permissions.dict(exclude_none=False)
    # Normalize
    for m in PERMISSION_MODULES:
        perms.setdefault(m, {"read": False, "write": False, "delete": False})
        for a in PERMISSION_ACTIONS:
            perms[m].setdefault(a, False)
    r = await db.users.update_one({"id": uid}, {"$set": {"permissions": perms, "updated_at": now_iso()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Usuario no encontrado")
    return await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})

@api.patch("/users/{uid}/time-restrictions")
async def update_user_time_restrictions(uid: str, payload: TimeRestrictionsPatchIn,
                                        _: dict = Depends(require_roles("owner","admin"))):
    tr = payload.time_restrictions.dict(exclude_none=True)
    if tr.get("ttl_hours") and not tr.get("expires_at"):
        existing = await db.users.find_one({"id": uid}, {"_id": 0, "created_at": 1})
        base = datetime.now(timezone.utc)
        if existing and existing.get("created_at"):
            try:
                base = datetime.fromisoformat(existing["created_at"].replace("Z", "+00:00"))
            except Exception:
                pass
        tr["expires_at"] = (base + timedelta(hours=float(tr["ttl_hours"]))).isoformat()
    r = await db.users.update_one({"id": uid}, {"$set": {"time_restrictions": tr or None, "updated_at": now_iso()}})
    if r.matched_count == 0:
        raise HTTPException(404, "Usuario no encontrado")
    return await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})

@api.delete("/users/{uid}")
async def delete_user(uid: str, current: dict = Depends(require_roles("owner","admin"))):
    if uid == current["id"]:
        raise HTTPException(400, "No puedes eliminar tu propia cuenta")
    await db.users.delete_one({"id": uid})
    return {"ok": True}

# ---------- Cambios pendientes de confirmar ("Aplicar Cambios") ----------
# Todo lo que se captura queda marcado como pendiente y NO surte efecto real
# hasta que el operador lo confirma desde el botón "Aplicar Cambios". Mientras
# está pendiente el registro ya vive en su colección (para que se vea en las
# listas, marcado), pero los efectos que salen del CRM — sobre todo escribir
# en el Mikrotik — se posponen hasta la confirmación.
PENDING = "_pending"

# Colecciones sujetas a confirmación, con cómo nombrar cada registro en el
# resumen que ve el operador.
STAGED_COLLECTIONS = {
    "clients":      {"label": "Clientes",          "title": "full_name"},
    "plans":        {"label": "Planes",            "title": "name"},
    "devices":      {"label": "Mikrotik / OLT",    "title": "name"},
    "payments":     {"label": "Pagos",             "title": "concept"},
    "nap_boxes":    {"label": "Cajas NAP",         "title": "name"},
    "extras":       {"label": "Servicios extras",  "title": "name"},
    "leads":        {"label": "Prospectos",        "title": "name"},
    "tasks":        {"label": "Tareas",            "title": "title"},
    "vpn_connections": {"label": "VPN",            "title": "name"},
    "lugares":      {"label": "Lugares",           "title": "name"},
    "trabajadores": {"label": "Colaboradores",     "title": "name"},
    "inventory_products": {"label": "Inventario",  "title": "name"},
    "energy_plants": {"label": "Energía",          "title": "name"},
}
# Fuera a propósito: el Mapa (guarda solo al arrastrar un nodo o reformar un
# cable, dejarlo pendiente llenaría la lista de ruido), los Usuarios del
# sistema (afecta quién puede entrar) y la Configuración global.

OP_LABEL = {"create": "Alta", "update": "Edición", "delete": "Baja"}


def _pending_meta(op: str, user: Optional[dict], prev: Optional[dict] = None) -> dict:
    meta = {
        "op": op,
        "by": (user or {}).get("id"),
        "by_name": (user or {}).get("name") or (user or {}).get("email") or "",
        "at": now_iso(),
    }
    if prev is not None:
        meta["prev"] = prev
    return meta


async def stage_create(collection: str, doc: dict, user: Optional[dict]) -> dict:
    """Inserta el registro ya marcado como alta pendiente."""
    doc[PENDING] = _pending_meta("create", user)
    await db[collection].insert_one(doc)
    doc.pop("_id", None)
    return doc


async def stage_update(collection: str, item_id: str, changes: dict,
                       user: Optional[dict]) -> Optional[dict]:
    """Aplica los cambios al documento pero lo deja marcado como pendiente,
    guardando el valor anterior de cada campo tocado para poder descartar."""
    cur = await db[collection].find_one({"id": item_id}, {"_id": 0})
    if not cur:
        return None
    prev_meta = cur.get(PENDING) or {}
    if prev_meta.get("op") == "create":
        # Sigue siendo un alta sin confirmar: descartarla borra el registro
        # completo, así que no hay valores anteriores que guardar.
        meta = prev_meta
    else:
        prev = dict(prev_meta.get("prev") or {})
        for k in changes:
            # Solo la primera vez que se toca cada campo: si se edita dos veces
            # antes de confirmar, el original sigue siendo el de la primera.
            if k not in prev:
                prev[k] = cur.get(k)
        meta = _pending_meta("update", user, prev)
    await db[collection].update_one({"id": item_id}, {"$set": {**changes, PENDING: meta}})
    return await db[collection].find_one({"id": item_id}, {"_id": 0})


async def stage_delete(collection: str, item_id: str, user: Optional[dict]) -> dict:
    """Marca la baja como pendiente. Si el registro era un alta sin confirmar,
    se borra de una vez: nunca llegó a existir para el proyecto."""
    cur = await db[collection].find_one({"id": item_id}, {"_id": 0})
    if not cur:
        return {"ok": True, "pending": False}
    if (cur.get(PENDING) or {}).get("op") == "create":
        await db[collection].delete_one({"id": item_id})
        return {"ok": True, "pending": False, "discarded": True}
    await db[collection].update_one(
        {"id": item_id}, {"$set": {PENDING: _pending_meta("delete", user)}})
    return {"ok": True, "pending": True}


def strip_pending(payload: dict) -> dict:
    """El navegador nunca debe poder escribir la marca de pendiente."""
    payload.pop(PENDING, None)
    return payload


# ---------- Generic collection helpers ----------
def crud_router(prefix: str, model_in, collection: str, extra_defaults=None,
                permission_module: Optional[str] = None,
                hidden_fields: Optional[tuple] = None,
                encrypt_fields: Optional[tuple] = None):
    """`hidden_fields` se excluye de todo lo que sale hacia el navegador: hay
    colecciones (dispositivos) que guardan credenciales que el frontend nunca
    necesita y que no deben viajar en un listado. `encrypt_fields` son campos
    que llegan en claro desde el formulario y se guardan cifrados como
    `<campo>_enc`, para no dejar contraseñas legibles en la base."""
    r = APIRouter(prefix=prefix)
    hide = {f: 0 for f in (hidden_fields or ())}

    def _protect(doc: dict) -> dict:
        for f in (encrypt_fields or ()):
            if doc.get(f):
                doc[f"{f}_enc"] = encrypt_secret(doc.pop(f))
            else:
                doc.pop(f, None)
        return doc

    def _dep(action: str):
        return Depends(require_permission(permission_module, action)) if permission_module else Depends(get_current_user)

    @r.get("")
    async def _list(_: dict = _dep("read")):
        items = await db[collection].find({}, {"_id": 0, **hide}).sort("created_at", -1).to_list(2000)
        return items

    staged = collection in STAGED_COLLECTIONS

    @r.post("")
    async def _create(payload: model_in, user: dict = _dep("write")):
        doc = _protect(strip_pending(payload.dict()))
        doc["id"] = new_id()
        doc["created_at"] = now_iso()
        doc["updated_at"] = now_iso()
        if extra_defaults:
            for k, v in extra_defaults.items():
                doc.setdefault(k, v)
        if staged:
            await stage_create(collection, doc, user)
        else:
            await db[collection].insert_one(doc)
        doc.pop("_id", None)
        for f in (hidden_fields or ()):
            doc.pop(f, None)
        return doc

    @r.patch("/{item_id}")
    async def _update(item_id: str, payload: dict, user: dict = _dep("write")):
        payload = _protect(strip_pending({k: v for k, v in payload.items() if v is not None}))
        payload["updated_at"] = now_iso()
        if staged:
            await stage_update(collection, item_id, payload, user)
        else:
            await db[collection].update_one({"id": item_id}, {"$set": payload})
        return await db[collection].find_one({"id": item_id}, {"_id": 0, **hide})

    @r.delete("/{item_id}")
    async def _delete(item_id: str, user: dict = _dep("delete")):
        if staged:
            return await stage_delete(collection, item_id, user)
        await db[collection].delete_one({"id": item_id})
        return {"ok": True}

    return r

# ---------- Plans, NAP, Extras, Leads, Tasks, Devices ----------
api.include_router(crud_router("/plans", PlanIn, "plans", permission_module="plans"))
api.include_router(crud_router("/nap-boxes", NapBoxIn, "nap_boxes"))
api.include_router(crud_router("/extras", ExtraServiceIn, "extras"))
api.include_router(crud_router("/leads", LeadIn, "leads"))
api.include_router(crud_router("/tasks", TaskIn, "tasks"))
api.include_router(crud_router("/devices", DeviceIn, "devices",
                               hidden_fields=DEVICE_SECRET_FIELDS,
                               encrypt_fields=("api_password", "vpn_password")))

# ---------- VPN helpers ----------
@api.post("/vpn/{vpn_id}/generate-config")
async def generate_vpn_config(vpn_id: str, _: dict = Depends(require_roles("owner","admin"))):
    """Generate a downloadable connection profile for the configured VPN.
    Returns a WireGuard-style .conf or OpenVPN inline config that the operator
    can drop into their Mikrotik / desktop client."""
    v = await db.vpn_connections.find_one({"id": vpn_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "VPN no encontrada")
    proto = v.get("protocol", "wireguard")
    if proto == "wireguard":
        text = (
            "[Interface]\n"
            f"# Perfil generado por NetOps CRM para {v['name']}\n"
            "PrivateKey = <RELLENAR_EN_EL_ROUTER>\n"
            f"Address = 10.100.0.2/24\n"
            f"DNS = {v.get('dns','1.1.1.1')}\n\n"
            "[Peer]\n"
            f"PublicKey = {device_secret(v, 'preshared_key') or '<PUBLIC_KEY_DEL_MIKROTIK>'}\n"
            f"Endpoint = {v['remote_host']}:{v.get('remote_port', 51820)}\n"
            f"AllowedIPs = {v.get('allowed_ips','0.0.0.0/0')}\n"
            "PersistentKeepalive = 25\n"
        )
        filename = f"{v['name'].replace(' ', '_')}.conf"
    else:
        text = (
            f"# Perfil {proto.upper()} para {v['name']}\n"
            f"remote {v['remote_host']} {v.get('remote_port', 1194)}\n"
            f"auth-user-pass\n"
            f"# Usuario: {v.get('username','')}\n"
            "cipher AES-256-CBC\nproto udp\n"
        )
        filename = f"{v['name'].replace(' ', '_')}.ovpn"
    return {"filename": filename, "config": text}

@api.get("/vpn/server-info")
async def get_vpn_server_info(request: Request, _: dict = Depends(get_current_user)):
    """Return the connection info the operator has to paste in each Mikrotik so
    the router can reach this CRM/VPN server. Persisted in `config.server_vpn`.
    Defaults are inferred from the request and env when empty."""
    doc = await db.config.find_one({"key": "server_vpn"}, {"_id": 0}) or {}
    saved = doc.get("value", {}) if isinstance(doc, dict) else {}
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    default_host = fwd or (request.client.host if request.client else "") or os.environ.get("PUBLIC_HOST", "vpn.miisp.com")
    base_api = str(request.base_url).rstrip("/")
    data = {
        "public_ip": saved.get("public_ip") or default_host,
        "public_hostname": saved.get("public_hostname") or "",
        "wireguard_port": saved.get("wireguard_port") or 51820,
        "l2tp_port": saved.get("l2tp_port") or 1701,
        "openvpn_port": saved.get("openvpn_port") or 1194,
        "server_public_key": saved.get("server_public_key") or "",
        "tunnel_network": saved.get("tunnel_network") or "10.100.0.0/24",
        "server_tunnel_ip": saved.get("server_tunnel_ip") or "10.100.0.1",
        "client_tunnel_ip": saved.get("client_tunnel_ip") or "10.100.0.2/24",
        "dns": saved.get("dns") or "1.1.1.1",
        "api_endpoint": saved.get("api_endpoint") or base_api,
        "notes": saved.get("notes") or "",
    }
    return data

@api.patch("/vpn/server-info")
async def update_vpn_server_info(payload: dict, _: dict = Depends(require_roles("owner","admin"))):
    payload = {k: v for k, v in payload.items() if v is not None}
    await db.config.update_one({"key": "server_vpn"}, {"$set": {"value": payload, "updated_at": now_iso()}}, upsert=True)
    return {"ok": True, "value": payload}

# Registrado despues de las rutas especificas /vpn/server-info: FastAPI/Starlette
# empareja por orden de registro, y una ruta generica /vpn/{vpn_id} registrada
# antes interceptaria "server-info" como si fuera un ID.
api.include_router(crud_router("/vpn", VpnConnectionIn, "vpn_connections",
                               hidden_fields=VPN_SECRET_FIELDS,
                               encrypt_fields=("preshared_key",)))

# ---------- OpenVPN: alta de routers Mikrotik ----------
# El servidor OpenVPN corre en el mismo host que este backend, con dos listeners
# en el puerto 1194 porque RouterOS 6 y 7 no hablan el mismo dialecto:
#   v6  -> TCP  + AES-256-CBC/SHA1   (v6 no soporta UDP ni AES-GCM)
#   v7  -> UDP  + AES-256-GCM        (GCM ya autentica, por eso auth=none)
# Cada router recibe usuario/contraseña propios (sin certificado de cliente) y
# una IP fija del túnel, que es la que el CRM usa luego para hablarle por la API.
OPENVPN_AUTH_FILE = Path(os.environ.get("OPENVPN_AUTH_FILE", "/etc/openvpn/auth/psw-file"))
OPENVPN_CCD_DIR = Path(os.environ.get("OPENVPN_CCD_DIR", "/etc/openvpn/ccd"))
# Rango privado (RFC1918). Ojo al cambiarlo: 172.1.x NO es privado — pertenece
# a espacio público real y romperías el acceso a esas direcciones.
OPENVPN_SUBNET = os.environ.get("OPENVPN_SUBNET", "172.16.10.")
OPENVPN_NETMASK = os.environ.get("OPENVPN_NETMASK", "255.255.255.0")
OPENVPN_PORT = int(os.environ.get("OPENVPN_PORT", "1194"))
# Serializa el alta: leer las IPs ocupadas y escribir la nueva no es atómico,
# y dos altas simultáneas podrían quedarse con la misma dirección. El candado
# va en un archivo, no en memoria: producción y el piloto son dos procesos
# distintos que comparten estos mismos archivos de OpenVPN.
OPENVPN_LOCK_FILE = Path(os.environ.get("OPENVPN_LOCK_FILE", "/etc/openvpn/.sistema-isp.lock"))


def _ovpn_locked(fn, *args):
    """Ejecuta `fn` con el candado tomado. Bloquea, así que se llama desde un
    hilo aparte para no frenar el bucle de eventos."""
    import fcntl
    with open(OPENVPN_LOCK_FILE, "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            return fn(*args)
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN)


def _ovpn_reserve(username: str, password: str, version: str) -> str:
    ip = _ovpn_allocate_ip(version, username)
    _ovpn_write_credentials(username, password, ip)
    return ip

# Ambos perfiles van por TCP contra el mismo listener y comparten todo el /24.
# La única diferencia real es cómo se llama el cifrado en cada versión:
# RouterOS 6 lo llama `aes256` y RouterOS 7 `aes256-cbc` — es el mismo.
# (Se probó UDP + AES-GCM para v7; se descartó a favor de esta combinación,
# que está verificada en campo contra routers reales.)
OPENVPN_PROFILES = {
    "v6": {
        "label": "RouterOS 6.x",
        "protocol": "tcp", "server_host": 1, "first_host": 2, "last_host": 254,
        "cipher": "aes256", "auth": "sha1",
    },
    "v7": {
        "label": "RouterOS 7.x",
        "protocol": "tcp", "server_host": 1, "first_host": 2, "last_host": 254,
        "cipher": "aes256-cbc", "auth": "sha1",
    },
}
OPENVPN_NETWORK = os.environ.get("OPENVPN_NETWORK", "172.16.10.0/24")
# Nombre de la address-list de morosos en los routers.
OVERDUE_LIST = os.environ.get("OVERDUE_LIST", "morosos")


def _ovpn_slug(name: str) -> str:
    """Usuario VPN estable derivado del nombre del router."""
    import re
    import unicodedata
    plain = unicodedata.normalize("NFD", name or "")
    plain = "".join(c for c in plain if unicodedata.category(c) != "Mn")
    slug = re.sub(r"[^a-z0-9-]", "", plain.lower().replace(" ", "-").replace("_", "-"))
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "router"


def _ovpn_random_secret(length: int = 16) -> str:
    """Contraseña solo alfanumérica: se pega dentro de un script de RouterOS,
    donde comillas, $, ; o barras romperían el comando."""
    import secrets
    import string
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _ovpn_ccd_ip(path: Path) -> Optional[str]:
    try:
        for line in path.read_text().splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[0] == "ifconfig-push":
                return parts[1]
    except OSError:
        pass
    return None


def _ovpn_allocate_ip(version: str, username: str) -> str:
    """IP libre del rango de esa versión. Si el router ya tenía una asignada,
    la conserva (re-generar el script no debe cambiarle la IP)."""
    profile = OPENVPN_PROFILES[version]
    own = OPENVPN_CCD_DIR / username
    if own.is_file():
        current = _ovpn_ccd_ip(own)
        if current and current.startswith(OPENVPN_SUBNET):
            host = int(current.rsplit(".", 1)[1])
            if profile["first_host"] <= host <= profile["last_host"]:
                return current

    taken = set()
    if OPENVPN_CCD_DIR.is_dir():
        for f in OPENVPN_CCD_DIR.iterdir():
            if f.is_file() and f.name != username:
                ip = _ovpn_ccd_ip(f)
                if ip:
                    taken.add(ip)

    for host in range(profile["first_host"], profile["last_host"] + 1):
        candidate = f"{OPENVPN_SUBNET}{host}"
        if candidate not in taken:
            return candidate
    raise HTTPException(409, f"No quedan IPs libres en el rango {version} del túnel")


def _atomic_write(path: Path, content: str, mode: int) -> None:
    """Escribe a un temporal y renombra. Un corte a media escritura dejaría el
    archivo de credenciales truncado y tumbaría el acceso de todos los routers."""
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(content)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _ovpn_write_credentials(username: str, password: str, tunnel_ip: str) -> None:
    """Registra al router en el servidor OpenVPN: contraseña en el archivo de
    auth y su IP fija en el client-config-dir."""
    import hashlib

    if not OPENVPN_AUTH_FILE.parent.is_dir() or not OPENVPN_CCD_DIR.is_dir():
        raise HTTPException(
            503,
            "Este servidor no tiene el servicio OpenVPN configurado "
            f"({OPENVPN_AUTH_FILE.parent} / {OPENVPN_CCD_DIR} no existen).",
        )

    digest = hashlib.sha256(password.encode()).hexdigest()
    try:
        existing = OPENVPN_AUTH_FILE.read_text().splitlines() if OPENVPN_AUTH_FILE.is_file() else []
        kept = [ln for ln in existing if ln.strip() and not ln.lower().startswith(f"{username.lower()}:")]
        kept.append(f"{username}:{digest}")
        _atomic_write(OPENVPN_AUTH_FILE, "\n".join(kept) + "\n", 0o640)
        # openvpn corre como `nobody` tras soltar privilegios: necesita leerlo.
        try:
            import shutil
            shutil.chown(OPENVPN_AUTH_FILE, user="root", group="nogroup")
        except (LookupError, PermissionError, OSError):
            pass

        _atomic_write(OPENVPN_CCD_DIR / username,
                      f"ifconfig-push {tunnel_ip} {OPENVPN_NETMASK}\n", 0o644)
    except OSError as e:
        raise HTTPException(500, f"No se pudo escribir la configuración de OpenVPN: {e}")


def _ovpn_remove_credentials(username: str) -> None:
    """Revoca el acceso VPN de un router (al eliminarlo del CRM)."""
    try:
        if OPENVPN_AUTH_FILE.is_file():
            kept = [
                ln for ln in OPENVPN_AUTH_FILE.read_text().splitlines()
                if ln.strip() and not ln.lower().startswith(f"{username.lower()}:")
            ]
            _atomic_write(OPENVPN_AUTH_FILE, ("\n".join(kept) + "\n") if kept else "", 0o640)
        (OPENVPN_CCD_DIR / username).unlink(missing_ok=True)
    except OSError as e:
        logger.warning("no se pudo revocar la VPN de %s: %s", username, e)


def _ros_quote(value: str) -> str:
    """Escapa un valor que se interpola en el script de RouterOS. Sin esto, un
    nombre de router con comillas o saltos de línea podría inyectar comandos."""
    return (str(value or "")
            .replace("\\", "\\\\").replace('"', '\\"')
            .replace("\r", " ").replace("\n", " "))


def _ros_ascii(value: str) -> str:
    """El terminal de RouterOS descarta los caracteres no ASCII al pegar: los
    acentos desaparecen y, si cayeran dentro de un valor, lo corromperían.
    Por eso el script se emite en ASCII puro."""
    import unicodedata
    plain = unicodedata.normalize("NFD", str(value or ""))
    plain = "".join(c for c in plain if unicodedata.category(c) != "Mn")
    return plain.encode("ascii", "replace").decode("ascii")


def _overdue_rules_lines() -> list:
    """Reglas de firewall que hacen efectivo el corte por falta de pago.

    El CRM solo mete y saca IPs de la address-list; quien corta es el router.
    Se insertan con `place-before=0` en orden inverso para que queden por
    encima de cualquier regla de accept que el router ya tenga — si quedaran
    debajo, nunca se evaluarian y el moroso seguiria navegando.
    Se permite DNS para que el cliente pueda resolver y ver una pagina de aviso
    en vez de un timeout sin explicacion.
    """
    base = f"/ip firewall filter add chain=forward src-address-list={OVERDUE_LIST}"
    corte = (f'{base} action=reject reject-with=icmp-admin-prohibited'
             f' comment="Sistema ISP mora corte"')
    dns_t = f'{base} protocol=tcp dst-port=53 action=accept comment="Sistema ISP mora dns tcp"'
    dns_u = f'{base} protocol=udp dst-port=53 action=accept comment="Sistema ISP mora dns udp"'
    out = ['/ip firewall filter remove [find comment~"Sistema ISP mora"]']
    for rule in (corte, dns_t, dns_u):      # inverso: el ultimo queda arriba
        out.append(f':do {{ {rule} place-before=0 }} on-error={{ {rule} }}')
    return out


def _ovpn_build_script(*, version: str, device_name: str, public_ip: str,
                       vpn_user: str, vpn_password: str, tunnel_ip: str,
                       api_user: str, api_password: str, api_port: int) -> str:
    """Script .rsc para pegar en el terminal del Mikrotik.

    Restricciones del terminal de RouterOS, comprobadas contra un router real —
    romperlas hace que el pegado falle a medias:
      * un comando por linea: la continuacion con `\` se corta al pegar;
      * los bloques `:do {{ }} on-error={{ }}` tienen que caber en una linea;
      * solo ASCII (los acentos se pierden al pegar).
    Es idempotente: volver a pegarlo deja el router igual, no duplica nada.
    """
    profile = OPENVPN_PROFILES[version]
    server_ip = f"{OPENVPN_SUBNET}{profile['server_host']}"
    name_q = _ros_ascii(_ros_quote(device_name))
    vpn_user_q, vpn_pass_q = _ros_quote(vpn_user), _ros_quote(vpn_password)
    api_user_q, api_pass_q = _ros_quote(api_user), _ros_quote(api_password)
    iface = "ovpn-crm"

    fw = (f"/ip firewall filter add chain=input in-interface={iface}"
          f" src-address={server_ip} protocol=tcp dst-port={api_port} action=accept")

    lines = [
        "# ============================================================",
        f'# Sistema ISP - Vincular "{name_q}" por OpenVPN',
        f"# Perfil: {_ros_ascii(profile['label'])}",
        f"# IP del router en la VPN: {tunnel_ip}   Red: {OPENVPN_NETWORK}",
        "# Pega este bloque completo en  /system > New Terminal  del router.",
        "# Se puede volver a pegar sin problema: no duplica nada.",
        "# ============================================================",
        "",
        "# 1) Reloj en hora: si el router va desfasado, falla el TLS del tunel",
        ':do { /system ntp client set enabled=yes } on-error={}',
        "",
        "# 2) Tunel OpenVPN hacia el CRM",
        f'/interface ovpn-client remove [find name="{iface}"]',
        (f'/interface ovpn-client add name="{iface}" connect-to="{public_ip}"'
         f" port={OPENVPN_PORT}"
         f' user="{vpn_user_q}" password="{vpn_pass_q}"'
         f" profile=default-encryption"
         f" auth={profile['auth']} cipher={profile['cipher']}"
         f" add-default-route=no disabled=no"),
        "",
        "# 3) Ruta hacia la red del CRM por dentro del tunel",
        '/ip route remove [find comment="Sistema ISP"]',
        (f'/ip route add dst-address={OPENVPN_NETWORK} gateway="{iface}"'
         f' comment="Sistema ISP"'),
        "",
        "# 4) Usuario de la API que usara el CRM",
        f'/user remove [find name="{api_user_q}"]',
        '/user group remove [find name="crm-api"]',
        "/user group add name=crm-api policy=local,read,write,policy,test,api,sensitive",
        (f'/user add name="{api_user_q}" password="{api_pass_q}"'
         f' group=crm-api comment="Sistema ISP"'),
        "",
        "# 5) Abrir la API solo hacia el CRM, por dentro del tunel",
        f"/ip service set [find name=api] disabled=no port={api_port} address={server_ip}/32",
        "",
        "# 6) Firewall: aceptar la API solo desde el CRM por el tunel.",
        "#    Se intenta poner de primera; si la lista esta vacia, place-before",
        "#    falla y entonces se agrega normal (que ahi es lo mismo).",
        '/ip firewall filter remove [find comment="Sistema ISP API"]',
        (f':do {{ {fw} place-before=0 comment="Sistema ISP API" }}'
         f' on-error={{ {fw} comment="Sistema ISP API" }}'),
        "",
        "# 7) Corte por falta de pago: los clientes morosos entran en esta lista",
        "#    (el CRM agrega y quita las IPs solo; aqui solo van las reglas).",
        "#    Se permite DNS y el propio router para que el cliente pueda navegar",
        "#    a la pagina de aviso; todo lo demas hacia internet queda cortado.",
        *_overdue_rules_lines(),
        "",
        "# 8) Nombre del router igual al del CRM",
        f'/system identity set name="{name_q}"',
        "",
        "# 9) Comprobar",
        "/interface ovpn-client print",
        "# Debe aparecer la bandera R (running). Espera unos 20 segundos.",
        '# Luego vuelve al CRM y presiona "Probar conexion".',
        "",
    ]
    return _ros_ascii("\n".join(lines))


class OpenVpnProvisionIn(BaseModel):
    version: Literal["v6", "v7"] = "v7"
    regenerate: bool = False  # fuerza credenciales nuevas


@api.post("/devices/{device_id}/openvpn-provision")
async def mikrotik_openvpn_provision(device_id: str, payload: OpenVpnProvisionIn,
                                     _: dict = Depends(require_roles("owner", "admin"))):
    """Da de alta el router en el servidor OpenVPN y devuelve el script listo
    para pegar. Reutiliza las credenciales ya emitidas salvo que se pida
    regenerarlas, para que volver a ver el script no rompa un túnel que ya
    estaba levantado."""
    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")

    version = payload.version
    username = d.get("vpn_user") or _ovpn_slug(d.get("name", ""))
    password = device_secret(d, "vpn_password")
    if payload.regenerate or not password:
        password = _ovpn_random_secret()

    api_user = d.get("api_user") or f"crm-{username}"[:32]
    api_password = device_secret(d, "api_password")
    if payload.regenerate or not api_password:
        api_password = _ovpn_random_secret()
    api_port = int(d.get("api_port") or 8728)

    cfg_doc = await db.config.find_one({"key": "server_vpn"}, {"_id": 0}) or {}
    cfg = cfg_doc.get("value", {}) if isinstance(cfg_doc, dict) else {}
    public_ip = cfg.get("public_ip") or os.environ.get("PUBLIC_HOST", "")
    if not public_ip:
        raise HTTPException(400, "Falta la IP pública del servidor (VPN > Datos del servidor)")

    # Bajo candado: elegir IP libre y escribirla tienen que ser un solo paso, o
    # dos altas a la vez podrían llevarse la misma dirección.
    tunnel_ip = await asyncio.to_thread(_ovpn_locked, _ovpn_reserve,
                                       username, password, version)
    if True:
        await db.devices.update_one({"id": device_id}, {"$set": {
            "host": tunnel_ip,
            "api_enabled": True,
            "api_port": api_port,
            "api_user": api_user,
            "api_password_enc": encrypt_secret(api_password),
            "connection": "vpn",
            "vpn_protocol": "openvpn",
            "vpn_user": username,
            "vpn_password_enc": encrypt_secret(password),
            "ros_version": version,
            "vpn_status": "pending",
            "vpn_provisioned_at": now_iso(),
            "updated_at": now_iso(),
        }, "$unset": {"api_password": "", "vpn_password": ""}})

    script = _ovpn_build_script(
        version=version, device_name=d.get("name", ""), public_ip=public_ip,
        vpn_user=username, vpn_password=password, tunnel_ip=tunnel_ip,
        api_user=api_user, api_password=api_password, api_port=api_port,
    )
    return {
        "version": version,
        "label": OPENVPN_PROFILES[version]["label"],
        "protocol": OPENVPN_PROFILES[version]["protocol"],
        "public_ip": public_ip,
        "port": OPENVPN_PORT,
        "vpn_user": username,
        "vpn_password": password,
        "tunnel_ip": tunnel_ip,
        "api_user": api_user,
        "api_password": api_password,
        "api_port": api_port,
        "filename": f"sistema-isp-{username}-{version}.rsc",
        "script": script,
    }


@api.get("/mikrotik/overdue-rules")
async def mikrotik_overdue_rules(_: dict = Depends(get_current_user)):
    """Solo las reglas de corte por mora, para pegarlas en un router que ya
    esta vinculado (o que se administra por fuera de la VPN del CRM). No lleva
    credenciales: es la misma configuracion para todos los equipos."""
    lines = [
        "# ============================================================",
        "# Sistema ISP - Reglas de corte por falta de pago",
        f'# Lista de morosos: "{OVERDUE_LIST}"  (la llena y vacia el CRM solo)',
        "# Pega este bloque en  /system > New Terminal  del router.",
        "# Se puede volver a pegar sin problema: reemplaza las reglas anteriores.",
        "# ============================================================",
        "",
        "# 1) Crear la lista si no existe todavia (asi las reglas ya son validas)",
        f':do {{ /ip firewall address-list add list={OVERDUE_LIST} address=127.0.0.2 comment="Sistema ISP placeholder" }} on-error={{}}',
        "",
        "# 2) Reglas de corte",
        *_overdue_rules_lines(),
        "",
        "# 3) Comprobar",
        '/ip firewall filter print where comment~"Sistema ISP mora"',
        f"/ip firewall address-list print where list={OVERDUE_LIST}",
        "",
    ]
    return {
        "list_name": OVERDUE_LIST,
        "filename": "sistema-isp-reglas-corte.rsc",
        "script": _ros_ascii("\n".join(lines)),
    }


@api.post("/devices/{device_id}/sync-interfaces")
async def mikrotik_sync_interfaces(device_id: str,
                                   _: dict = Depends(require_roles("owner", "admin"))):
    """Trae los nombres reales de las interfaces del router y la red IP que
    tiene configurada cada una (por la misma API nativa que usa "Probar
    conexión", vía el túnel VPN). Con esto el selector "Interfaz" del cliente
    muestra las interfaces reales, y el campo "IP" puede sugerir direcciones
    libres dentro de la red de la interfaz elegida en vez de una lista
    genérica de todo el ISP."""
    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")
    host = d.get("host") or ""
    user = d.get("api_user") or ""
    pwd = device_secret(d, "api_password")
    if not host or host == "-" or not user or not pwd:
        raise HTTPException(400, "El router aún no tiene VPN/API configuradas — genera su script primero.")

    try:
        res = await ros_list_interfaces_and_addresses(
            host, port=int(d.get("api_port") or 8728), user=user, password=pwd,
            use_ssl=bool(d.get("api_use_ssl")),
        )
        pppoe = await ros_pppoe_inventory(
            host, port=int(d.get("api_port") or 8728), user=user, password=pwd,
            use_ssl=bool(d.get("api_use_ssl")),
        )
    except MikrotikRosError as e:
        raise HTTPException(424, str(e))

    names = res["interfaces"]
    networks = res["networks"]
    ppp_profiles = pppoe["ppp_profiles"]
    pppoe_servers = pppoe["pppoe_servers"]
    ip_pools = pppoe["ip_pools"]
    await db.devices.update_one({"id": device_id}, {"$set": {
        "interfaces": names, "interface_networks": networks,
        "ppp_profiles": ppp_profiles, "pppoe_servers": pppoe_servers, "ip_pools": ip_pools,
        "interfaces_synced_at": now_iso(), "updated_at": now_iso(),
    }})
    return {
        "ok": True, "interfaces": names, "interface_networks": networks,
        "ppp_profiles": ppp_profiles, "pppoe_servers": pppoe_servers, "ip_pools": ip_pools,
        "synced_at": now_iso(),
    }


class InterfaceRolesIn(BaseModel):
    lan: List[str] = []
    wan: List[str] = []


@api.put("/devices/{device_id}/interface-roles")
async def mikrotik_set_interface_roles(device_id: str, payload: InterfaceRolesIn,
                                       _: dict = Depends(require_roles("owner", "admin"))):
    """Guarda qué interfaces del router se usan de verdad y con qué papel.

    Un router puede tener veinte interfaces y el operador usar dos. Aquí se
    marca cuáles son LAN (donde cuelgan los clientes — son las únicas que
    aparecen luego en el selector "Interfaz" del cliente) y cuáles WAN (salidas
    a internet; se permiten varias para redundancia)."""
    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")

    def _clean(names: List[str]) -> List[str]:
        seen, out = set(), []
        for n in names:
            n = (n or "").strip()
            if n and n not in seen:
                seen.add(n)
                out.append(n)
        return out

    lan, wan = _clean(payload.lan), _clean(payload.wan)

    both = [n for n in lan if n in set(wan)]
    if both:
        raise HTTPException(400, f"Una interfaz no puede ser LAN y WAN a la vez: {', '.join(both)}")

    # Solo se valida contra el router si ya se sincronizaron sus interfaces;
    # si todavía no, se guarda tal cual para no bloquear la configuración.
    known = d.get("interfaces") or []
    if known:
        unknown = [n for n in lan + wan if n not in set(known)]
        if unknown:
            raise HTTPException(400, f"Estas interfaces no existen en el router: {', '.join(unknown)}")

    await db.devices.update_one({"id": device_id}, {"$set": {
        "lan_interfaces": lan, "wan_interfaces": wan,
        "interface_roles_set_at": now_iso(), "updated_at": now_iso(),
    }})
    return {"ok": True, "lan_interfaces": lan, "wan_interfaces": wan}


@api.post("/devices/{device_id}/pppoe-server")
async def mikrotik_create_pppoe_server(device_id: str, payload: dict,
                                       _: dict = Depends(require_roles("owner", "admin"))):
    """Arma (o corrige) lo mínimo para que el router empiece a aceptar
    clientes PPPoE: el pool de IPs, un perfil por defecto, y el servidor
    escuchando en la interfaz que elija el operador. Se puede volver a llamar
    sin miedo: actualiza por nombre en vez de duplicar.

    Body: {"interface": "...", "pool_ranges": "10.20.0.2-10.20.0.254",
           "pool_name"?: "...", "service_name"?: "...",
           "profile_name"?: "...", "rate_limit"?: "5M/5M"}
    """
    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")
    host = d.get("host") or ""
    user = d.get("api_user") or ""
    pwd = device_secret(d, "api_password")
    if not host or host == "-" or not user or not pwd:
        raise HTTPException(400, "El router aún no tiene VPN/API configuradas — genera su script primero.")

    interface = (payload.get("interface") or "").strip()
    pool_ranges = (payload.get("pool_ranges") or "").strip()
    if not interface:
        raise HTTPException(400, "Falta la interfaz donde escuchará el servidor PPPoE")
    if not pool_ranges:
        raise HTTPException(400, "Falta el rango de IPs para el pool (ej: 10.20.0.2-10.20.0.254)")

    try:
        res = await ros_create_pppoe_server(
            host, port=int(d.get("api_port") or 8728), user=user, password=pwd,
            use_ssl=bool(d.get("api_use_ssl")),
            interface=interface, pool_ranges=pool_ranges,
            pool_name=(payload.get("pool_name") or "isp-pppoe-pool"),
            service_name=(payload.get("service_name") or "isp-pppoe"),
            profile_name=(payload.get("profile_name") or "isp-pppoe-default"),
            rate_limit=(payload.get("rate_limit") or "5M/5M"),
        )
    except MikrotikRosError as e:
        raise HTTPException(424, str(e))

    await db.devices.update_one({"id": device_id}, {"$set": {"updated_at": now_iso()}})
    return res


@api.post("/devices/{device_id}/openvpn-revoke")
async def mikrotik_openvpn_revoke(device_id: str,
                                  _: dict = Depends(require_roles("owner", "admin"))):
    """Quita al router del servidor OpenVPN. El borrado genérico de /devices no
    puede hacerlo (no sabe de VPN), así que la UI llama a esto antes de borrar
    para no dejar credenciales vivas de un equipo que ya no existe."""
    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")
    username = d.get("vpn_user")
    if not username:
        return {"ok": True, "revoked": False, "detail": "El router no tenía VPN asignada"}
    await asyncio.to_thread(_ovpn_locked, _ovpn_remove_credentials, username)
    await db.devices.update_one({"id": device_id}, {"$set": {
        "vpn_password": "", "vpn_provisioned_at": "", "updated_at": now_iso(),
    }})
    return {"ok": True, "revoked": True, "vpn_user": username}

@api.post("/devices/{device_id}/mikrotik-test")
async def mikrotik_test(device_id: str, _: dict = Depends(get_current_user)):
    """Diagnóstico completo de un Mikrotik registrado:
    - valida datos faltantes,
    - hace prueba TCP real contra el endpoint del CRM (donde el router debe
      llegar),
    - devuelve una serie de tráfico (RX/TX) simulada para que el operador vea
      la conexión con un gráfico.
    """
    import asyncio, socket, time, random
    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")

    cfg_doc = await db.config.find_one({"key": "server_vpn"}, {"_id": 0}) or {}
    cfg = cfg_doc.get("value", {}) if isinstance(cfg_doc, dict) else {}
    host = d.get("host") or cfg.get("public_ip") or ""
    proto = (d.get("vpn_protocol") or "wireguard").lower()
    port = int(d.get("port") or (cfg.get("wireguard_port") or 51820 if proto == "wireguard"
                                 else cfg.get("l2tp_port") or 1701))

    checks = []
    def add(name, ok, message="", fix=""):
        checks.append({"name": name, "ok": ok, "message": message, "fix": fix})

    add("Nombre del router", bool(d.get("name")), d.get("name") or "sin definir",
        fix="Edita el Mikrotik y ponle un nombre." if not d.get("name") else "")
    add("Protocolo VPN definido", bool(d.get("vpn_protocol")), (d.get("vpn_protocol") or "").upper() or "no seleccionado",
        fix="Reconfigura y elegí WireGuard o L2TP." if not d.get("vpn_protocol") else "")
    if proto == "l2tp":
        _has_vpn = bool(d.get("vpn_user") and device_secret(d, "vpn_password"))
        add("Credenciales L2TP", _has_vpn,
            "usuario/contraseña completos" if _has_vpn else "faltan credenciales",
            fix="Reconfigura y presiona 'Autogenerar' en Usuario VPN." if not _has_vpn else "")
    else:
        add("Public Key del servidor", bool(cfg.get("server_public_key")),
            "configurada" if cfg.get("server_public_key") else "sin configurar",
            fix="En Datos del servidor, edita 'Public Key del servidor'." if not cfg.get("server_public_key") else "")
    add("IP pública del CRM", bool(cfg.get("public_ip")), cfg.get("public_ip") or "sin definir",
        fix="Edita 'Datos del servidor' y completá la IP pública." if not cfg.get("public_ip") else "")
    if d.get("api_enabled"):
        _has_api_pwd = bool(device_secret(d, "api_password"))
        add("Usuario API", bool(d.get("api_user")) and _has_api_pwd,
            (d.get("api_user") or "") + (" · pass ok" if _has_api_pwd else " · pass vacío"),
            fix="Reconfigura y presiona 'Generar credenciales API'." if not (d.get("api_user") and _has_api_pwd) else "")
    else:
        add("API deshabilitada", True, "gestión de sesión sólo por túnel", fix="")
    add("Modo de gestión", bool(d.get("management_modes")),
        ", ".join(d.get("management_modes") or []) or "ninguno",
        fix="Reconfigura y marca PPP y/o Queues." if not d.get("management_modes") else "")

    # --- TCP reachability check ---
    def _resolve():
        try: return socket.gethostbyname(host)
        except Exception: return None
    resolved = await asyncio.get_event_loop().run_in_executor(None, _resolve) if host else None
    add("Host resuelve DNS", bool(resolved), resolved or "no se resolvió", fix="Prueba con la IP directa." if not resolved and host else "")

    tcp_ok = False; latency_ms = None; tcp_err = None
    if resolved:
        t0 = time.perf_counter()
        try:
            fut = asyncio.open_connection(resolved, port)
            reader, writer = await asyncio.wait_for(fut, timeout=3.0)
            latency_ms = int((time.perf_counter() - t0) * 1000)
            tcp_ok = True
            writer.close()
            try: await writer.wait_closed()
            except Exception: pass
        except asyncio.TimeoutError:
            tcp_err = f"Timeout: {host}:{port} no respondió en 3s."
        except ConnectionRefusedError:
            tcp_err = f"Conexión rechazada por {host}:{port}."
        except Exception as e:
            tcp_err = f"{type(e).__name__}: {e}"
    add(f"Endpoint {host}:{port} alcanzable", tcp_ok,
        (f"{latency_ms} ms" if tcp_ok else (tcp_err or "no evaluado")),
        fix="Abre el puerto UDP en firewall y NAT del proveedor." if not tcp_ok else "")

    critical_ok = all(c["ok"] for c in checks if c["name"] not in ("API deshabilitada",))
    reachable = tcp_ok

    # --- Simulated traffic series (last 30 samples, 3s apart) ---
    # --- Simulated traffic series (last 30 samples, 3s apart) ---
    # Uses SystemRandom (cryptographically strong via os.urandom) instead of
    # the seedable random module — safe for both display and any future
    # sensitive use.
    import secrets
    rng = secrets.SystemRandom()
    now = time.time()
    samples = []
    for i in range(30):
        ts = int(now - (29 - i) * 3)
        base_rx = 350 + 200 * (0.6 + rng.random() * 0.8)
        base_tx = 120 + 90 * (0.6 + rng.random() * 0.8)
        # spike each ~10 samples
        if i % 10 == 0: base_rx *= 1.6
        samples.append({
            "t": ts,
            "label": time.strftime("%H:%M:%S", time.localtime(ts)),
            "rx_kbps": int(base_rx if reachable else 0),
            "tx_kbps": int(base_tx if reachable else 0),
        })

    return {
        "device_id": device_id,
        "endpoint": f"{host}:{port}",
        "protocol": proto,
        "resolved": resolved,
        "latency_ms": latency_ms,
        "reachable": reachable,
        "all_ok": critical_ok and reachable,
        "checks": checks,
        "traffic": samples,
        "checked_at": now_iso(),
        "message": ("Conectado correctamente." if reachable and critical_ok
                    else "Faltan datos o el endpoint no responde. Revisa los ítems marcados en rojo."),
    }

@api.post("/devices/{device_id}/rest-sync")
async def mikrotik_rest_sync(device_id: str, _: dict = Depends(require_roles("owner", "admin"))):
    """Sincroniza interfaces del router Mikrotik usando su REST API.

    Hace GET a `{rest_api_url}/rest/interface` con Basic Auth (`api_user` +
    `api_password`), guarda el snapshot en `device_interfaces` (upsert por
    device_id+name) y actualiza el documento del device con métricas de sync.
    """
    import httpx
    import base64

    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")

    url = (d.get("rest_api_url") or "").rstrip("/")
    user = d.get("api_user") or ""
    pwd = device_secret(d, "api_password")
    if not url or not user or not pwd:
        raise HTTPException(400, "Configura URL REST + usuario y contraseña API antes de sincronizar.")
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(400, "La URL REST debe iniciar con http:// o https://")

    verify_ssl = bool(d.get("rest_verify_ssl", False))
    endpoint = f"{url}/rest/interface"

    sync_started = now_iso()
    err_msg = None
    interfaces_payload = []
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=verify_ssl) as hc:
            resp = await hc.get(endpoint, auth=(user, pwd))
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, list):
                raise ValueError("La respuesta REST no es una lista de interfaces")
            interfaces_payload = data
    except httpx.HTTPStatusError as e:
        code = e.response.status_code if e.response is not None else None
        if code == 401:
            err_msg = "Credenciales inválidas (401). Revisa usuario/contraseña API en RouterOS."
        elif code == 404:
            err_msg = "404 en /rest/interface. Habilita el servicio www-ssl en RouterOS."
        else:
            err_msg = f"HTTP {code}: {e.response.text[:200] if e.response is not None else ''}"
    except httpx.ConnectError as e:
        err_msg = f"No se pudo conectar a {endpoint}. Verifica la URL y la conectividad VPN."
    except httpx.ReadTimeout:
        err_msg = f"Timeout al conectar con {endpoint}."
    except Exception as e:
        err_msg = f"{type(e).__name__}: {str(e)[:200]}"

    if err_msg:
        await db.devices.update_one({"id": device_id}, {"$set": {
            "last_sync_at": sync_started,
            "last_sync_status": "error",
            "last_sync_error": err_msg,
            "updated_at": now_iso(),
        }})
        # 424 Failed Dependency: upstream (router) failed. Chosen over 502 because
        # Cloudflare/ingress intercepts 5xx and swallows the JSON body.
        raise HTTPException(424, err_msg)

    # Normalizar interfaces (RouterOS devuelve strings "true"/"false")
    def _b(v):
        if isinstance(v, bool): return v
        if v is None: return None
        return str(v).strip().lower() in ("true", "yes", "1")

    def _i(v, default=0):
        try: return int(v)
        except (TypeError, ValueError): return default

    normalized = []
    for it in interfaces_payload:
        if not isinstance(it, dict):
            continue
        name = it.get("name") or it.get(".id") or ""
        if not name:
            continue
        row = {
            "device_id": device_id,
            "name": name,
            "type": it.get("type") or "",
            "mac_address": it.get("mac-address") or "",
            "comment": it.get("comment") or "",
            "running": _b(it.get("running")),
            "disabled": _b(it.get("disabled")),
            "mtu": _i(it.get("mtu")),
            "actual_mtu": _i(it.get("actual-mtu")),
            "rx_byte": _i(it.get("rx-byte")),
            "tx_byte": _i(it.get("tx-byte")),
            "rx_packet": _i(it.get("rx-packet")),
            "tx_packet": _i(it.get("tx-packet")),
            "last_link_up_time": it.get("last-link-up-time") or "",
            "last_link_down_time": it.get("last-link-down-time") or "",
            "raw": it,
            "synced_at": sync_started,
        }
        normalized.append(row)
        await db.device_interfaces.update_one(
            {"device_id": device_id, "name": name},
            {"$set": row},
            upsert=True,
        )

    # Purge interfaces que ya no existen en el router
    current_names = [r["name"] for r in normalized]
    if current_names:
        await db.device_interfaces.delete_many({
            "device_id": device_id,
            "name": {"$nin": current_names},
        })

    down_count = sum(
        1 for r in normalized
        if r["running"] is False and r["disabled"] is not True
    )

    await db.devices.update_one({"id": device_id}, {"$set": {
        "last_sync_at": sync_started,
        "last_sync_status": "ok",
        "last_sync_error": "",
        "interfaces_count": len(normalized),
        "interfaces_down": down_count,
        "updated_at": now_iso(),
    }})

    return {
        "device_id": device_id,
        "synced_at": sync_started,
        "interfaces_count": len(normalized),
        "interfaces_down": down_count,
        "interfaces": normalized,
    }


@api.get("/devices/{device_id}/interfaces")
async def get_device_interfaces(device_id: str, _: dict = Depends(get_current_user)):
    """Lista interfaces almacenadas para un router específico."""
    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")
    items = await db.device_interfaces.find(
        {"device_id": device_id}, {"_id": 0, "raw": 0}
    ).sort("name", 1).to_list(500)
    return {
        "device_id": device_id,
        "last_sync_at": d.get("last_sync_at"),
        "last_sync_status": d.get("last_sync_status"),
        "last_sync_error": d.get("last_sync_error"),
        "interfaces_count": d.get("interfaces_count", len(items)),
        "interfaces_down": d.get("interfaces_down", 0),
        "interfaces": items,
    }


@api.post("/vpn/{vpn_id}/test")
async def test_vpn(vpn_id: str, _: dict = Depends(get_current_user)):
    """Real TCP reachability check against the VPN endpoint. Reports latency,
    handshake status and, when reachable, simulated live traffic (RX/TX) so the
    operator can eyeball activity from the CRM.
    """
    import asyncio, socket, time, secrets
    rng = secrets.SystemRandom()
    v = await db.vpn_connections.find_one({"id": vpn_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "VPN no encontrada")
    host = v.get("remote_host") or ""
    port = int(v.get("remote_port") or 51820)
    proto = (v.get("protocol") or "wireguard").lower()

    def _resolve():
        try:
            return socket.gethostbyname(host)
        except Exception:
            return None

    resolved = await asyncio.get_event_loop().run_in_executor(None, _resolve)
    if not resolved:
        return {"reachable": False, "resolved": None, "latency_ms": None, "handshake": "dns_fail",
                "error": f"No se pudo resolver el host '{host}'. Verifica el DNS o usa una IP.",
                "checked_at": now_iso(), "endpoint": f"{host}:{port}", "protocol": proto,
                "traffic": None, "hint": "Prueba con la IP pública en lugar del hostname."}

    t0 = time.perf_counter()
    try:
        # WireGuard/L2TP/IPsec usan UDP; TCP fallback igual valida ruta.
        fut = asyncio.open_connection(resolved, port)
        reader, writer = await asyncio.wait_for(fut, timeout=3.0)
        latency_ms = int((time.perf_counter() - t0) * 1000)
        writer.close()
        try: await writer.wait_closed()
        except Exception: pass
        traffic = {
            "rx_kbps": rng.randint(120, 950),
            "tx_kbps": rng.randint(60, 480),
            "packets_in": rng.randint(200, 1400),
            "packets_out": rng.randint(200, 1400),
            "since": v.get("last_test_at") or now_iso(),
        }
        return {"reachable": True, "resolved": resolved, "latency_ms": latency_ms,
                "handshake": "ok", "error": None,
                "message": f"Endpoint {host} ({resolved}) respondió en {latency_ms}ms.",
                "endpoint": f"{host}:{port}", "protocol": proto, "checked_at": now_iso(),
                "traffic": traffic}
    except asyncio.TimeoutError:
        return {"reachable": False, "resolved": resolved, "latency_ms": None,
                "handshake": "timeout",
                "error": f"Timeout: {host}:{port} no respondió en 3s. Verifica que el puerto esté abierto en firewall/NAT.",
                "endpoint": f"{host}:{port}", "protocol": proto, "checked_at": now_iso(),
                "traffic": None,
                "hint": f"Si es {proto.upper()}, abre el puerto {port} UDP en el router y NAT del proveedor."}
    except ConnectionRefusedError as e:
        return {"reachable": False, "resolved": resolved, "latency_ms": None,
                "handshake": "refused",
                "error": f"Conexión rechazada por {host}:{port}. El servicio VPN no está escuchando.",
                "endpoint": f"{host}:{port}", "protocol": proto, "checked_at": now_iso(),
                "traffic": None,
                "hint": "Confirma que el servicio VPN esté activo en el servidor destino."}
    except Exception as e:
        return {"reachable": False, "resolved": resolved, "latency_ms": None,
                "handshake": "error",
                "error": f"{type(e).__name__}: {e}",
                "endpoint": f"{host}:{port}", "protocol": proto, "checked_at": now_iso(),
                "traffic": None, "hint": "Revisa host, puerto y credenciales del perfil."}

@api.post("/devices/{device_id}/mikrotik-script")
async def mikrotik_script(device_id: str, protocol: str = "wireguard", _: dict = Depends(require_roles("owner","admin"))):
    """Generate a ready-to-paste RouterOS script (.rsc) to link this Mikrotik
    with the CRM via VPN (WireGuard, L2TP/IPsec or OpenVPN).
    The operator copies the script into the RouterOS terminal or drops the
    .rsc file into Files and runs `/import`.
    """
    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")
    proto = (protocol or "wireguard").lower()
    name = d.get("name", "mikrotik").replace(" ", "-")
    remote_host = d.get("host") or "vpn.miisp.com"
    remote_port = d.get("port") or (51820 if proto == "wireguard" else 1701 if proto == "l2tp" else 1194)
    iface = f"wg-{name.lower()}"[:15]
    peer_endpoint = f"{remote_host}:{remote_port}"

    # Defaults so all code paths return a script (protects against future new
    # branches that forget to assign these variables — silences static
    # analyzers and prevents runtime NameError).
    script = f"# Protocolo '{proto}' no soportado. Elegí wireguard, l2tp u openvpn."
    steps = ["Protocolo no soportado."]
    filename = f"enlacehr-isp-{name}-unknown.rsc"

    if proto == "wireguard":
        script = f"""# ============================================================
# EnlaceHR ISP · Script de vinculación WireGuard
# Router: {d.get('name')}  ({d.get('host')})
# Pegar en /system script o ejecutar linea por linea en el terminal.
# ============================================================

# 1) Crear la interfaz WireGuard (si no existe)
/interface wireguard
add listen-port={remote_port} mtu=1420 name={iface} comment="EnlaceHR-ISP"

# 2) Asignar IP de tunel al router
/ip address
add address=10.100.0.2/24 interface={iface} comment="EnlaceHR-ISP"

# 3) Registrar el peer (servidor VPN del CRM)
/interface wireguard peers
add interface={iface} \\
    endpoint-address={remote_host} \\
    endpoint-port={remote_port} \\
    allowed-address=10.100.0.0/24 \\
    persistent-keepalive=25s \\
    public-key="<PEGAR_PUBLIC_KEY_DEL_SERVIDOR>" \\
    comment="EnlaceHR-ISP"

# 4) Firewall: permitir la VPN entrante
/ip firewall filter
add chain=input action=accept protocol=udp dst-port={remote_port} comment="EnlaceHR-ISP WireGuard"

# 5) NAT para que el CRM pueda ver la LAN (opcional)
# /ip firewall nat
# add chain=srcnat action=masquerade out-interface={iface} comment="EnlaceHR-ISP"

# 6) Verificacion
/interface wireguard peers print
/ip address print where interface={iface}
"""
        steps = [
            "Ingresa a tu Mikrotik por Winbox/WebFig/SSH.",
            "Abrí el terminal (New Terminal) o subí el archivo .rsc a Files.",
            "Pegá el script completo o ejecutá `/import file-name=<archivo>.rsc`.",
            "Reemplazá `<PEGAR_PUBLIC_KEY_DEL_SERVIDOR>` por la Public Key que te da el CRM.",
            "En el CRM copiá la Public Key generada por el router: `/interface wireguard print` y pégala en la sección VPN.",
            "Verificá el handshake: `/interface wireguard peers print` — debe mostrar `last-handshake` con un valor reciente.",
        ]
        filename = f"enlacehr-isp-{name}-wireguard.rsc"

    elif proto == "l2tp":
        script = f"""# ============================================================
# EnlaceHR ISP · Script L2TP/IPsec — {d.get('name')}
# ============================================================
/interface l2tp-client
add name=l2tp-crm connect-to={remote_host} user=<USUARIO> password=<PASSWORD> \\
    use-ipsec=yes ipsec-secret=<PSK> add-default-route=no comment="EnlaceHR-ISP"

/ip firewall filter
add chain=input action=accept protocol=udp dst-port=500,4500,1701 comment="EnlaceHR-ISP L2TP"

/interface l2tp-client print
"""
        steps = [
            "Ingresa a Winbox/WebFig y abre el terminal.",
            "Pega el script y reemplaza `<USUARIO>`, `<PASSWORD>` y `<PSK>` por los datos que te da el CRM.",
            "Verifica con `/interface l2tp-client print` que aparezca `R` (running).",
            "Si no conecta, revisa: `/log print where topics~\"l2tp\"`.",
        ]
        filename = f"enlacehr-isp-{name}-l2tp.rsc"

    else:  # openvpn
        script = f"""# ============================================================
# EnlaceHR ISP · Script OpenVPN — {d.get('name')}
# ============================================================
# 1) Subí el archivo .ovpn/certificados a Files y luego:
/interface ovpn-client
add name=ovpn-crm connect-to={remote_host} port={remote_port} user=<USUARIO> \\
    password=<PASSWORD> certificate=none auth=sha1 cipher=aes256 comment="EnlaceHR-ISP"

/interface ovpn-client print
"""
        steps = [
            "Sube los certificados a Files (si aplica).",
            "Pega el script en el terminal y reemplaza usuario/contraseña.",
            "Verifica el enlace con `/interface ovpn-client print`.",
        ]
        filename = f"enlacehr-isp-{name}-openvpn.rsc"

    return {"filename": filename, "script": script, "steps": steps, "protocol": proto}

# ---------- Personal pending notes (per-user) ----------
@api.get("/my-notes")
async def my_notes(user: dict = Depends(get_current_user)):
    items = await db.personal_notes.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items

@api.post("/my-notes")
async def create_my_note(payload: PersonalNoteIn, user: dict = Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = new_id()
    doc["user_id"] = user["id"]
    doc["user_name"] = user.get("name")
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.personal_notes.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.patch("/my-notes/{note_id}")
async def update_my_note(note_id: str, payload: PersonalNoteUpdate, user: dict = Depends(get_current_user)):
    updates = payload.dict(exclude_none=True)
    updates["updated_at"] = now_iso()
    res = await db.personal_notes.update_one(
        {"id": note_id, "user_id": user["id"]}, {"$set": updates}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Nota no encontrada")
    return await db.personal_notes.find_one({"id": note_id}, {"_id": 0})

@api.delete("/my-notes/{note_id}")
async def delete_my_note(note_id: str, user: dict = Depends(get_current_user)):
    res = await db.personal_notes.delete_one({"id": note_id, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Nota no encontrada")
    return {"ok": True}

# ---------- Clients (custom with derived fields) ----------
def _next_due_date(payment_day: int, from_iso: Optional[str] = None) -> str:
    base = datetime.fromisoformat(from_iso) if from_iso else datetime.now(timezone.utc)
    year, month = base.year, base.month
    # move to next month
    month += 1
    if month > 12: month = 1; year += 1
    day = min(payment_day, 28)
    return datetime(year, month, day, tzinfo=timezone.utc).isoformat()

def _nap_capacity(nap: dict) -> int:
    """Effective capacity for a NAP box based on its port_type ('1x8'/'1x16')."""
    pt = nap.get("port_type")
    if pt == "1x8":
        return 8
    if pt == "1x16":
        return 16
    return int(nap.get("capacity") or 16)

async def _check_nap_capacity(nap_box_id: str, exclude_client_id: Optional[str] = None):
    if not nap_box_id: return
    nap = await db.nap_boxes.find_one({"id": nap_box_id})
    if not nap: return
    q = {"nap_box_id": nap_box_id}
    if exclude_client_id: q["id"] = {"$ne": exclude_client_id}
    count = await db.clients.count_documents(q)
    cap = _nap_capacity(nap)
    if count >= cap:
        raise HTTPException(400, f"La caja NAP '{nap['name']}' está llena ({count}/{cap})")

@api.get("/nap-boxes/status")
async def nap_status(_: dict = Depends(get_current_user)):
    """Return every NAP + used count + derived capacity + status label. UI uses this."""
    naps = await db.nap_boxes.find({}, {"_id": 0}).sort("name", 1).to_list(2000)
    counts = {}
    async for c in db.clients.find({"nap_box_id": {"$ne": None}}, {"_id": 0, "nap_box_id": 1}):
        nid = c.get("nap_box_id")
        if nid:
            counts[nid] = counts.get(nid, 0) + 1
    out = []
    for n in naps:
        cap = _nap_capacity(n)
        used = counts.get(n["id"], 0)
        if used >= cap:
            status = "full"
        elif used == 0:
            status = "empty"
        else:
            status = "partial"
        out.append({**n, "capacity": cap, "used": used, "available": max(0, cap - used), "status": status})
    return out

@api.get("/clients")
async def list_clients(user: dict = Depends(require_permission("clients", "read"))):
    # Cobradores get a slim projection (name/phone/id/status only) — enough to
    # pick a client when recording a payment, but no personal or billing data.
    if user.get("role") == "cobrador":
        items = await db.clients.find(
            {}, {"_id": 0, "id": 1, "full_name": 1, "phone": 1, "status": 1, "next_due_date": 1},
        ).sort("full_name", 1).to_list(5000)
        return items
    items = await db.clients.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return items

@api.get("/clients/{cid}")
async def get_client(cid: str, user: dict = Depends(require_permission("clients", "read"))):
    if user.get("role") == "cobrador":
        c = await db.clients.find_one({"id": cid},
            {"_id": 0, "id": 1, "full_name": 1, "phone": 1, "status": 1, "next_due_date": 1})
    else:
        c = await db.clients.find_one({"id": cid}, {"_id": 0})
    if not c: raise HTTPException(404, "Cliente no encontrado")
    return c

@api.post("/clients")
async def create_client(payload: ClientIn, user: dict = Depends(require_permission("clients", "write"))):
    if payload.nap_box_id:
        await _check_nap_capacity(payload.nap_box_id)
    doc = strip_pending(payload.dict())
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    doc["next_due_date"] = _next_due_date(doc["payment_day"])
    doc["last_seen"] = None
    doc["onu_power_dbm"] = None
    # Autogenerate 8-digit unique PIN for the client portal. Stored in plain
    # so admins can display it in the CRM (portal PIN is not a secret from
    # the ISP itself — it's an account identifier for the customer). Not
    # modifiable via the UI.
    pin_plain = await generate_portal_pin()
    doc["portal_pin"] = pin_plain
    # Número de contrato: se asigna ya, aunque el alta quede pendiente — si se
    # descarta o se borra después, ese número no se vuelve a usar.
    doc["contract_number"] = await next_contract_number()
    # El alta queda pendiente: no se toca el router hasta que el operador
    # confirme desde "Aplicar Cambios".
    return await stage_create("clients", doc, user)

@api.patch("/clients/{cid}")
async def update_client(cid: str, payload: ClientUpdate, user: dict = Depends(require_permission("clients", "write"))):
    before = await db.clients.find_one({"id": cid}, {"_id": 0})
    if not before:
        raise HTTPException(404, "Cliente no encontrado")
    updates = strip_pending(payload.dict(exclude_none=True))
    if updates.get("nap_box_id"):
        await _check_nap_capacity(updates["nap_box_id"], exclude_client_id=cid)
    if "payment_day" in updates:
        updates["next_due_date"] = _next_due_date(updates["payment_day"])
    updates["updated_at"] = now_iso()
    # La cola/PPPoE del router se recalcula al confirmar, no aquí.
    return await stage_update("clients", cid, updates, user)

@api.delete("/clients/{cid}")
async def delete_client(cid: str, user: dict = Depends(require_permission("clients", "delete"))):
    # La baja también se confirma: el cliente sigue con servicio hasta que se
    # aplique, y ahí se le retira la cola o el secret PPPoE del router.
    return await stage_delete("clients", cid, user)


@api.post("/clients/{cid}/sync-queue")
async def sync_client_queue(cid: str, _: dict = Depends(require_permission("clients", "write"))):
    """Reintento manual: crea/actualiza la Simple Queue del cliente ahora
    mismo, para cuando el router no respondió en el momento del alta/edición."""
    client = await db.clients.find_one({"id": cid}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    res = await _sync_client_queue_and_persist(client)
    if not res.get("ok"):
        raise HTTPException(424, res.get("reason") or "No se pudo sincronizar la cola")
    return res


@api.post("/clients/{cid}/sync-pppoe")
async def sync_client_pppoe(cid: str, _: dict = Depends(require_permission("clients", "write"))):
    """Reintento manual: crea/actualiza el secret PPPoE del cliente ahora
    mismo (o lo genera, si todavía no tenía usuario/contraseña)."""
    client = await db.clients.find_one({"id": cid}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    res = await _sync_client_pppoe_and_persist(client)
    if not res.get("ok"):
        raise HTTPException(424, res.get("reason") or "No se pudo sincronizar el PPPoE")
    return res


@api.get("/clients/{cid}/live-traffic")
async def client_live_traffic(cid: str, _: dict = Depends(require_permission("clients", "read"))):
    """Sube/baja real del cliente ahora mismo, leída directo del Mikrotik
    (Simple Queue trae su propio `rate` calculado; PPPoE se mide con
    `monitor-traffic` sobre la interfaz de su sesión activa, si está conectado)."""
    client = await db.clients.find_one({"id": cid}, {"_id": 0})
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    router = await _router_for_client(client)
    if not router:
        return {"ok": False, "reason": "no se pudo determinar el router del cliente"}
    router_kwargs = dict(
        host=router["host"], port=int(router.get("api_port") or 8728),
        user=router.get("api_user", ""), password=device_secret(router, "api_password"),
        use_ssl=bool(router.get("api_use_ssl")),
    )
    try:
        if client.get("connection_mode") == "pppoe":
            username = (client.get("pppoe_user") or "").strip()
            if not username:
                return {"ok": False, "reason": "el cliente no tiene usuario PPPoE"}
            res = await ros_get_pppoe_rate(**router_kwargs, username=username)
        else:
            name = client.get("mikrotik_queue_name") or _queue_name_for(client)
            res = await ros_get_queue_rate(**router_kwargs, name=name)
        return res
    except MikrotikRosError as e:
        return {"ok": False, "reason": str(e)[:200]}



# ---------- Payments ----------
@api.get("/payments")
async def list_payments(client_id: Optional[str] = None,
                        user: dict = Depends(get_current_user)):
    """Combined payments+promesas listing. The dispatcher checks each type's
    permission based on the ?client_id filter's contents (or both perms if
    unfiltered)."""
    # Owner/admin always allowed. Others: require at least payments.read OR
    # promesas.read; the response filters accordingly.
    perms = user.get("permissions") or default_perms_for(user.get("role"))
    can_pay = user.get("role") in ("owner","admin") or perms.get("payments", {}).get("read")
    can_pro = user.get("role") in ("owner","admin") or perms.get("promesas", {}).get("read")
    if not can_pay and not can_pro:
        raise HTTPException(403, "Permiso denegado: requiere payments.read o promesas.read")
    q = {"client_id": client_id} if client_id else {}
    # Filter by is_promise based on which perms the user has
    if not can_pay and can_pro:
        q["is_promise"] = True
    elif can_pay and not can_pro:
        q["is_promise"] = {"$ne": True}
    items = await db.payments.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return items

@api.post("/payments")
async def create_payment(payload: PaymentIn, user: dict = Depends(get_current_user)):
    # Route the write permission based on is_promise
    module = "promesas" if payload.is_promise else "payments"
    perms = user.get("permissions") or default_perms_for(user.get("role"))
    if user.get("role") not in ("owner","admin") and not perms.get(module, {}).get("write"):
        raise HTTPException(403, f"Permiso denegado: requiere {module}.write")
    client = await db.clients.find_one({"id": payload.client_id})
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    doc = strip_pending(payload.dict())
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    doc["created_by"] = user.get("id")
    doc["created_by_name"] = user.get("name")
    # El pago queda pendiente: la fecha de vencimiento del cliente y su
    # reactivación en el router se aplican al confirmar (`_apply_payment_effects`).
    return await stage_create("payments", doc, user)


async def _apply_payment_effects(payment: dict) -> None:
    """Efectos reales de un pago ya confirmado: le corre el vencimiento al
    cliente y, si estaba cortado por mora, le devuelve el servicio."""
    if payment.get("is_promise"):
        return
    client = await db.clients.find_one({"id": payment.get("client_id")})
    if not client:
        return
    current_due = client.get("next_due_date") or now_iso()
    new_due = _next_due_date(client.get("payment_day", 1), current_due)
    await db.clients.update_one(
        {"id": client["id"]},
        {"$set": {"next_due_date": new_due, "status": "active", "updated_at": now_iso()}},
    )
    # Si el router no responde queda registrado para que el operador lo vea,
    # pero el pago se confirma igual.
    unblock = await _apply_overdue_block(client, False)
    await db.clients.update_one({"id": client["id"]}, {
        "$set": {"overdue_block_error": "" if unblock.get("ok") else unblock.get("reason", "")[:200]},
        "$unset": {"suspended_at": "", "suspended_reason": ""},
    })

@api.post("/payments/bulk-delete")
async def bulk_delete_payments(payload: BulkDeleteIn, user: dict = Depends(require_permission("payments", "delete"))):
    if not payload.ids:
        return {"deleted": 0}
    for pid in payload.ids:
        await stage_delete("payments", pid, user)
    return {"deleted": len(payload.ids), "pending": True}

@api.patch("/payments/{pid}")
async def update_payment(pid: str, payload: dict, user: dict = Depends(get_current_user)):
    existing = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Pago no encontrado")
    module = "promesas" if existing.get("is_promise") else "payments"
    perms = user.get("permissions") or default_perms_for(user.get("role"))
    if user.get("role") not in ("owner","admin") and not perms.get(module, {}).get("write"):
        raise HTTPException(403, f"Permiso denegado: requiere {module}.write")
    # Only allow editing these fields; do NOT re-apply the next_due_date side
    # effect from create — edits should not shift the client's billing cycle.
    ALLOWED = {"amount", "method", "concept", "invoice_number", "is_promise",
               "promise_date", "extension_days", "notes"}
    changes = {k: v for k, v in (payload or {}).items() if k in ALLOWED}
    if not changes:
        return existing
    changes["updated_at"] = now_iso()
    return await stage_update("payments", pid, changes, user)

@api.delete("/payments/{pid}")
async def delete_payment(pid: str, user: dict = Depends(get_current_user)):
    existing = await db.payments.find_one({"id": pid}, {"_id": 0, "is_promise": 1})
    module = "promesas" if (existing or {}).get("is_promise") else "payments"
    perms = user.get("permissions") or default_perms_for(user.get("role"))
    if user.get("role") not in ("owner","admin") and not perms.get(module, {}).get("delete"):
        raise HTTPException(403, f"Permiso denegado: requiere {module}.delete")
    return await stage_delete("payments", pid, user)

# ---------- Arqueos de caja ----------
@api.get("/arqueos")
async def list_arqueos(_: dict = Depends(get_current_user)):
    items = await db.arqueos.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return items

@api.post("/arqueos")
async def create_arqueo(payload: ArqueoIn, user: dict = Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["created_by"] = user.get("id")
    doc["created_by_name"] = user.get("name")
    await db.arqueos.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.delete("/arqueos/{aid}")
async def delete_arqueo(aid: str, _: dict = Depends(require_roles("owner","admin"))):
    await db.arqueos.delete_one({"id": aid})
    return {"ok": True}

# ---------- WhatsApp ----------
DEFAULT_FUNNELS = [
    {"name": "Nuevos", "color": "#38bdf8", "order": 0, "is_default": True},
    {"name": "En proceso", "color": "#f59e0b", "order": 1, "is_default": False},
    {"name": "Esperando pago", "color": "#a78bfa", "order": 2, "is_default": False},
    {"name": "Cerrado", "color": "#22c55e", "order": 3, "is_default": False},
]

async def _ensure_default_funnel_id() -> str:
    doc = await db.whatsapp_funnels.find_one({"is_default": True}, {"_id": 0, "id": 1})
    if doc:
        return doc["id"]
    any_doc = await db.whatsapp_funnels.find_one({}, {"_id": 0, "id": 1})
    return any_doc["id"] if any_doc else ""

async def _get_or_create_conversation(phone: str, client_id: Optional[str] = None) -> dict:
    conv = await db.whatsapp_conversations.find_one({"phone": phone}, {"_id": 0})
    if conv:
        return conv
    funnel_id = await _ensure_default_funnel_id()
    conv = {
        "id": new_id(),
        "phone": phone,
        "client_id": client_id,
        "funnel_id": funnel_id,
        "assigned_to": None,
        "tags": [],
        "notes": "",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.whatsapp_conversations.insert_one(conv)
    conv.pop("_id", None)
    return conv

async def _get_wa_config() -> dict:
    cfg = await db.whatsapp_config.find_one({"id": "singleton"}, {"_id": 0})
    if not cfg:
        cfg = {
            "id": "singleton",
            "provider": "simulated",
            "base_url": "",
            "api_key": "",
            "instance": "",
            "webhook_token": "",
            "connected": False,
            "last_status_at": None,
            "user_jid": None,
        }
        await db.whatsapp_config.insert_one(cfg)
        cfg.pop("_id", None)
    return cfg

@api.get("/whatsapp/messages")
async def list_wa(client_id: Optional[str] = None, phone: Optional[str] = None, _: dict = Depends(get_current_user)):
    q = {}
    if client_id: q["client_id"] = client_id
    if phone: q["phone"] = phone
    items = await db.whatsapp.find(q, {"_id": 0}).sort("created_at", -1).to_list(3000)
    return items

@api.post("/whatsapp/messages")
async def create_wa(payload: WhatsAppMessageIn, user: dict = Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["status"] = "queued" if payload.direction == "outgoing" else "received"
    if payload.direction == "outgoing":
        doc["responded_by"] = user.get("id")
        doc["responded_by_name"] = user.get("name") or user.get("email")
    await db.whatsapp.insert_one(doc)
    await _get_or_create_conversation(payload.phone, payload.client_id)
    await db.whatsapp_conversations.update_one(
        {"phone": payload.phone},
        {"$set": {"updated_at": doc["created_at"], "last_body": payload.body[:200],
                  "last_direction": payload.direction, "client_id": payload.client_id}}
    )

    # Attempt real delivery when a provider is configured
    if payload.direction == "outgoing":
        cfg = await _get_wa_config()
        if cfg.get("provider") not in (None, "", "simulated") and cfg.get("base_url"):
            try:
                import httpx
                headers = {"Content-Type": "application/json"}
                if cfg.get("api_key"):
                    headers["Authorization"] = f"Bearer {cfg['api_key']}"
                    headers["apikey"] = cfg["api_key"]
                # Provider-specific payloads
                url = cfg["base_url"].rstrip("/")
                instance = cfg.get("instance") or "default"
                if cfg["provider"] == "evolution":
                    endpoint = f"{url}/message/sendText/{instance}"
                    payload_body = {"number": payload.phone, "text": payload.body}
                elif cfg["provider"] == "waha":
                    endpoint = f"{url}/api/sendText"
                    payload_body = {"session": instance, "chatId": f"{payload.phone.replace('+','')}@c.us", "text": payload.body}
                else:  # baileys/wasenderapi/custom
                    endpoint = f"{url}/send"
                    payload_body = {"phone_number": payload.phone, "message": payload.body, "instance": instance}
                async with httpx.AsyncClient(timeout=8.0) as hc:
                    r = await hc.post(endpoint, json=payload_body, headers=headers)
                    if r.status_code < 400:
                        await db.whatsapp.update_one({"id": doc["id"]}, {"$set": {"status": "sent",
                                                                                  "provider_response": r.json() if r.content else {}}})
                        doc["status"] = "sent"
                    else:
                        await db.whatsapp.update_one({"id": doc["id"]}, {"$set": {"status": "failed",
                                                                                  "provider_error": r.text[:400]}})
                        doc["status"] = "failed"
            except Exception as e:  # pragma: no cover - network dependent
                await db.whatsapp.update_one({"id": doc["id"]}, {"$set": {"status": "failed",
                                                                          "provider_error": str(e)[:400]}})
                doc["status"] = "failed"

    doc.pop("_id", None)
    return doc

@api.post("/whatsapp/simulate-incoming")
async def simulate_incoming(payload: WhatsAppMessageIn, _: dict = Depends(get_current_user)):
    """Utility endpoint to simulate an incoming WhatsApp message for testing the panel."""
    doc = payload.dict()
    doc["direction"] = "incoming"
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["status"] = "received"
    await db.whatsapp.insert_one(doc)
    await _get_or_create_conversation(payload.phone, payload.client_id)
    await db.whatsapp_conversations.update_one(
        {"phone": payload.phone},
        {"$set": {"updated_at": doc["created_at"], "last_body": payload.body[:200],
                  "last_direction": "incoming", "client_id": payload.client_id}}
    )
    doc.pop("_id", None)
    return doc

# --- Provider config & connection ---
@api.get("/whatsapp/config")
async def get_wa_config(_: dict = Depends(require_roles("owner","admin"))):
    cfg = await _get_wa_config()
    # Mask api_key on read
    if cfg.get("api_key"):
        cfg["api_key_masked"] = cfg["api_key"][:4] + "•••" + cfg["api_key"][-3:] if len(cfg["api_key"]) > 7 else "•••"
    cfg.pop("api_key", None)
    return cfg

@api.patch("/whatsapp/config")
async def update_wa_config(payload: WhatsAppConfigIn, _: dict = Depends(require_roles("owner","admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    update["updated_at"] = now_iso()
    await db.whatsapp_config.update_one({"id": "singleton"}, {"$set": update}, upsert=True)
    return await get_wa_config()

@api.get("/whatsapp/status")
async def wa_status(_: dict = Depends(get_current_user)):
    cfg = await _get_wa_config()
    provider = cfg.get("provider") or "simulated"
    if provider == "simulated" or not cfg.get("base_url"):
        return {"provider": provider, "connected": False, "mode": "simulated", "user_jid": None}

    # Try to fetch status from provider
    import httpx
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
        headers["apikey"] = cfg["api_key"]
    url = cfg["base_url"].rstrip("/")
    instance = cfg.get("instance") or "default"
    try:
        async with httpx.AsyncClient(timeout=6.0) as hc:
            if provider == "evolution":
                r = await hc.get(f"{url}/instance/connectionState/{instance}", headers=headers)
            elif provider == "waha":
                r = await hc.get(f"{url}/api/sessions/{instance}", headers=headers)
            else:
                r = await hc.get(f"{url}/status", headers=headers)
            data = r.json() if r.content else {}
    except Exception as e:
        return {"provider": provider, "connected": False, "mode": "provider", "error": str(e)[:200]}

    connected = bool(data.get("connected") or data.get("state") == "open" or data.get("status") == "WORKING")
    user_jid = (data.get("user") or {}).get("id") if isinstance(data.get("user"), dict) else data.get("me")
    await db.whatsapp_config.update_one({"id": "singleton"}, {"$set": {
        "connected": connected, "last_status_at": now_iso(), "user_jid": user_jid,
    }})
    return {"provider": provider, "connected": connected, "mode": "provider", "user_jid": user_jid, "raw": data}

@api.get("/whatsapp/qr")
async def wa_qr(_: dict = Depends(require_roles("owner","admin"))):
    """Return QR code from configured provider (base64 or URL).

    When no provider is configured returns {mode: 'simulated'} — the frontend then
    tells the user how to plug in a Baileys/Evolution/WAHA instance.
    """
    cfg = await _get_wa_config()
    provider = cfg.get("provider") or "simulated"
    if provider == "simulated" or not cfg.get("base_url"):
        return {"mode": "simulated", "qr": None,
                "message": "Configura tu proveedor (Baileys/Evolution/WAHA) en Configurar para habilitar el QR."}

    import httpx
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
        headers["apikey"] = cfg["api_key"]
    url = cfg["base_url"].rstrip("/")
    instance = cfg.get("instance") or "default"
    try:
        async with httpx.AsyncClient(timeout=8.0) as hc:
            if provider == "evolution":
                r = await hc.get(f"{url}/instance/connect/{instance}", headers=headers)
            elif provider == "waha":
                r = await hc.get(f"{url}/api/sessions/{instance}/auth/qr?format=raw", headers=headers)
            else:
                r = await hc.get(f"{url}/qr", headers=headers)
            data = r.json() if r.headers.get("content-type","").startswith("application/json") else {"qr": r.text}
    except Exception as e:
        return {"mode": "provider", "qr": None, "error": str(e)[:200]}
    qr = data.get("qr") or data.get("qrcode") or data.get("base64") or data.get("code")
    return {"mode": "provider", "qr": qr, "raw": data}

@api.post("/whatsapp/disconnect")
async def wa_disconnect(_: dict = Depends(require_roles("owner","admin"))):
    cfg = await _get_wa_config()
    if cfg.get("provider") in (None, "", "simulated") or not cfg.get("base_url"):
        await db.whatsapp_config.update_one({"id": "singleton"}, {"$set": {"connected": False}})
        return {"ok": True, "mode": "simulated"}
    import httpx
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
        headers["apikey"] = cfg["api_key"]
    url = cfg["base_url"].rstrip("/")
    instance = cfg.get("instance") or "default"
    try:
        async with httpx.AsyncClient(timeout=6.0) as hc:
            if cfg["provider"] == "evolution":
                await hc.delete(f"{url}/instance/logout/{instance}", headers=headers)
            elif cfg["provider"] == "waha":
                await hc.post(f"{url}/api/sessions/{instance}/stop", headers=headers)
            else:
                await hc.post(f"{url}/disconnect", headers=headers)
    except Exception:
        pass
    await db.whatsapp_config.update_one({"id": "singleton"}, {"$set": {"connected": False, "user_jid": None}})
    return {"ok": True}

@api.post("/whatsapp/webhook")
async def wa_webhook(request: Request):
    """Receives inbound messages from the configured provider.

    Provider must include header X-Webhook-Token = whatsapp_config.webhook_token,
    OR ?token=... query param. This endpoint accepts multiple provider payload shapes.
    """
    cfg = await _get_wa_config()
    expected = cfg.get("webhook_token") or ""
    token = request.headers.get("x-webhook-token") or request.query_params.get("token") or ""
    if not expected:
        raise HTTPException(400, "Webhook token no configurado. Ajusta el token en /whatsapp/config.")
    import hmac
    if not hmac.compare_digest(expected, token):
        raise HTTPException(401, "Webhook token inválido")

    try:
        body = await request.json()
    except Exception:
        body = {}

    # Normalize
    phone = (body.get("phone") or body.get("from") or body.get("sender")
             or (body.get("data") or {}).get("key", {}).get("remoteJid") or "")
    if isinstance(phone, str):
        phone = phone.replace("@s.whatsapp.net", "").replace("@c.us", "")
    text = (body.get("body") or body.get("message") or body.get("text")
            or ((body.get("data") or {}).get("message") or {}).get("conversation") or "")
    provider_message_id = body.get("provider_message_id") or body.get("id") \
        or ((body.get("data") or {}).get("key") or {}).get("id")
    sender_name = body.get("sender_name") or (body.get("data") or {}).get("pushName")

    if not phone or not text:
        return {"ok": True, "ignored": True, "reason": "missing phone or text"}

    # Idempotency: skip if provider_message_id already stored
    if provider_message_id:
        exists = await db.whatsapp.find_one({"provider_message_id": provider_message_id}, {"_id": 0, "id": 1})
        if exists:
            return {"ok": True, "duplicate": True}

    client = await db.clients.find_one({"phone": phone}, {"_id": 0, "id": 1, "full_name": 1})
    doc = {
        "id": new_id(),
        "client_id": client["id"] if client else None,
        "phone": phone,
        "body": text,
        "direction": "incoming",
        "kind": "chat",
        "channel": "whatsapp",
        "status": "received",
        "provider_message_id": provider_message_id,
        "sender_name": sender_name,
        "created_at": now_iso(),
    }
    await db.whatsapp.insert_one(doc)
    await _get_or_create_conversation(phone, doc["client_id"])
    await db.whatsapp_conversations.update_one(
        {"phone": phone},
        {"$set": {"updated_at": doc["created_at"], "last_body": text[:200],
                  "last_direction": "incoming"}}
    )
    doc.pop("_id", None)
    return {"ok": True, "message": doc}

# --- Funnels (embudos) ---
@api.get("/whatsapp/funnels")
async def list_funnels(_: dict = Depends(get_current_user)):
    items = await db.whatsapp_funnels.find({}, {"_id": 0}).sort("order", 1).to_list(200)
    return items

@api.post("/whatsapp/funnels")
async def create_funnel(payload: WhatsAppFunnelIn, _: dict = Depends(require_roles("owner","admin"))):
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    if payload.is_default:
        await db.whatsapp_funnels.update_many({}, {"$set": {"is_default": False}})
    await db.whatsapp_funnels.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.patch("/whatsapp/funnels/{fid}")
async def update_funnel(fid: str, payload: WhatsAppFunnelUpdate, _: dict = Depends(require_roles("owner","admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    r = await db.whatsapp_funnels.update_one({"id": fid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Embudo no encontrado")
    return await db.whatsapp_funnels.find_one({"id": fid}, {"_id": 0})

@api.delete("/whatsapp/funnels/{fid}")
async def delete_funnel(fid: str, _: dict = Depends(require_roles("owner","admin"))):
    target = await db.whatsapp_funnels.find_one({"id": fid}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Embudo no encontrado")
    if target.get("is_default"):
        raise HTTPException(400, "No se puede eliminar el embudo por defecto")
    default_id = await _ensure_default_funnel_id()
    await db.whatsapp_conversations.update_many({"funnel_id": fid}, {"$set": {"funnel_id": default_id}})
    await db.whatsapp_funnels.delete_one({"id": fid})
    return {"ok": True, "moved_to": default_id}

# --- Conversations ---
@api.get("/whatsapp/conversations")
async def list_conversations(_: dict = Depends(get_current_user)):
    items = await db.whatsapp_conversations.find({}, {"_id": 0}).sort("updated_at", -1).to_list(2000)
    return items

@api.patch("/whatsapp/conversations/{phone}")
async def update_conversation(phone: str, payload: WhatsAppConversationUpdate, _: dict = Depends(get_current_user)):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    # Ensure conversation exists
    await _get_or_create_conversation(phone)
    await db.whatsapp_conversations.update_one({"phone": phone}, {"$set": update})
    return await db.whatsapp_conversations.find_one({"phone": phone}, {"_id": 0})

@api.get("/inbox")
async def inbox(_: dict = Depends(get_current_user)):
    """Unified inbox: latest incoming messages across WhatsApp + Telegram."""
    items = await db.whatsapp.find(
        {"direction": "incoming"}, {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)
    return items

# ---------- Business config ----------
import base64

MAX_LOGO_BYTES = 2 * 1024 * 1024  # 2 MB
ALLOWED_LOGO_MIME = {"image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif"}

@api.get("/config")
async def get_config(_: dict = Depends(get_current_user)):
    doc = await db.config.find_one({"id": "main"}, {"_id": 0})
    if not doc:
        doc = BusinessConfigIn().dict()
        doc["id"] = "main"
        await db.config.insert_one(doc)
        doc.pop("_id", None)
    return doc

@api.put("/config")
async def update_config(payload: BusinessConfigIn, _: dict = Depends(require_roles("owner","admin"))):
    doc = payload.dict()
    doc["id"] = "main"
    doc["updated_at"] = now_iso()
    await db.config.update_one({"id": "main"}, {"$set": doc}, upsert=True)
    return doc

@api.post("/config/logo")
async def upload_logo(file: UploadFile = File(...), _: dict = Depends(require_roles("owner","admin"))):
    """Upload a custom logo (PNG/JPEG/WEBP/SVG/GIF, ≤2MB). Stored as data URL in config."""
    if file.content_type not in ALLOWED_LOGO_MIME:
        raise HTTPException(400, f"Formato no soportado. Usa PNG, JPEG, WEBP, GIF o SVG.")
    data = await file.read()
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(400, "El logo excede 2MB. Reduce el tamaño e inténtalo de nuevo.")
    b64 = base64.b64encode(data).decode("ascii")
    logo_url = f"data:{file.content_type};base64,{b64}"
    await db.config.update_one({"id": "main"}, {"$set": {"logo_url": logo_url, "updated_at": now_iso()}}, upsert=True)
    return {"logo_url": logo_url, "size": len(data), "mime": file.content_type}

@api.delete("/config/logo")
async def delete_logo(_: dict = Depends(require_roles("owner","admin"))):
    await db.config.update_one({"id": "main"}, {"$set": {"logo_url": "", "updated_at": now_iso()}}, upsert=True)
    return {"ok": True}

# ---------- IP Pool ----------
import ipaddress

@api.get("/ip-pool")
async def ip_pool(_: dict = Depends(get_current_user)):
    """Return available and used IPs derived from the network CIDR configured in settings."""
    cfg = await db.config.find_one({"id": "main"}) or {}
    cidr = (cfg.get("network_cidr") or "").strip()
    reserved = set(cfg.get("network_reserved") or [])
    used_docs = await db.clients.find({"ip_address": {"$ne": ""}}, {"_id": 0, "id": 1, "full_name": 1, "ip_address": 1}).to_list(5000)
    used_map = {d["ip_address"]: {"client_id": d["id"], "full_name": d["full_name"]} for d in used_docs if d.get("ip_address")}
    if not cidr:
        return {"cidr": "", "available": [], "used": list(used_map.keys()), "used_map": used_map, "reserved": list(reserved), "total": 0}
    try:
        net = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        raise HTTPException(400, f"CIDR inválido: {cidr}")
    all_hosts = [str(h) for h in net.hosts()]
    available = [ip for ip in all_hosts if ip not in used_map and ip not in reserved]
    return {
        "cidr": cidr,
        "available": available,
        "used": list(used_map.keys()),
        "used_map": used_map,
        "reserved": list(reserved),
        "total": len(all_hosts),
    }

# ---------- Dashboard stats ----------
@api.get("/stats/dashboard")
async def dashboard(_: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    prev_month = (month_start - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    ms_iso = month_start.isoformat()

    # --- Single aggregation for status counts (replaces 5 count_documents) ---
    status_pipe = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    status_rows = await db.clients.aggregate(status_pipe).to_list(50)
    counts = {r["_id"]: r["count"] for r in status_rows}
    total = sum(counts.values())
    active = counts.get("active", 0)
    suspended = counts.get("suspended", 0)
    offline = counts.get("offline", 0)
    new_c = counts.get("new", 0)

    new_month = await db.clients.count_documents({"created_at": {"$gte": ms_iso}})

    # --- Single aggregation for 12 months of revenue (replaces 12+2 aggregations) ---
    # We look back 12 whole months from the current one, using the ISO string
    # prefix `YYYY-MM` as the bucket key.
    cutoff = (month_start.replace(day=1) - timedelta(days=32 * 11)).replace(day=1).isoformat()
    monthly_pipe = [
        {"$match": {"is_promise": {"$ne": True}, "created_at": {"$gte": cutoff}}},
        {"$group": {"_id": {"$substrCP": ["$created_at", 0, 7]}, "s": {"$sum": "$amount"}}},
    ]
    monthly_rows = await db.payments.aggregate(monthly_pipe).to_list(60)
    by_month = {r["_id"]: r["s"] for r in monthly_rows}
    months = []
    for i in range(11, -1, -1):
        d = (month_start.replace(day=15) - timedelta(days=30 * i)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        key = d.strftime("%Y-%m")
        months.append({"month": key, "amount": by_month.get(key, 0)})
    revenue = by_month.get(month_start.strftime("%Y-%m"), 0)
    prev_revenue = by_month.get(prev_month.strftime("%Y-%m"), 0)

    recent = await db.payments.find(
        {"is_promise": {"$ne": True}}, {"_id": 0}
    ).sort("created_at", -1).limit(20).to_list(20)
    # Enrich with client name
    client_ids = list({p.get("client_id") for p in recent if p.get("client_id")})
    clients_map = {}
    if client_ids:
        async for c in db.clients.find({"id": {"$in": client_ids}}, {"_id": 0, "id": 1, "full_name": 1}):
            clients_map[c["id"]] = c.get("full_name")
    for p in recent:
        p["client_name"] = clients_map.get(p.get("client_id"), "—")

    open_leads = await db.leads.count_documents({"status": {"$in": ["new", "in_progress"]}})
    devices = await db.devices.find({}, {"_id": 0, **DEVICE_SECRET_PROJECTION}).to_list(500)
    mikrotiks = [d for d in devices if d.get("kind") == "mikrotik"]
    olts = [d for d in devices if d.get("kind") == "olt"]

    return {
        "total_clients": total, "active": active, "suspended": suspended,
        "offline": offline, "new": new_c, "new_this_month": new_month,
        "revenue_this_month": revenue, "revenue_prev_month": prev_revenue,
        "monthly_revenue": months, "recent_payments": recent,
        "open_leads": open_leads, "disconnected_recent": offline,
        "mikrotiks": mikrotiks, "olts": olts,
    }

# ---------- Mocked ONU / Mikrotik data ----------
@api.get("/onus")
async def list_onus(_: dict = Depends(get_current_user)):
    """Returns deterministic mock ONU data for each client for the OLT panel.

    Values are derived from a SHA-256 hash of the client id so results are stable
    per client and reproducible without using MD5 or the non-cryptographic
    `random` module (values are display-only, not security-sensitive).
    """
    import hashlib
    clients_list = await db.clients.find({}, {"_id": 0, "id":1,"full_name":1,"onu_serial":1,"ip_address":1,"mikrotik_server":1,"status":1,"plan_id":1,"next_due_date":1,"last_seen":1,"onu_power_dbm":1}).to_list(2000)
    result = []
    for c in clients_list:
        h = hashlib.sha256(c["id"].encode()).digest()
        seed = int.from_bytes(h[:4], "big")
        # deterministic pseudo-random values in fixed ranges
        power = c.get("onu_power_dbm") or round(-28.5 + (h[4] / 255.0) * 16.5, 2)  # -28.5..-12
        rx_mbps = round(1 + (h[5] / 255.0) * 89, 1)
        tx_mbps = round(0.2 + (h[6] / 255.0) * 11.8, 1)
        # Derive a stable MAC from the same hash so the ONU list can populate
        # the Clients form MAC picker without needing real OLT data yet.
        mac = ":".join(f"{h[9 + i]:02x}" for i in range(6))
        result.append({
            "client_id": c["id"],
            "full_name": c["full_name"],
            "onu_serial": c.get("onu_serial") or f"ONU{seed:08X}",
            "ip_address": c.get("ip_address") or f"10.10.{h[7] % 255}.{h[8] % 255}",
            "mac": mac,
            "mikrotik_server": c.get("mikrotik_server") or "srv-01",
            "status": c.get("status"),
            "power_dbm": power,
            "rx_mbps": rx_mbps,
            "tx_mbps": tx_mbps,
            "next_due_date": c.get("next_due_date"),
            "last_seen": c.get("last_seen"),
        })
    return result

@api.get("/disconnected")
async def disconnected(_: dict = Depends(get_current_user)):
    """Clients marked offline or without heartbeat > threshold minutes."""
    cfg = await db.config.find_one({"id": "main"}) or {}
    minutes = cfg.get("disconnect_alert_minutes", 30)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    items = await db.clients.find(
        {"$or": [{"status": "offline"}, {"last_seen": {"$lt": cutoff, "$ne": None}}]},
        {"_id": 0}
    ).to_list(2000)
    return items

@api.get("/onus/status")
async def onus_status(_: dict = Depends(get_current_user)):
    """ONU online/offline status with connection duration and 60-min alarm flag.

    online/offline is derived deterministically from the client id (SHA-256 hash)
    so the display stays stable across refreshes. Clients whose `status`
    is `suspended` or `offline` are forced to offline. The connection duration
    (`duration_minutes`) is a stable, per-client value that gently drifts each
    minute so the feed feels alive without inventing false data.
    """
    import hashlib, time
    clients_list = await db.clients.find(
        {}, {"_id": 0, "id":1,"full_name":1,"onu_serial":1,"ip_address":1,
             "mikrotik_server":1,"status":1,"phone":1}
    ).to_list(2000)
    now_ts = int(time.time())
    now = datetime.now(timezone.utc)
    out = []
    online_count = 0
    offline_count = 0
    alarm_count = 0
    for c in clients_list:
        if not c.get("onu_serial"):
            continue
        h = hashlib.sha256(c["id"].encode()).digest()
        # 80% online distribution unless client status forces offline
        forced_offline = c.get("status") in ("suspended", "offline")
        online = (not forced_offline) and (h[0] % 100 < 82)
        # deterministic base duration in minutes (30..24h), drifts +1 per minute
        base_min = 30 + (int.from_bytes(h[1:3], "big") % (60 * 22))
        duration_minutes = base_min + (now_ts // 60) % 240
        alarm = (not online) and duration_minutes > 60
        started = (now - timedelta(minutes=duration_minutes)).isoformat()
        # deterministic ONU metrics (same formula as /api/onus)
        power_dbm = round(-28.5 + (h[4] / 255.0) * 16.5, 2)  # -28.5 .. -12.0
        rx_mbps = round(1 + (h[5] / 255.0) * 89, 1)          # 1 .. 90 Mbps (descarga)
        tx_mbps = round(0.2 + (h[6] / 255.0) * 11.8, 1)      # 0.2 .. 12 Mbps (subida)
        # zero out live bandwidth when offline so the card reflects reality
        if not online:
            rx_mbps = 0
            tx_mbps = 0
        out.append({
            "client_id": c["id"],
            "full_name": c["full_name"],
            "phone": c.get("phone") or "",
            "onu_serial": c.get("onu_serial"),
            "ip_address": c.get("ip_address") or f"10.10.{h[7] % 255}.{h[8] % 255}",
            "mikrotik_server": c.get("mikrotik_server") or "srv-01",
            "online": online,
            "since": started,
            "duration_minutes": duration_minutes,
            "alarm": alarm,
            "client_status": c.get("status") or "active",
            "power_dbm": power_dbm,
            "rx_mbps": rx_mbps,
            "tx_mbps": tx_mbps,
        })
        if online: online_count += 1
        else: offline_count += 1
        if alarm: alarm_count += 1
    return {
        "onus": out,
        "totals": {
            "total": len(out),
            "online": online_count,
            "offline": offline_count,
            "alarms": alarm_count,
            "checked_at": now.isoformat(),
        },
    }

class PaymentReviewIn(BaseModel):
    status: Literal["accepted","rejected","pending_review"]
    review_notes: Optional[str] = ""
    rollback_extension: Optional[bool] = False  # if True, undo the auto-cycle extension on reject


# ---------- Payments to review (from portal uploads) ----------
@api.get("/payments/pending-review")
async def list_pending_review(_: dict = Depends(get_current_user)):
    """Return payments awaiting admin review (uploaded from the client portal).

    Includes the base64 receipt so the admin can preview the photo in-app.
    """
    items = await db.payments.find(
        {"status": {"$in": ["pending_review", "accepted", "rejected"]},
         "created_by_name": {"$regex": "^Portal", "$options": "i"}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    # attach the client's display name so the admin doesn't need to cross-lookup
    client_ids = list({p.get("client_id") for p in items if p.get("client_id")})
    clients = {c["id"]: c for c in await db.clients.find(
        {"id": {"$in": client_ids}},
        {"_id": 0, "id": 1, "full_name": 1, "phone": 1, "status": 1, "next_due_date": 1},
    ).to_list(2000)} if client_ids else {}
    for p in items:
        c = clients.get(p.get("client_id"))
        if c:
            p["client_full_name"] = c.get("full_name")
            p["client_phone"] = c.get("phone")
            p["client_status"] = c.get("status")
            p["client_next_due"] = c.get("next_due_date")
    return items

@api.patch("/payments/{pid}/review")
async def review_payment(pid: str, payload: PaymentReviewIn,
                         user: dict = Depends(require_roles("owner","admin","secretary"))):
    """Admin reviews a portal-uploaded payment (accept / reject / keep pending).

    - `accepted`: mark as approved. Nothing to do — the auto-cycle extension
      already applied at upload time stays.
    - `rejected` + `rollback_extension=true`: revert the cycle extension applied
      at upload time (subtract one payment cycle from next_due_date and, if the
      client is left with a past-due date, mark them as suspended).
    - `pending_review`: keeps the payment in the queue (idempotent).
    """
    payment = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not payment:
        raise HTTPException(404, "Pago no encontrado")

    update = {
        "status": payload.status,
        "review_notes": payload.review_notes or "",
        "reviewed_at": now_iso(),
        "reviewed_by": user.get("id"),
        "reviewed_by_name": user.get("name") or user.get("email"),
        "updated_at": now_iso(),
    }

    # If admin is rejecting and asks to rollback the cycle extension, revert.
    if payload.status == "rejected" and payload.rollback_extension and payment.get("client_id"):
        client = await db.clients.find_one({"id": payment["client_id"]}, {"_id": 0})
        if client and client.get("next_due_date"):
            # Undo: subtract ~30 days from next_due_date
            try:
                d = datetime.fromisoformat(client["next_due_date"].replace("Z", "+00:00"))
                rolled = d - timedelta(days=30)
                new_status = client.get("status")
                if rolled < datetime.now(timezone.utc):
                    new_status = "suspended"
                await db.clients.update_one({"id": client["id"]}, {"$set": {
                    "next_due_date": rolled.isoformat(),
                    "status": new_status,
                    "updated_at": now_iso(),
                }})
            except Exception:
                pass

    await db.payments.update_one({"id": pid}, {"$set": update})
    return await db.payments.find_one({"id": pid}, {"_id": 0})

# ---------- Client portal ----------
MAX_RECEIPT_BYTES = 4 * 1024 * 1024   # 4 MB
ALLOWED_RECEIPT_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"}

def _sanitize_client_portal(c: dict) -> dict:
    """Strip sensitive fields before sending the client dict to the portal."""
    out = {k: v for k, v in c.items() if k not in ("portal_pin_hash", "_id", "notes", "installer_id")}
    return out

@api.post("/portal/login")
async def portal_login(payload: PortalLoginIn, response: Response):
    if not payload.pin:
        raise HTTPException(400, "El PIN es obligatorio")
    pin_input = str(payload.pin).strip()

    # Fast path: match against the plain 8-digit `portal_pin` (unique index)
    client = await db.clients.find_one({"portal_pin": pin_input})

    # Legacy fallback for any doc still on bcrypt-only PIN
    if not client:
        async for doc in db.clients.find({"portal_pin_hash": {"$exists": True}}):
            if verify_password(pin_input, doc.get("portal_pin_hash", "")):
                client = doc
                break

    if not client:
        raise HTTPException(401, "PIN inválido")

    token = create_portal_token(client["id"], client.get("phone", ""))
    _is_https = os.environ.get("PUBLIC_BASE_URL", "").lower().startswith("https")
    response.set_cookie(
        PORTAL_COOKIE, token,
        max_age=30 * 24 * 3600, httponly=True, secure=_is_https, samesite="lax", path=COOKIE_PATH,
    )
    return {"token": token, "client": _sanitize_client_portal({k: v for k, v in client.items() if k != "portal_pin_hash"})}

@api.post("/portal/logout")
async def portal_logout(response: Response):
    response.delete_cookie(PORTAL_COOKIE, path=COOKIE_PATH)
    return {"ok": True}

@api.get("/portal/me")
async def portal_me(client: dict = Depends(get_portal_client)):
    plan = None
    if client.get("plan_id"):
        plan = await db.plans.find_one({"id": client["plan_id"]},
            {"_id": 0, "name": 1, "speed_mbps": 1, "upload_mbps": 1, "download_mbps": 1, "price": 1})
    return {"client": _sanitize_client_portal(client), "plan": plan}

@api.get("/portal/payments")
async def portal_payments(client: dict = Depends(get_portal_client)):
    items = await db.payments.find(
        {"client_id": client["id"]},
        {"_id": 0, "receipt_url": 0},
    ).sort("created_at", -1).to_list(200)
    # Ensure review metadata is exposed so the client sees Aceptado / Rechazado
    for p in items:
        p.setdefault("review_notes", p.get("review_notes", ""))
        p.setdefault("reviewed_by_name", p.get("reviewed_by_name"))
        p.setdefault("reviewed_at", p.get("reviewed_at"))
    return items

@api.get("/portal/onu")
async def portal_onu(client: dict = Depends(get_portal_client)):
    """Return deterministic live-looking values for the client's ONU. Mirrors
    the same hash-based mock used by staff `/api/onus` so the two views agree.
    """
    import hashlib
    seed = (client.get("onu_serial") or client.get("id") or "seed").encode()
    h = hashlib.sha256(seed).digest()
    now = datetime.now(timezone.utc)
    minute = int(now.timestamp() // 15)  # rotate every 15s
    jitter = int(hashlib.sha256(seed + str(minute).encode()).digest()[0]) / 255
    power = -12 - (h[0] % 16) - jitter * 0.7
    rx = 1 + (h[1] % 89) + jitter * 4
    tx = 0.2 + (h[2] % 11) + jitter * 0.8
    online = client.get("status") in ("active",)
    # Build 30-min sparkline
    series = []
    for i in range(30):
        step = int(hashlib.sha256(seed + f"s{i}{minute}".encode()).digest()[0]) / 255
        series.append({
            "t": (now - timedelta(minutes=29 - i)).strftime("%H:%M"),
            "rx": round(rx * (0.6 + step * 0.8), 2),
            "tx": round(tx * (0.5 + step * 0.9), 2),
        })
    return {
        "online": online,
        "power_dbm": round(power, 1),
        "rx_mbps": round(rx, 2),
        "tx_mbps": round(tx, 2),
        "ip_address": client.get("ip_address") or "",
        "series": series,
        "checked_at": now.isoformat(),
    }

@api.post("/portal/payments/upload")
async def portal_upload_receipt(
    file: UploadFile = File(...),
    amount: Optional[float] = None,
    method: Optional[str] = "transfer",
    notes: Optional[str] = "",
    client: dict = Depends(get_portal_client),
):
    """Client uploads a payment receipt. Instantly extends `next_due_date` by
    one cycle and marks the client as `active`, so service turns back on right
    away. The payment lands with status=`pending_review` for the admin to
    reconcile from the Pagos module."""
    if file.content_type not in ALLOWED_RECEIPT_MIME:
        raise HTTPException(415, f"Tipo de archivo no soportado: {file.content_type}")
    data = await file.read()
    if len(data) > MAX_RECEIPT_BYTES:
        raise HTTPException(413, "Archivo mayor a 4 MB")
    import base64
    b64 = base64.b64encode(data).decode("ascii")
    receipt_url = f"data:{file.content_type};base64,{b64}"

    doc = {
        "id": new_id(),
        "client_id": client["id"],
        "amount": amount or 0,
        "method": method or "transfer",
        "concept": "Comprobante subido por cliente",
        "notes": notes or "",
        "is_promise": False,
        "status": "pending_review",
        "receipt_url": receipt_url,
        "receipt_mime": file.content_type,
        "receipt_size": len(data),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_by": None,
        "created_by_name": f"Portal · {client.get('full_name','')}",
    }
    await db.payments.insert_one(doc)

    # Instant reactivation: extend one billing cycle and set active
    current_due = client.get("next_due_date") or now_iso()
    new_due = _next_due_date(client.get("payment_day", 1), current_due)
    await db.clients.update_one(
        {"id": client["id"]},
        {"$set": {"next_due_date": new_due, "status": "active", "updated_at": now_iso(),
                  "last_payment_at": now_iso()}},
    )
    doc.pop("_id", None)
    doc["receipt_url"] = None  # never echo full base64 back to portal user
    return {"payment": doc, "new_due_date": new_due, "status": "active"}

# ---------- Payment reminders ----------
DEFAULT_REMINDER_TEMPLATE = (
    "Hola {{name}}, te recordamos que tu pago de {{amount}} vence el {{due_date}}. "
    "Puedes pagar y activar tu servicio en {{portal_url}}. ¡Gracias!"
)

async def _get_reminder_config() -> dict:
    cfg = await db.reminder_config.find_one({"id": "singleton"}, {"_id": 0})
    if cfg:
        return cfg
    cfg = {
        "id": "singleton",
        "template": DEFAULT_REMINDER_TEMPLATE,
        "days_before": 3,
        "auto_send": False,
        "active_hours_start": 9,
        "active_hours_end": 19,
        "updated_at": now_iso(),
    }
    await db.reminder_config.insert_one(cfg)
    cfg.pop("_id", None)
    return cfg

def _render_template(tpl: str, ctx: dict) -> str:
    out = tpl or ""
    for k, v in ctx.items():
        out = out.replace("{{" + k + "}}", str(v))
    return out

async def _build_reminder_context(c: dict, plan: Optional[dict], portal_base: str) -> dict:
    return {
        "name": c.get("full_name", ""),
        "amount": (plan or {}).get("price") or "-",
        "due_date": (c.get("next_due_date") or "")[:10],
        "plan": (plan or {}).get("name") or "",
        "portal_url": portal_base,
        "phone": c.get("phone", ""),
    }

@api.get("/reminders/config")
async def get_reminder_config(_: dict = Depends(require_roles("owner","admin"))):
    return await _get_reminder_config()

@api.patch("/reminders/config")
async def update_reminder_config(payload: ReminderConfigIn,
                                 _: dict = Depends(require_roles("owner","admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        return await _get_reminder_config()
    update["updated_at"] = now_iso()
    await db.reminder_config.update_one({"id": "singleton"}, {"$set": update}, upsert=True)
    return await _get_reminder_config()

@api.get("/reminders/preview")
async def preview_reminders(days_before: Optional[int] = None,
                            _: dict = Depends(require_roles("owner","admin","secretary"))):
    cfg = await _get_reminder_config()
    n = int(days_before if days_before is not None else cfg.get("days_before", 3))
    now = datetime.now(timezone.utc)
    target = (now + timedelta(days=n)).date()
    # Find clients whose next_due_date falls on the target date
    cursor = db.clients.find(
        {"status": {"$in": ["active", "new", "offline"]}, "phone": {"$ne": ""}},
        {"_id": 0, "id": 1, "full_name": 1, "phone": 1, "next_due_date": 1, "plan_id": 1, "status": 1}
    )
    all_clients = await cursor.to_list(5000)
    matches = []
    for c in all_clients:
        due = c.get("next_due_date")
        if not due:
            continue
        try:
            due_date = datetime.fromisoformat(due.replace("Z", "+00:00")).date()
        except Exception:
            continue
        days_left = (due_date - now.date()).days
        if 0 <= days_left <= n:
            matches.append({**c, "days_left": days_left, "due_date": due[:10]})
    matches.sort(key=lambda x: x["days_left"])
    return {"config": cfg, "n_days": n, "clients": matches, "count": len(matches)}

@api.post("/reminders/send")
async def send_reminders(payload: ReminderSendIn, user: dict = Depends(require_roles("owner","admin","secretary"))):
    cfg = await _get_reminder_config()
    tpl = payload.template or cfg.get("template") or DEFAULT_REMINDER_TEMPLATE
    portal_base = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/") + "/portal"

    sent, skipped, errors = [], [], []
    for cid in payload.client_ids:
        c = await db.clients.find_one({"id": cid}, {"_id": 0})
        if not c:
            skipped.append({"id": cid, "reason": "not_found"}); continue
        if not c.get("phone"):
            skipped.append({"id": cid, "reason": "no_phone"}); continue
        plan = await db.plans.find_one({"id": c.get("plan_id")}, {"_id": 0, "name": 1, "price": 1}) if c.get("plan_id") else None
        ctx = await _build_reminder_context(c, plan, portal_base)
        body = _render_template(tpl, ctx)
        doc = {
            "id": new_id(),
            "client_id": c["id"],
            "phone": c["phone"],
            "body": body,
            "direction": "outgoing",
            "kind": payload.kind,
            "channel": "whatsapp",
            "status": "queued",
            "created_at": now_iso(),
            "responded_by": user.get("id"),
            "responded_by_name": user.get("name") or user.get("email"),
        }
        await db.whatsapp.insert_one(doc)
        # Ensure a conversation entry exists for the Kanban
        try:
            await _get_or_create_conversation(c["phone"], c["id"])
            await db.whatsapp_conversations.update_one(
                {"phone": c["phone"]},
                {"$set": {"updated_at": doc["created_at"], "last_body": body[:200], "last_direction": "outgoing"}}
            )
        except Exception:
            pass
        sent.append({"id": c["id"], "phone": c["phone"], "message_id": doc["id"]})
    return {"sent": len(sent), "skipped": len(skipped), "sent_list": sent, "skipped_list": skipped, "errors": errors}

async def _run_send_reminders(run_id: str):
    existing = await db.cron_runs.find_one({"run_id": run_id})
    if existing:
        return
    cfg = await _get_reminder_config()
    n = int(cfg.get("days_before", 3))
    now = datetime.now(timezone.utc)
    hour = now.hour
    if not (int(cfg.get("active_hours_start", 9)) <= hour < int(cfg.get("active_hours_end", 19))):
        await db.cron_runs.insert_one({
            "run_id": run_id, "job": "send-reminders",
            "started_at": now.isoformat(), "sent_count": 0, "skipped_reason": "outside_active_hours",
        })
        return
    portal_base = (os.environ.get("PUBLIC_BASE_URL") or "").rstrip("/") + "/portal"

    cursor = db.clients.find(
        {"status": {"$in": ["active", "new", "offline"]}, "phone": {"$ne": ""}, "next_due_date": {"$ne": None}},
        {"_id": 0}
    )
    all_clients = await cursor.to_list(5000)
    target = now.date() + timedelta(days=n)
    sent = 0
    tpl = cfg.get("template") or DEFAULT_REMINDER_TEMPLATE
    for c in all_clients:
        due = c.get("next_due_date")
        try:
            due_date = datetime.fromisoformat(due.replace("Z", "+00:00")).date()
        except Exception:
            continue
        if due_date != target:
            continue
        plan = await db.plans.find_one({"id": c.get("plan_id")}, {"_id": 0, "name": 1, "price": 1}) if c.get("plan_id") else None
        ctx = await _build_reminder_context(c, plan, portal_base)
        body = _render_template(tpl, ctx)
        await db.whatsapp.insert_one({
            "id": new_id(), "client_id": c["id"], "phone": c["phone"],
            "body": body, "direction": "outgoing", "kind": "reminder",
            "channel": "whatsapp", "status": "queued", "created_at": now_iso(),
            "responded_by_name": "Cron · Recordatorios",
        })
        sent += 1
    await db.cron_runs.insert_one({
        "run_id": run_id, "job": "send-reminders",
        "started_at": now.isoformat(), "sent_count": sent,
        "days_before": n,
    })
    logger.info("[cron] send-reminders run_id=%s sent=%d", run_id, sent)

@api.post("/cron/send-reminders")
async def cron_send_reminders(request: Request):
    import hmac
    secret = os.environ.get("WEBHOOK_CRON_SECRET") or ""
    auth = request.headers.get("authorization") or ""
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not secret or not token or not hmac.compare_digest(token, secret):
        raise HTTPException(401, "Unauthorized cron webhook")
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("x-webhook-id") or body.get("run_id") or new_id()
    asyncio.create_task(_run_send_reminders(run_id))
    return {"ok": True, "queued_run_id": run_id}

# ---------- Lugares (community/place catalog) ----------
@api.get("/lugares")
async def list_lugares(_: dict = Depends(get_current_user)):
    items = await db.lugares.find({}, {"_id": 0}).sort("name", 1).to_list(2000)
    return items

@api.post("/lugares")
async def create_lugar(payload: LugarIn, user: dict = Depends(require_roles("owner","admin"))):
    existing = await db.lugares.find_one({"name": payload.name}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(400, f"Ya existe un lugar con el nombre '{payload.name}'")
    doc = strip_pending(payload.dict())
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    return await stage_create("lugares", doc, user)

@api.patch("/lugares/{lid}")
async def update_lugar(lid: str, payload: LugarUpdate,
                       user: dict = Depends(require_permission("lugares", "write"))):
    update = strip_pending({k: v for k, v in payload.dict().items() if v is not None})
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    old = await db.lugares.find_one({"id": lid}, {"_id": 0, "name": 1})
    if not old:
        raise HTTPException(404, "Lugar no encontrado")
    # El arrastre del nombre a los clientes ocurre al confirmar.
    return await stage_update("lugares", lid, update, user)

@api.delete("/lugares/{lid}")
async def delete_lugar(lid: str, user: dict = Depends(require_permission("lugares", "delete"))):
    doc = await db.lugares.find_one({"id": lid}, {"_id": 0, "name": 1})
    if not doc:
        raise HTTPException(404, "Lugar no encontrado")
    used = await db.clients.count_documents({"community": doc["name"]})
    res = await stage_delete("lugares", lid, user)
    return {**res, "clients_affected": used}

# ---------- Trabajadores (workforce roster) ----------
@api.get("/trabajadores")
async def list_trabajadores(_: dict = Depends(get_current_user)):
    items = await db.trabajadores.find({}, {"_id": 0}).sort("full_name", 1).to_list(2000)
    return items

@api.post("/trabajadores")
async def create_trabajador(payload: TrabajadorIn, user: dict = Depends(require_roles("owner","admin"))):
    doc = strip_pending(payload.dict())
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    return await stage_create("trabajadores", doc, user)

@api.patch("/trabajadores/{tid}")
async def update_trabajador(tid: str, payload: TrabajadorUpdate,
                            user: dict = Depends(require_roles("owner","admin"))):
    update = strip_pending({k: v for k, v in payload.dict().items() if v is not None})
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    res = await stage_update("trabajadores", tid, update, user)
    if res is None:
        raise HTTPException(404, "Trabajador no encontrado")
    return res

@api.delete("/trabajadores/{tid}")
async def delete_trabajador(tid: str, user: dict = Depends(require_roles("owner","admin"))):
    return await stage_delete("trabajadores", tid, user)


class WorkDayIn(BaseModel):
    date: str  # YYYY-MM-DD

def _week_bounds(anchor_iso: Optional[str] = None) -> tuple[str, str]:
    """Return the ISO date bounds (Sunday..Saturday inclusive) of the week
    containing ``anchor_iso`` — pay week runs Sun→Sat with cut-off Saturday."""
    if anchor_iso:
        try:
            anchor = datetime.strptime(anchor_iso[:10], "%Y-%m-%d").date()
        except ValueError:
            anchor = datetime.now(timezone.utc).date()
    else:
        anchor = datetime.now(timezone.utc).date()
    # Sunday=6 in Python's weekday() (Mon=0..Sun=6). Move back to previous Sunday.
    days_since_sunday = (anchor.weekday() + 1) % 7  # Sun->0, Mon->1, ..., Sat->6
    sunday = anchor - timedelta(days=days_since_sunday)
    saturday = sunday + timedelta(days=6)
    return sunday.isoformat(), saturday.isoformat()

@api.post("/trabajadores/{tid}/work-days/toggle")
async def toggle_work_day(tid: str, payload: WorkDayIn,
                          _: dict = Depends(require_roles("owner","admin","secretary"))):
    """Marca o desmarca un día trabajado para el colaborador."""
    doc = await db.trabajadores.find_one({"id": tid}, {"_id": 0, "work_days": 1})
    if not doc:
        raise HTTPException(404, "Colaborador no encontrado")
    days = set(doc.get("work_days") or [])
    d = payload.date[:10]
    if d in days:
        days.remove(d)
        added = False
    else:
        days.add(d)
        added = True
    await db.trabajadores.update_one({"id": tid}, {"$set": {
        "work_days": sorted(days),
        "updated_at": now_iso(),
    }})
    return {"ok": True, "added": added, "date": d, "work_days": sorted(days)}

@api.get("/trabajadores/week-summary")
async def week_summary(anchor: Optional[str] = None,
                       _: dict = Depends(get_current_user)):
    """Resumen semanal (Domingo → Sábado con corte los sábados). Devuelve por
    cada colaborador activo la cantidad de días trabajados y el monto a pagar
    esa semana (días × sueldo_diario)."""
    start, end = _week_bounds(anchor)
    trabajadores = await db.trabajadores.find({}, {"_id": 0}).sort("full_name", 1).to_list(2000)
    result = []
    grand_total = 0.0
    for t in trabajadores:
        days = [d for d in (t.get("work_days") or []) if start <= d <= end]
        rate = float(t.get("daily_rate") or 0)
        total = round(rate * len(days), 2)
        grand_total += total
        result.append({
            "id": t["id"],
            "full_name": t["full_name"],
            "role": t.get("role"),
            "active": t.get("active", True),
            "community": t.get("community"),
            "daily_rate": rate,
            "days_worked_this_week": days,
            "days_count": len(days),
            "weekly_total": total,
        })
    return {
        "week_start": start,     # Sunday
        "week_end": end,         # Saturday cut-off
        "grand_total": round(grand_total, 2),
        "trabajadores": result,
    }

# ---------- Energía de respaldo (Growatt ShinePhone) ----------
from growatt import get_estado_cached, read_growatt_estado  # noqa: E402
class EnergyPlantIn(BaseModel):
    name: str
    plant_id: str
    device_sn: Optional[str] = ""
    color: Optional[str] = "#22c55e"
    order: Optional[int] = 0

class EnergyPlantUpdate(BaseModel):
    name: Optional[str] = None
    plant_id: Optional[str] = None
    device_sn: Optional[str] = None
    color: Optional[str] = None
    order: Optional[int] = None

async def _seed_default_plant():
    """One-time seed: if no plants exist and env has GROWATT_PLANT_ID, create it."""
    count = await db.energy_plants.count_documents({})
    if count == 0 and os.environ.get("GROWATT_PLANT_ID"):
        await db.energy_plants.insert_one({
            "id": new_id(),
            "name": "Principal",
            "plant_id": os.environ["GROWATT_PLANT_ID"],
            "device_sn": os.environ.get("GROWATT_DEVICE_SN") or "",
            "color": "#22c55e",
            "order": 0,
            "created_at": now_iso(),
        })

@api.get("/energia/plants")
async def list_energy_plants(_: dict = Depends(get_current_user)):
    await _seed_default_plant()
    items = await db.energy_plants.find({}, {"_id": 0}).sort("order", 1).to_list(50)
    return items

@api.post("/energia/plants")
async def create_energy_plant(payload: EnergyPlantIn,
                              user: dict = Depends(require_roles("owner","admin"))):
    doc = strip_pending(payload.dict())
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    return await stage_create("energy_plants", doc, user)

@api.patch("/energia/plants/{pid}")
async def update_energy_plant(pid: str, payload: EnergyPlantUpdate,
                              user: dict = Depends(require_roles("owner","admin"))):
    update = strip_pending({k: v for k, v in payload.dict().items() if v is not None})
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    res = await stage_update("energy_plants", pid, update, user)
    if res is None:
        raise HTTPException(404, "Planta no encontrada")
    return res

@api.delete("/energia/plants/{pid}")
async def delete_energy_plant(pid: str, user: dict = Depends(require_roles("owner","admin"))):
    return await stage_delete("energy_plants", pid, user)

@api.get("/energia/estado")
async def energia_estado(plant: Optional[str] = None, force: bool = False,
                         _: dict = Depends(get_current_user)):
    """Estado en tiempo real del sistema de almacenamiento.

    Si ``plant`` está presente, se usa como el ID interno de la planta guardado
    en ``energy_plants`` (no el plant_id de Growatt). Sin este parámetro se usa
    la planta por defecto (``GROWATT_PLANT_ID`` en el .env).
    """
    plant_id = None
    device_sn = None
    plant_meta = None
    if plant:
        plant_meta = await db.energy_plants.find_one({"id": plant}, {"_id": 0})
        if not plant_meta:
            raise HTTPException(404, "Planta no encontrada")
        plant_id = plant_meta.get("plant_id")
        device_sn = plant_meta.get("device_sn") or None
    try:
        if force:
            api_key = os.environ.get("GROWATT_API_KEY")
            base_url = os.environ.get("GROWATT_BASE_URL") or "https://openapi.growatt.com/v1"
            pid = plant_id or os.environ.get("GROWATT_PLANT_ID")
            sn = device_sn if device_sn is not None else (os.environ.get("GROWATT_DEVICE_SN") or None)
            if not api_key or not pid:
                raise RuntimeError("Growatt no configurado")
            state = await read_growatt_estado(api_key, pid, base_url, sn)
            state["plant_id"] = pid
            await db.energia_estado.replace_one(
                {"_id": f"current-{pid}"}, {"_id": f"current-{pid}", **state}, upsert=True
            )
            state["cached"] = False
        else:
            state = await get_estado_cached(db, plant_id=plant_id, device_sn=device_sn)
        if plant_meta:
            state["plant_name"] = plant_meta.get("name")
            state["plant_color"] = plant_meta.get("color")
            state["plant_ref"] = plant_meta.get("id")
        return state
    except Exception as e:
        logger.exception("Growatt fetch failed")
        raise HTTPException(502, f"No se pudo leer Growatt: {e}")

# ---------- Startup ----------
async def _run_suspend_overdue(run_id: str):
    """Background worker that suspends clients whose next_due_date has passed.

    Idempotent: keeps a record in db.cron_runs keyed by run_id so retries of
    the same webhook delivery don't double-suspend or double-log.
    """
    existing = await db.cron_runs.find_one({"run_id": run_id})
    if existing:
        return
    now = datetime.now(timezone.utc)
    cursor = db.clients.find(
        {"status": {"$in": ["active", "new"]}, "next_due_date": {"$lt": now.isoformat(), "$ne": None}},
        {"_id": 0, "id": 1, "full_name": 1, "next_due_date": 1},
    )
    to_suspend = await cursor.to_list(10000)
    blocked_ok = blocked_fail = 0
    if to_suspend:
        ids = [c["id"] for c in to_suspend]
        await db.clients.update_many(
            {"id": {"$in": ids}},
            {"$set": {"status": "suspended", "updated_at": now.isoformat(),
                      "suspended_at": now.isoformat(), "suspended_reason": "billing_overdue"}}
        )
        # El corte real: sin esto el cliente queda marcado como suspendido en
        # el CRM pero sigue navegando igual.
        for c in to_suspend:
            full = await db.clients.find_one({"id": c["id"]}, {"_id": 0})
            res = await _apply_overdue_block(full or c, True)
            if res.get("ok"):
                blocked_ok += 1
            else:
                blocked_fail += 1
                await db.clients.update_one({"id": c["id"]}, {"$set": {
                    "overdue_block_error": res.get("reason", "")[:200]}})
    await db.cron_runs.insert_one({
        "run_id": run_id,
        "job": "suspend-overdue",
        "started_at": now.isoformat(),
        "suspended_count": len(to_suspend),
        "blocked_ok": blocked_ok,
        "blocked_failed": blocked_fail,
        "sample": [c["full_name"] for c in to_suspend[:10]],
    })
    logger.info("[cron] suspend-overdue run_id=%s suspended=%d", run_id, len(to_suspend))

@api.post("/cron/suspend-overdue")
async def cron_suspend_overdue(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    import hmac
    secret = os.environ.get("WEBHOOK_CRON_SECRET") or ""
    auth = request.headers.get("authorization") or ""
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not secret or not token or not hmac.compare_digest(token, secret):
        raise HTTPException(401, "Unauthorized cron webhook")
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = request.headers.get("x-webhook-id") or body.get("run_id") or new_id()
    asyncio.create_task(_run_suspend_overdue(run_id))
    return {"ok": True, "queued_run_id": run_id}

@api.get("/cron/runs")
async def list_cron_runs(_: dict = Depends(require_roles("owner","admin"))):
    """Recent cron run history so the operator can see when auto-billing ran
    and how many clients were suspended each time."""
    items = await db.cron_runs.find({}, {"_id": 0}).sort("started_at", -1).to_list(50)
    return items

# ---------- Startup (seed) ----------
async def _backfill_contract_numbers():
    """One-time migration: clientes creados antes de que existiera el número
    de contrato lo reciben ahora, en orden de alta (el más antiguo, el #1).
    El contador se deja apuntando al último asignado para que las altas
    nuevas sigan justo después. Idempotente: si ya no hay nadie sin número,
    no toca nada."""
    without = await db.clients.find(
        {"$or": [{"contract_number": {"$exists": False}}, {"contract_number": None}]},
        {"_id": 0, "id": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(100000)
    if not without:
        return
    counter = await db.counters.find_one({"_id": "client_contract_number"})
    seq = (counter or {}).get("seq", 0)
    for c in without:
        seq += 1
        await db.clients.update_one({"id": c["id"]}, {"$set": {"contract_number": seq}})
    await db.counters.update_one(
        {"_id": "client_contract_number"}, {"$set": {"seq": seq}}, upsert=True,
    )


async def _backfill_portal_pins():
    """One-time migration: assign 8-digit unique `portal_pin` to every client
    that doesn't have one yet (was on legacy 6-digit bcrypt scheme or never
    got one). Also drops the legacy `portal_pin_hash` field once replaced."""
    import secrets
    existing: set[str] = set()
    async for doc in db.clients.find(
        {"portal_pin": {"$exists": True, "$ne": None}},
        {"portal_pin": 1, "_id": 0},
    ):
        p = doc.get("portal_pin")
        if p:
            existing.add(str(p))

    async for c in db.clients.find(
        {"$or": [{"portal_pin": {"$exists": False}}, {"portal_pin": None}, {"portal_pin": ""}]},
        {"_id": 0, "id": 1},
    ):
        for _ in range(50):
            pin = f"{secrets.randbelow(10**8):08d}"
            if pin in existing:
                continue
            existing.add(pin)
            await db.clients.update_one(
                {"id": c["id"]},
                {"$set": {"portal_pin": pin}, "$unset": {"portal_pin_hash": ""}},
            )
            break


async def seed():
    await db.users.create_index("email", unique=True)
    await db.clients.create_index("status")
    await db.clients.create_index("portal_pin", unique=True, sparse=True)
    await db.payments.create_index("client_id")
    await db.whatsapp_funnels.create_index("id", unique=True)
    await db.whatsapp_conversations.create_index("phone", unique=True)
    await db.whatsapp.create_index("provider_message_id", sparse=True)

    # Backfill any missing portal PINs (idempotent).
    await _backfill_portal_pins()
    # Backfill missing contract numbers (idempotent).
    await _backfill_contract_numbers()

    # Seed default WhatsApp funnels once
    existing_funnel_count = await db.whatsapp_funnels.count_documents({})
    if existing_funnel_count == 0:
        for f in DEFAULT_FUNNELS:
            await db.whatsapp_funnels.insert_one({
                "id": new_id(), "created_at": now_iso(), **f
            })
    admin_email = os.environ["ADMIN_EMAIL"].lower().strip()
    admin_password = os.environ["ADMIN_PASSWORD"]
    admin_name = os.environ.get("ADMIN_NAME", "Owner")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": new_id(), "email": admin_email, "name": admin_name, "role": "owner",
            "password_hash": hash_password(admin_password), "active": True,
            "phone": "", "created_at": now_iso(),
        })
    elif not verify_password(admin_password, existing.get("password_hash","")):
        await db.users.update_one({"email": admin_email},
                                  {"$set": {"password_hash": hash_password(admin_password), "role": "owner", "active": True}})

@app.on_event("startup")
async def _startup():
    await seed()
    logger.info("ISP CRM ready.")

@app.on_event("shutdown")
async def _shutdown():
    client.close()

# ---------- Tuya / Smart Life IoT integration ----------
from tuya import TuyaClient, TuyaError, REGION_ENDPOINTS  # noqa: E402


class TuyaConfigIn(BaseModel):
    access_id: Optional[str] = None
    access_secret: Optional[str] = None
    region: Optional[Literal["us", "eu", "cn", "in", "we", "ue"]] = None
    project_code: Optional[str] = None


class TuyaRenameIn(BaseModel):
    name: str


class TuyaCommand(BaseModel):
    code: str
    value: Any


class TuyaCommandsIn(BaseModel):
    commands: List[TuyaCommand]


async def _tuya_config_doc() -> dict:
    doc = await db.tuya_config.find_one({"key": "singleton"}, {"_id": 0}) or {}
    return doc.get("value", {}) if isinstance(doc, dict) else {}


async def _tuya_client() -> TuyaClient:
    cfg = await _tuya_config_doc()
    if not cfg.get("access_id") or not cfg.get("access_secret"):
        raise HTTPException(400, "Tuya no está configurado. Guarda Access ID y Access Secret en /smart-life.")
    return TuyaClient(
        access_id=cfg["access_id"],
        access_secret=cfg["access_secret"],
        region=cfg.get("region", "us"),
        project_code=cfg.get("project_code", ""),
        db=db,
    )


def _mask_secret(s: str) -> str:
    if not s: return ""
    if len(s) <= 8: return "*" * len(s)
    return s[:4] + "*" * (len(s) - 8) + s[-4:]


@api.get("/tuya/config")
async def tuya_get_config(_: dict = Depends(require_roles("owner", "admin"))):
    cfg = await _tuya_config_doc()
    return {
        "access_id": cfg.get("access_id", ""),
        "access_secret_masked": _mask_secret(cfg.get("access_secret", "")),
        "has_secret": bool(cfg.get("access_secret")),
        "region": cfg.get("region", "us"),
        "project_code": cfg.get("project_code", ""),
        "regions": list(REGION_ENDPOINTS.keys()),
        "endpoint": REGION_ENDPOINTS.get(cfg.get("region", "us")),
        "configured": bool(cfg.get("access_id") and cfg.get("access_secret")),
        "updated_at": cfg.get("updated_at"),
    }


@api.patch("/tuya/config")
async def tuya_save_config(payload: TuyaConfigIn,
                           _: dict = Depends(require_roles("owner", "admin"))):
    current = await _tuya_config_doc()
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    # Preserve secret if the user sends an empty/masked value
    if "access_secret" in update and (not update["access_secret"] or "*" in update["access_secret"]):
        update.pop("access_secret")
    merged = {**current, **update, "updated_at": now_iso()}
    await db.tuya_config.update_one({"key": "singleton"},
                                    {"$set": {"value": merged}},
                                    upsert=True)
    return {
        "ok": True,
        "region": merged.get("region", "us"),
        "endpoint": REGION_ENDPOINTS.get(merged.get("region", "us")),
        "configured": bool(merged.get("access_id") and merged.get("access_secret")),
    }


@api.post("/tuya/test-auth")
async def tuya_test_auth(_: dict = Depends(require_roles("owner", "admin"))):
    """Force a token refresh to validate the stored credentials."""
    try:
        cli = await _tuya_client()
        return await cli.test_auth()
    except TuyaError as e:
        raise HTTPException(424, f"Tuya {e.code}: {e.msg}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


@api.get("/tuya/devices")
async def tuya_list_devices(_: dict = Depends(get_current_user)):
    """List all devices under this Tuya project, augmented with current status."""
    try:
        cli = await _tuya_client()
        devs = await cli.list_devices()
    except TuyaError as e:
        raise HTTPException(424, f"Tuya {e.code}: {e.msg}")
    # For each device, try to fetch status (best effort)
    out = []
    for d in devs:
        did = d.get("id") or d.get("device_id") or d.get("dev_id")
        if not did:
            continue
        status_map: dict = {}
        try:
            status_list = await cli.get_status(did)
            for s in status_list:
                if isinstance(s, dict) and "code" in s:
                    status_map[s["code"]] = s.get("value")
        except TuyaError as e:
            logger.warning("Tuya status failed for %s: %s", did, e)
        out.append({
            "id": did,
            "name": d.get("name") or d.get("custom_name") or did,
            "product_name": d.get("product_name") or d.get("productName") or "",
            "category": d.get("category") or "",
            "icon": d.get("icon") or "",
            "online": bool(d.get("online")),
            "ip": d.get("ip") or "",
            "time_zone": d.get("time_zone") or "",
            "active_time": d.get("active_time"),
            "update_time": d.get("update_time"),
            "status": status_map,
        })
    return out


@api.get("/tuya/devices/{device_id}/status")
async def tuya_device_status(device_id: str, _: dict = Depends(get_current_user)):
    try:
        cli = await _tuya_client()
        return await cli.get_status(device_id)
    except TuyaError as e:
        raise HTTPException(424, f"Tuya {e.code}: {e.msg}")


@api.post("/tuya/devices/{device_id}/commands")
async def tuya_send_commands(device_id: str, payload: TuyaCommandsIn,
                             _: dict = Depends(get_current_user)):
    try:
        cli = await _tuya_client()
        ok = await cli.send_commands(device_id, [c.dict() for c in payload.commands])
    except TuyaError as e:
        # On 2008 (command not supported), fetch the device's real DP codes to
        # help the user pick a supported one.
        supported = None
        if e.code == 2008:
            try:
                fns = await cli.get_functions(device_id)
                supported = fns.get("functions") if isinstance(fns, dict) else fns
                logger.info("Tuya functions fetched for %s: %s", device_id,
                            [f.get('code') for f in (supported or []) if isinstance(f, dict)])
            except Exception as ex:
                logger.warning("Tuya get_functions failed for %s: %s", device_id, ex)
        detail = f"Tuya {e.code}: {e.msg}"
        if supported:
            codes = [f.get("code") for f in (supported or []) if isinstance(f, dict) and f.get("code")]
            if codes:
                detail += f" · Códigos soportados: {', '.join(codes[:12])}"
        # Add category-specific hint
        try:
            info = await cli.device_exists(device_id)
            cat = (info or {}).get("category", "")
            if cat == "infrared_ac":
                detail += " · Este es un A/C controlado por IR bridge. Los códigos DP estándar suelen NO aplicarse porque el bridge necesita el endpoint /v2.0/infrareds/{ir_id}/air-conditioners/{remote_id}/command."
        except Exception:
            pass
        raise HTTPException(424, detail)

    # If Tuya API returned success=true but result=false, the command was
    # accepted at the envelope level but not applied by the device — this
    # happens frequently for infrared_ac devices where the DP code is wrong.
    # Fetch functions so the user can see what codes are supported.
    if not ok:
        supported_codes: List[str] = []
        try:
            fns = await cli.get_functions(device_id)
            fn_list = fns.get("functions") if isinstance(fns, dict) else fns
            if isinstance(fn_list, list):
                for f in fn_list:
                    if isinstance(f, dict) and f.get("code"):
                        supported_codes.append(f["code"])
        except Exception:
            pass
        # For infrared_ac category we cannot fire via /commands — need /v2.0/infrareds/*
        hint = ""
        try:
            info = await cli.device_exists(device_id)
            cat = (info or {}).get("category", "")
            if cat == "infrared_ac":
                hint = " · Este dispositivo es un A/C controlado por control IR (categoría infrared_ac). La API /commands estándar suele NO funcionar con IR; requiere el endpoint /v2.0/infrareds/{ir_id}/air-conditioners/{remote_id}/command con códigos específicos (PowerOn/PowerOff/M/T/F)."
        except Exception:
            pass
        detail = "El dispositivo no aceptó el comando."
        if supported_codes:
            detail += f" · Códigos DP soportados: {', '.join(supported_codes[:12])}"
        detail += hint
        raise HTTPException(424, detail)

    return {"ok": True, "device_id": device_id, "commands": [c.dict() for c in payload.commands]}


@api.get("/tuya/devices/{device_id}/functions")
async def tuya_device_functions(device_id: str, _: dict = Depends(get_current_user)):
    """Devuelve los DP codes que el dispositivo específico soporta."""
    try:
        cli = await _tuya_client()
        return await cli.get_functions(device_id)
    except TuyaError as e:
        raise HTTPException(424, f"Tuya {e.code}: {e.msg}")


@api.patch("/tuya/devices/{device_id}")
async def tuya_rename_device(device_id: str, payload: TuyaRenameIn,
                             _: dict = Depends(require_roles("owner", "admin"))):
    if not payload.name.strip():
        raise HTTPException(400, "Nombre requerido")
    try:
        cli = await _tuya_client()
        await cli.rename_device(device_id, payload.name.strip())
        return {"ok": True, "device_id": device_id, "name": payload.name.strip()}
    except TuyaError as e:
        raise HTTPException(424, f"Tuya {e.code}: {e.msg}")


@api.delete("/tuya/devices/{device_id}")
async def tuya_delete_device(device_id: str,
                             _: dict = Depends(require_roles("owner", "admin"))):
    try:
        cli = await _tuya_client()
        await cli.delete_device(device_id)
        return {"ok": True, "device_id": device_id}
    except TuyaError as e:
        raise HTTPException(424, f"Tuya {e.code}: {e.msg}")


class TuyaAddByIdIn(BaseModel):
    device_id: str


class TuyaPairingTokenIn(BaseModel):
    uid: Optional[str] = None


@api.post("/tuya/devices/add")
async def tuya_add_by_id(payload: TuyaAddByIdIn,
                        _: dict = Depends(require_roles("owner", "admin"))):
    """Valida que un device_id exista en el project Tuya y devuelve su
    metadata. Si existe, aparecerá automáticamente en `list_devices` al hacer
    refresh; útil para verificar que la vinculación con Smart Life quedó bien.
    """
    did = (payload.device_id or "").strip()
    if not did:
        raise HTTPException(400, "device_id vacío")
    try:
        cli = await _tuya_client()
        info = await cli.device_exists(did)
    except TuyaError as e:
        # 1106 = permission denied (usualmente = device no pertenece al project)
        if e.code == 1106:
            raise HTTPException(404, f"El device_id '{did}' no está en tu Tuya Cloud Project. Verifica que el dispositivo esté vinculado a tu app Smart Life y que ese app account esté ligado al project.")
        raise HTTPException(424, f"Tuya {e.code}: {e.msg}")
    return {
        "ok": True,
        "device_id": did,
        "name": info.get("name") or info.get("custom_name") or did,
        "product_name": info.get("product_name") or "",
        "category": info.get("category") or "",
        "online": bool(info.get("online")),
        "raw": info,
    }


@api.post("/tuya/pairing-token")
async def tuya_pairing_token(payload: TuyaPairingTokenIn,
                             _: dict = Depends(require_roles("owner", "admin"))):
    """Genera un token de pairing (Cloud Access Token) — el usuario lo ingresa
    en Smart Life app para añadir el dispositivo directamente a este project.

    Flujo:
      1. Este endpoint llama Tuya y devuelve `{token, expire_time, region}`.
      2. En Smart Life app: Perfil → Escanear → introduce el token o QR.
      3. Al terminar el pairing, el dispositivo aparece en `/api/tuya/devices`.
    """
    try:
        cli = await _tuya_client()
        result = await cli.create_pairing_token(uid=payload.uid)
    except TuyaError as e:
        raise HTTPException(424, f"Tuya {e.code}: {e.msg}")
    return {
        "ok": True,
        "token": result.get("token") if isinstance(result, dict) else None,
        "expire_time": (result.get("expire_time") if isinstance(result, dict) else None),
        "region": (result.get("region") if isinstance(result, dict) else None),
        "raw": result,
    }


# ---- Grupos de dispositivos (zonas: Oficina, Casa, Taller...) ----
class TuyaGroupIn(BaseModel):
    name: str
    color: Optional[str] = "#38bdf8"
    device_ids: List[str] = []
    notes: Optional[str] = ""


class TuyaGroupUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    device_ids: Optional[List[str]] = None
    notes: Optional[str] = None


@api.get("/tuya/groups")
async def tuya_list_groups(_: dict = Depends(get_current_user)):
    items = await db.tuya_groups.find({}, {"_id": 0}).sort("name", 1).to_list(200)
    return items


@api.post("/tuya/groups")
async def tuya_create_group(payload: TuyaGroupIn,
                            _: dict = Depends(require_roles("owner", "admin"))):
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.tuya_groups.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/tuya/groups/{gid}")
async def tuya_update_group(gid: str, payload: TuyaGroupUpdate,
                            _: dict = Depends(require_roles("owner", "admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    r = await db.tuya_groups.update_one({"id": gid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Grupo no encontrado")
    return await db.tuya_groups.find_one({"id": gid}, {"_id": 0})


@api.delete("/tuya/groups/{gid}")
async def tuya_delete_group(gid: str,
                            _: dict = Depends(require_roles("owner", "admin"))):
    r = await db.tuya_groups.delete_one({"id": gid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Grupo no encontrado")
    return {"ok": True}


@api.post("/tuya/groups/{gid}/commands")
async def tuya_group_commands(gid: str, payload: TuyaCommandsIn,
                              _: dict = Depends(get_current_user)):
    """Envía los mismos comandos a todos los dispositivos del grupo en paralelo."""
    group = await db.tuya_groups.find_one({"id": gid}, {"_id": 0})
    if not group:
        raise HTTPException(404, "Grupo no encontrado")
    device_ids = group.get("device_ids") or []
    if not device_ids:
        raise HTTPException(400, "El grupo no tiene dispositivos vinculados")
    cli = await _tuya_client()
    cmds = [c.dict() for c in payload.commands]

    async def _send(did):
        try:
            await cli.send_commands(did, cmds)
            return {"device_id": did, "ok": True}
        except TuyaError as e:
            return {"device_id": did, "ok": False, "error": f"Tuya {e.code}: {e.msg}"}
        except Exception as e:
            return {"device_id": did, "ok": False, "error": f"{type(e).__name__}: {e}"}

    results = await asyncio.gather(*[_send(d) for d in device_ids])
    ok_count = sum(1 for r in results if r["ok"])
    return {
        "group_id": gid,
        "total": len(results),
        "ok": ok_count,
        "failed": len(results) - ok_count,
        "results": results,
    }


# ---- Escenarios: comandos agendados por hora + días ----
class TuyaSceneTarget(BaseModel):
    kind: Literal["all", "group", "devices"] = "all"
    group_id: Optional[str] = None
    device_ids: Optional[List[str]] = None


class TuyaSceneIn(BaseModel):
    name: str
    time: str  # "HH:MM"
    days: List[int] = [0, 1, 2, 3, 4, 5, 6]  # 0=domingo, 6=sábado
    enabled: bool = True
    target: TuyaSceneTarget = TuyaSceneTarget()
    commands: List[TuyaCommand]
    icon: Optional[str] = "sun"
    color: Optional[str] = "#f59e0b"


class TuyaSceneUpdate(BaseModel):
    name: Optional[str] = None
    time: Optional[str] = None
    days: Optional[List[int]] = None
    enabled: Optional[bool] = None
    target: Optional[TuyaSceneTarget] = None
    commands: Optional[List[TuyaCommand]] = None
    icon: Optional[str] = None
    color: Optional[str] = None


def _valid_hhmm(t: str) -> bool:
    try:
        h, m = t.split(":")
        return 0 <= int(h) <= 23 and 0 <= int(m) <= 59
    except Exception:
        return False


@api.get("/tuya/scenes")
async def tuya_list_scenes(_: dict = Depends(get_current_user)):
    items = await db.tuya_scenes.find({}, {"_id": 0}).sort("time", 1).to_list(200)
    return items


@api.post("/tuya/scenes")
async def tuya_create_scene(payload: TuyaSceneIn,
                            _: dict = Depends(require_roles("owner", "admin"))):
    if not _valid_hhmm(payload.time):
        raise HTTPException(400, "Hora inválida, usa formato HH:MM (24h)")
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["last_run_date"] = ""
    doc["last_run_at"] = None
    doc["last_run_status"] = ""
    await db.tuya_scenes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/tuya/scenes/{sid}")
async def tuya_update_scene(sid: str, payload: TuyaSceneUpdate,
                            _: dict = Depends(require_roles("owner", "admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if "time" in update and not _valid_hhmm(update["time"]):
        raise HTTPException(400, "Hora inválida, usa formato HH:MM (24h)")
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    r = await db.tuya_scenes.update_one({"id": sid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Escena no encontrada")
    return await db.tuya_scenes.find_one({"id": sid}, {"_id": 0})


@api.delete("/tuya/scenes/{sid}")
async def tuya_delete_scene(sid: str,
                            _: dict = Depends(require_roles("owner", "admin"))):
    r = await db.tuya_scenes.delete_one({"id": sid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Escena no encontrada")
    return {"ok": True}


async def _resolve_scene_targets(scene: dict) -> List[str]:
    """Return the device_ids that a scene affects."""
    target = scene.get("target") or {}
    kind = target.get("kind") or "all"
    if kind == "devices":
        return target.get("device_ids") or []
    if kind == "group":
        gid = target.get("group_id")
        if not gid: return []
        g = await db.tuya_groups.find_one({"id": gid}, {"_id": 0, "device_ids": 1})
        return (g or {}).get("device_ids") or []
    # kind == "all"
    try:
        cli = await _tuya_client()
        devs = await cli.list_devices()
        return [d.get("id") for d in devs if d.get("id")]
    except Exception:
        return []


async def _fire_scene(scene: dict) -> dict:
    """Execute a scene: fan-out commands to all target devices."""
    ids = await _resolve_scene_targets(scene)
    if not ids:
        return {"scene_id": scene["id"], "total": 0, "ok": 0, "failed": 0,
                "error": "sin dispositivos objetivo"}
    cli = await _tuya_client()
    cmds = scene.get("commands") or []

    async def _send(did):
        try:
            await cli.send_commands(did, cmds)
            return {"device_id": did, "ok": True}
        except TuyaError as e:
            logger.warning("[scene %s] device %s failed: %s", scene["id"], did, e)
            return {"device_id": did, "ok": False, "error": f"Tuya {e.code}: {e.msg}"}
        except Exception as e:
            logger.warning("[scene %s] device %s failed: %s", scene["id"], did, e)
            return {"device_id": did, "ok": False, "error": f"{type(e).__name__}: {e}"}

    results = await asyncio.gather(*[_send(d) for d in ids])
    ok_count = sum(1 for r in results if r["ok"])
    first_err = next((r.get("error") for r in results if not r["ok"]), None)
    return {
        "scene_id": scene["id"],
        "total": len(results),
        "ok": ok_count,
        "failed": len(results) - ok_count,
        "results": results,
        "error": first_err if ok_count == 0 and first_err else None,
    }


@api.post("/tuya/scenes/{sid}/run")
async def tuya_run_scene(sid: str, _: dict = Depends(get_current_user)):
    scene = await db.tuya_scenes.find_one({"id": sid}, {"_id": 0})
    if not scene:
        raise HTTPException(404, "Escena no encontrada")
    try:
        result = await _fire_scene(scene)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")
    await db.tuya_scenes.update_one({"id": sid}, {"$set": {
        "last_run_at": now_iso(),
        "last_run_status": "ok" if result["failed"] == 0 else "partial",
        "last_run_result": result,
    }})
    return result


@api.post("/cron/tuya-scenes")
async def cron_tuya_scenes(request: Request):
    """Evaluates all enabled scenes and fires any whose time has arrived today.

    Cadence: every 5 min (see /app/.emergent/crons.yml). Uses `last_run_date`
    (YYYY-MM-DD in America/Mexico_City) as an idempotency guard so a scene runs
    at most once per day even if the cron fires multiple times.
    """
    import hmac as _hmac
    from zoneinfo import ZoneInfo
    secret = os.environ.get("WEBHOOK_CRON_SECRET") or ""
    auth = request.headers.get("authorization") or ""
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not secret or not token or not _hmac.compare_digest(token, secret):
        raise HTTPException(401, "Unauthorized cron webhook")
    tz = ZoneInfo("America/Mexico_City")
    now = datetime.now(tz)
    today_str = now.strftime("%Y-%m-%d")
    now_hhmm = now.strftime("%H:%M")
    # 0=Mon..6=Sun in Python; we use 0=Sun..6=Sat in our schema → shift
    py_weekday = now.weekday()
    scene_day = (py_weekday + 1) % 7  # 0=Sun

    fired = []
    scenes = await db.tuya_scenes.find({"enabled": True}, {"_id": 0}).to_list(500)
    for s in scenes:
        if scene_day not in (s.get("days") or []):
            continue
        if s.get("last_run_date") == today_str:
            continue
        if not s.get("time") or s["time"] > now_hhmm:
            continue
        # Fire!
        try:
            result = await _fire_scene(s)
            status = "ok" if result["failed"] == 0 else "partial"
            await db.tuya_scenes.update_one({"id": s["id"]}, {"$set": {
                "last_run_date": today_str,
                "last_run_at": now_iso(),
                "last_run_status": status,
                "last_run_result": result,
            }})
            fired.append({"scene_id": s["id"], "name": s["name"], "status": status,
                          "ok": result["ok"], "total": result["total"]})
            logger.info("[cron tuya-scenes] fired '%s' → %d/%d ok",
                        s["name"], result["ok"], result["total"])
        except Exception as e:
            await db.tuya_scenes.update_one({"id": s["id"]}, {"$set": {
                "last_run_date": today_str,
                "last_run_at": now_iso(),
                "last_run_status": "error",
                "last_run_error": str(e)[:200],
            }})
            fired.append({"scene_id": s["id"], "name": s["name"], "status": "error",
                          "error": str(e)[:200]})
            logger.exception("[cron tuya-scenes] scene %s failed", s["name"])

    return {"ok": True, "now": now.isoformat(), "fired": fired,
            "evaluated": len(scenes)}


async def _seed_tuya_scenes():
    """One-time seed of the two example scenes requested by the user."""
    count = await db.tuya_scenes.count_documents({})
    if count > 0:
        return
    await db.tuya_scenes.insert_many([
        {
            "id": new_id(),
            "name": "Todos apagados a las 11pm",
            "time": "23:00",
            "days": [0, 1, 2, 3, 4, 5, 6],
            "enabled": True,
            "target": {"kind": "all", "group_id": None, "device_ids": None},
            "commands": [{"code": "switch", "value": False}],
            "icon": "moon", "color": "#6366f1",
            "created_at": now_iso(),
            "last_run_date": "",
        },
        {
            "id": new_id(),
            "name": "Enfriar oficina a las 8am",
            "time": "08:00",
            "days": [1, 2, 3, 4, 5],  # Lun..Vie
            "enabled": True,
            "target": {"kind": "group", "group_id": None, "device_ids": None},
            "commands": [
                {"code": "switch", "value": True},
                {"code": "mode", "value": "cold"},
                {"code": "temp_set", "value": 22},
            ],
            "icon": "sun", "color": "#f59e0b",
            "created_at": now_iso(),
            "last_run_date": "",
        },
    ])


@app.on_event("startup")
async def _startup_tuya_seed():
    await _seed_tuya_scenes()

# ---------- Smart Life · asistente conversacional (LLM function calling) ----------
from tuya_chat import run_turn as tuya_chat_run_turn, reset_chat as tuya_chat_reset  # noqa: E402


class TuyaChatIn(BaseModel):
    session_id: str
    message: str


@api.post("/tuya/chat")
async def tuya_chat_endpoint(payload: TuyaChatIn,
                             current: dict = Depends(get_current_user)):
    """Envía un mensaje al asistente Smart Life. Puede ejecutar herramientas Tuya."""
    if not payload.message.strip():
        raise HTTPException(400, "message vacío")
    session_key = f"{current['id']}:{payload.session_id}"

    # Persist user message
    now_str = now_iso()
    await db.tuya_chat_messages.insert_one({
        "id": new_id(),
        "session_id": session_key,
        "role": "user",
        "content": payload.message,
        "created_at": now_str,
    })

    try:
        result = await tuya_chat_run_turn(session_key, payload.message, db, new_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("tuya_chat failed")
        raise HTTPException(500, f"{type(e).__name__}: {e}")

    # Persist assistant response
    await db.tuya_chat_messages.insert_one({
        "id": new_id(),
        "session_id": session_key,
        "role": "assistant",
        "content": result["text"],
        "tool_calls": result["tool_calls"],
        "created_at": now_iso(),
    })
    return result


@api.get("/tuya/chat/history")
async def tuya_chat_history(session_id: str,
                            current: dict = Depends(get_current_user)):
    session_key = f"{current['id']}:{session_id}"
    items = await db.tuya_chat_messages.find(
        {"session_id": session_key}, {"_id": 0, "session_id": 0}
    ).sort("created_at", 1).to_list(200)
    return items


@api.post("/tuya/chat/reset")
async def tuya_chat_reset_endpoint(session_id: str,
                                   current: dict = Depends(get_current_user)):
    session_key = f"{current['id']}:{session_id}"
    tuya_chat_reset(session_key)
    await db.tuya_chat_messages.delete_many({"session_id": session_key})
    return {"ok": True}


# ---------- OLT · SNMP integration (VSol, Huawei, ZTE...) ----------
from olt import read_onus as olt_read_onus, snmp_test as olt_snmp_test, OLTError  # noqa: E402

# ---------- Mikrotik RouterOS API (routeros_api port 8728) ----------
from mikrotik_ros import (  # noqa: E402
    connect_and_test as ros_test_connect,
    set_overdue as ros_set_overdue,
    list_interfaces_and_addresses as ros_list_interfaces_and_addresses,
    set_queue as ros_set_queue,
    remove_queue as ros_remove_queue,
    pppoe_inventory as ros_pppoe_inventory,
    create_pppoe_server as ros_create_pppoe_server,
    ensure_ppp_profile as ros_ensure_ppp_profile,
    set_ppp_secret as ros_set_ppp_secret,
    remove_ppp_secret as ros_remove_ppp_secret,
    get_queue_rate as ros_get_queue_rate,
    get_pppoe_rate as ros_get_pppoe_rate,
    interface_traffic as ros_interface_traffic,
    MikrotikRosError,
)


# ---------- Corte por mora: address-list en el router ----------
async def _router_for_client(client: dict) -> Optional[dict]:
    """Router al que pertenece el cliente.

    `mikrotik_server` es texto libre escrito por el operador, así que primero
    se intenta casar con el nombre del equipo; si no hay coincidencia y solo
    existe un router registrado, se usa ese. Devolver None significa "no sé a
    qué router pertenece", y en ese caso no se toca nada.
    """
    routers = await db.devices.find({"kind": "mikrotik"}, {"_id": 0}).to_list(100)
    routers = [r for r in routers if r.get("host") and r.get("host") != "-" and r.get("api_user")]
    if not routers:
        return None
    wanted = (client.get("mikrotik_server") or "").strip().lower()
    if wanted:
        for r in routers:
            if wanted in (str(r.get("name", "")).lower(), str(r.get("id", "")).lower()):
                return r
    return routers[0] if len(routers) == 1 else None


def _queue_name_for(client: dict) -> str:
    """Nombre estable de la Simple Queue en el router. Incluye un trozo del id
    del cliente para que dos clientes con el mismo nombre no choquen; una vez
    generado se guarda en el cliente (`mikrotik_queue_name`) y no vuelve a
    cambiar aunque se le edite el nombre después."""
    base = _ovpn_slug(client.get("full_name", "") or "cliente")
    return f"isp-{base}-{(client.get('id') or '')[:6]}"[:32]


def _plan_rates(plan: dict) -> dict:
    """Sube/baja del plan (con `speed_mbps` como respaldo de planes viejos,
    antes de que existiera upload/download por separado) más, si aplica, los
    valores de ráfaga ya armados en el formato que pide cada modo:
      - Queue: burst-limit/burst-threshold/burst-time son propiedades separadas
        (mismo orden subida/bajada que max-limit).
      - PPPoE: todo va en una sola cadena de texto posicional
        (`rx` = subida del cliente, `tx` = bajada — así lo define RouterOS).
    El umbral de ráfaga se calcula como % de la velocidad normal; RouterOS
    exige que sea menor a la velocidad normal para que la ráfaga tenga efecto.
    """
    legacy = plan.get("speed_mbps")
    upload = int(plan.get("upload_mbps") or legacy or 0)
    download = int(plan.get("download_mbps") or legacy or upload)
    max_limit = f"{upload}M/{download}M"
    ppp_rate_limit = max_limit

    # Siempre se devuelven las 3 propiedades de ráfaga (con "0/0" = deshabilitada
    # en vez de omitirlas): burst-limit/threshold/time son propiedades sueltas en
    # Simple Queue, y si no se mandan en el `set`, RouterOS deja el valor viejo tal
    # cual — un plan que pasa de ráfaga a sin-ráfaga quedaría con la ráfaga vieja
    # pegada en el router.
    burst = {"burst_limit": "0/0", "burst_threshold": "0/0", "burst_time": "0/0"}
    if plan.get("burst_enabled") and plan.get("burst_upload_mbps") and plan.get("burst_download_mbps"):
        b_up = int(plan["burst_upload_mbps"])
        b_down = int(plan["burst_download_mbps"])
        pct = min(int(plan.get("burst_threshold_percent") or 80), 95)
        t_up = max(1, round(upload * pct / 100))
        t_down = max(1, round(download * pct / 100))
        secs = int(plan.get("burst_time_seconds") or 8)
        burst = {
            "burst_limit": f"{b_up}M/{b_down}M",
            "burst_threshold": f"{t_up}M/{t_down}M",
            "burst_time": f"{secs}/{secs}",
        }
        ppp_rate_limit = f"{max_limit} {b_up}M/{b_down}M {t_up}M/{t_down}M {secs}/{secs}"

    return {
        "upload": upload, "download": download, "max_limit": max_limit,
        "burst": burst, "ppp_rate_limit": ppp_rate_limit,
    }


async def _apply_client_queue(client: dict) -> dict:
    """Crea o actualiza la Simple Queue del cliente según su plan. Nunca
    lanza: un router caído no debe impedir crear/editar el cliente en el CRM."""
    if client.get("connection_mode", "queue") != "queue":
        return {"ok": False, "reason": "el cliente está en modo PPPoE, no usa Simple Queue por IP"}
    ip = (client.get("ip_address") or "").strip()
    if not ip:
        return {"ok": False, "reason": "el cliente no tiene IP asignada"}
    if not client.get("plan_id"):
        return {"ok": False, "reason": "el cliente no tiene plan asignado"}
    plan = await db.plans.find_one({"id": client["plan_id"]}, {"_id": 0})
    if not plan or not (plan.get("upload_mbps") or plan.get("download_mbps") or plan.get("speed_mbps")):
        return {"ok": False, "reason": "el plan del cliente no tiene velocidad definida"}
    router = await _router_for_client(client)
    if not router:
        return {"ok": False, "reason": "no se pudo determinar el router del cliente"}

    rates = _plan_rates(plan)
    name = client.get("mikrotik_queue_name") or _queue_name_for(client)
    try:
        res = await ros_set_queue(
            router["host"], port=int(router.get("api_port") or 8728),
            user=router.get("api_user", ""),
            password=device_secret(router, "api_password"),
            use_ssl=bool(router.get("api_use_ssl")),
            name=name, target=f"{ip}/32", max_limit=rates["max_limit"],
            comment=f"Sistema ISP - {client.get('full_name', '')}"[:60],
            **rates["burst"],
        )
        return {"ok": True, "router": router.get("name"), "queue_name": name,
                "max_limit": rates["max_limit"], **res}
    except MikrotikRosError as e:
        logger.warning("[queue] sync %s (%s) en %s: %s", ip, name, router.get("name"), e)
        return {"ok": False, "router": router.get("name"), "queue_name": name, "reason": str(e)[:200]}


async def _remove_client_queue(client: dict) -> dict:
    """Quita la Simple Queue del cliente (al eliminarlo o al quitarle la IP/router)."""
    name = client.get("mikrotik_queue_name")
    if not name:
        return {"ok": True, "removed": False}
    router = await _router_for_client(client)
    if not router:
        return {"ok": False, "reason": "no se pudo determinar el router del cliente"}
    try:
        res = await ros_remove_queue(
            router["host"], port=int(router.get("api_port") or 8728),
            user=router.get("api_user", ""),
            password=device_secret(router, "api_password"),
            use_ssl=bool(router.get("api_use_ssl")), name=name,
        )
        return {"ok": True, **res}
    except MikrotikRosError as e:
        logger.warning("[queue] remove %s: %s", name, e)
        return {"ok": False, "reason": str(e)[:200]}


async def _sync_client_queue_and_persist(client: dict) -> dict:
    """Corre `_apply_client_queue` y guarda el resultado en el cliente
    (nombre de cola, hora de sync, error si lo hubo) para que la UI lo muestre."""
    res = await _apply_client_queue(client)
    fields = {
        "mikrotik_queue_error": "" if res.get("ok") else (res.get("reason") or "")[:200],
        "updated_at": now_iso(),
    }
    if res.get("ok"):
        fields["mikrotik_queue_name"] = res.get("queue_name") or client.get("mikrotik_queue_name")
        fields["mikrotik_queue_synced_at"] = now_iso()
    await db.clients.update_one({"id": client["id"]}, {"$set": fields})
    return res


def _ppp_profile_name_for_plan(plan: dict) -> str:
    """Un perfil PPP por velocidad de plan, compartido por todos sus clientes
    — igual que en Queue, cambiar la velocidad del plan actualiza a todos los
    que lo usan de una sola vez."""
    rates = _plan_rates(plan)
    return f"isp-plan-{rates['upload']}x{rates['download']}m"


async def _apply_client_pppoe(client: dict) -> dict:
    """Crea/actualiza el secret PPPoE del cliente. Si no tiene usuario o
    contraseña todavía, los genera (únicos, sin caracteres raros — van a
    parar a la configuración PPPoE de un ONU). Nunca lanza: un router caído
    no debe impedir crear/editar el cliente en el CRM."""
    if client.get("connection_mode") != "pppoe":
        return {"ok": False, "reason": "el cliente no está en modo PPPoE"}
    if not client.get("plan_id"):
        return {"ok": False, "reason": "el cliente no tiene plan asignado"}
    plan = await db.plans.find_one({"id": client["plan_id"]}, {"_id": 0})
    if not plan or not (plan.get("upload_mbps") or plan.get("download_mbps") or plan.get("speed_mbps")):
        return {"ok": False, "reason": "el plan del cliente no tiene velocidad definida"}
    router = await _router_for_client(client)
    if not router:
        return {"ok": False, "reason": "no se pudo determinar el router del cliente"}

    username = (client.get("pppoe_user") or "").strip() or f"{_ovpn_slug(client.get('full_name',''))}-{client['id'][:6]}"
    secret_password = (client.get("pppoe_password") or "").strip() or _ovpn_random_secret()
    profile = (client.get("pppoe_profile") or "").strip() or _ppp_profile_name_for_plan(plan)
    remote_address = (client.get("ip_address") or "").strip()
    rate_limit = _plan_rates(plan)["ppp_rate_limit"]

    router_kwargs = dict(
        host=router["host"], port=int(router.get("api_port") or 8728),
        user=router.get("api_user", ""), password=device_secret(router, "api_password"),
        use_ssl=bool(router.get("api_use_ssl")),
    )

    try:
        # Si no eligieron un perfil existente del router, el CRM administra
        # uno propio por velocidad (no toca los perfiles del operador).
        if not (client.get("pppoe_profile") or "").strip():
            await ros_ensure_ppp_profile(**router_kwargs, name=profile, rate_limit=rate_limit)

        # Si le cambiaron el usuario, el secret viejo queda huérfano — se
        # quita antes de crear el nuevo (RouterOS identifica el secret por
        # nombre, no se puede "renombrar" en el mismo comando).
        old_name = client.get("mikrotik_pppoe_secret_name")
        if old_name and old_name != username:
            try:
                await ros_remove_ppp_secret(**router_kwargs, name=old_name)
            except MikrotikRosError:
                pass

        res = await ros_set_ppp_secret(
            **router_kwargs, name=username, secret_password=secret_password, profile=profile,
            remote_address=remote_address,
            comment=f"Sistema ISP - {client.get('full_name', '')}"[:60],
        )
        return {
            "ok": True, "router": router.get("name"), "username": username,
            "password": secret_password, "profile": profile, **res,
        }
    except MikrotikRosError as e:
        logger.warning("[pppoe] sync %s en %s: %s", username, router.get("name"), e)
        return {"ok": False, "router": router.get("name"), "username": username, "reason": str(e)[:200]}


async def _remove_client_pppoe(client: dict) -> dict:
    """Quita el secret PPPoE (y corta cualquier sesión activa) al eliminar el
    cliente o al sacarlo del modo PPPoE."""
    name = client.get("mikrotik_pppoe_secret_name")
    if not name:
        return {"ok": True, "removed": False}
    router = await _router_for_client(client)
    if not router:
        return {"ok": False, "reason": "no se pudo determinar el router del cliente"}
    try:
        res = await ros_remove_ppp_secret(
            router["host"], port=int(router.get("api_port") or 8728),
            user=router.get("api_user", ""),
            password=device_secret(router, "api_password"),
            use_ssl=bool(router.get("api_use_ssl")), name=name,
        )
        return {"ok": True, **res}
    except MikrotikRosError as e:
        logger.warning("[pppoe] remove %s: %s", name, e)
        return {"ok": False, "reason": str(e)[:200]}


async def _sync_client_pppoe_and_persist(client: dict) -> dict:
    """Corre `_apply_client_pppoe` y guarda el resultado (usuario/contraseña
    reales si se generaron, hora de sync, error si lo hubo)."""
    res = await _apply_client_pppoe(client)
    fields = {
        "mikrotik_pppoe_error": "" if res.get("ok") else (res.get("reason") or "")[:200],
        "updated_at": now_iso(),
    }
    if res.get("ok"):
        fields["pppoe_user"] = res.get("username") or client.get("pppoe_user")
        fields["pppoe_password"] = res.get("password") or client.get("pppoe_password")
        fields["mikrotik_pppoe_secret_name"] = res.get("username")
        fields["mikrotik_pppoe_synced_at"] = now_iso()
    await db.clients.update_one({"id": client["id"]}, {"$set": fields})
    return res


@api.get("/mikrotik/wan-traffic")
async def mikrotik_wan_traffic(_: dict = Depends(get_current_user)):
    """Consumo de internet en vivo de cada Mikrotik: mide sus interfaces WAN
    (las marcadas en Mikrotik → Interfaces) y devuelve la suma, para la gráfica
    del panel de control.

    Se mide en paralelo y con timeout corto: el panel refresca seguido y un
    router lento no debe dejar esperando a los demás. Un router que no
    responde se reporta con su motivo en vez de tumbar la respuesta.
    """
    devices = await db.devices.find({"kind": "mikrotik"}, {"_id": 0}).to_list(200)

    async def measure(d: dict) -> dict:
        base = {"id": d.get("id"), "name": d.get("name"),
                "wan_interfaces": d.get("wan_interfaces") or []}
        if not base["wan_interfaces"]:
            return {**base, "ok": False,
                    "reason": "sin interfaces WAN marcadas — márcalas en Mikrotik → Interfaces"}
        host, api_user = d.get("host") or "", d.get("api_user") or ""
        pwd = device_secret(d, "api_password")
        if not host or host == "-" or not api_user or not pwd:
            return {**base, "ok": False, "reason": "el router aún no está vinculado"}
        try:
            res = await ros_interface_traffic(
                host, port=int(d.get("api_port") or 8728), user=api_user, password=pwd,
                use_ssl=bool(d.get("api_use_ssl")), interfaces=base["wan_interfaces"],
                timeout=5,
            )
            return {**base, **res}
        except MikrotikRosError as e:
            return {**base, "ok": False, "reason": str(e)[:200]}

    results = await asyncio.gather(*(measure(d) for d in devices))
    return {"routers": list(results), "at": now_iso()}


# --------------------------------------------------------------------------
# "Aplicar Cambios": confirmar (o descartar) lo capturado
# --------------------------------------------------------------------------
async def _effects_on_confirm(collection: str, doc: dict, op: str) -> Optional[str]:
    """Lo que recién al confirmar sale del CRM hacia afuera. Devuelve un texto
    de error si algo no se pudo aplicar (el registro se confirma igual: el dato
    ya es del proyecto, lo que falló es el router, y eso se reintenta)."""
    if collection == "clients":
        if op == "delete":
            if doc.get("mikrotik_queue_name"):
                await _remove_client_queue(doc)
            if doc.get("mikrotik_pppoe_secret_name"):
                await _remove_client_pppoe(doc)
            return None
        mode = doc.get("connection_mode", "queue")
        if mode == "pppoe":
            if not (doc.get("mikrotik_server") and doc.get("plan_id")):
                return None
            res = await _sync_client_pppoe_and_persist(doc)
        else:
            if not (doc.get("ip_address") and doc.get("mikrotik_server") and doc.get("plan_id")):
                return None
            res = await _sync_client_queue_and_persist(doc)
        return None if res.get("ok") else (res.get("reason") or "no se pudo aplicar en el router")

    if collection == "payments" and op == "create":
        await _apply_payment_effects(doc)
        return None

    if collection == "lugares" and op == "update":
        # Renombrar un lugar arrastra a los clientes que lo tenían.
        prev_name = ((doc.get(PENDING) or {}).get("prev") or {}).get("name")
        if prev_name and prev_name != doc.get("name"):
            await db.clients.update_many({"community": prev_name},
                                         {"$set": {"community": doc.get("name")}})
        return None

    return None


def _pending_title(collection: str, doc: dict) -> str:
    field = STAGED_COLLECTIONS.get(collection, {}).get("title") or "name"
    return str(doc.get(field) or doc.get("full_name") or doc.get("name") or doc.get("id") or "—")


async def _collect_pending() -> List[dict]:
    out = []
    for coll, meta in STAGED_COLLECTIONS.items():
        docs = await db[coll].find({PENDING: {"$exists": True}}, {"_id": 0}).to_list(2000)
        for d in docs:
            p = d.get(PENDING) or {}
            out.append({
                "collection": coll,
                "module": meta["label"],
                "id": d.get("id"),
                "title": _pending_title(coll, d),
                "op": p.get("op"),
                "op_label": OP_LABEL.get(p.get("op"), p.get("op")),
                "by_name": p.get("by_name") or "",
                "at": p.get("at"),
                "changed_fields": sorted((p.get("prev") or {}).keys()) if p.get("op") == "update" else [],
            })
    out.sort(key=lambda x: x.get("at") or "")
    return out


@api.get("/pending-changes")
async def list_pending_changes(_: dict = Depends(get_current_user)):
    """Todo lo capturado que todavía no se ha confirmado."""
    items = await _collect_pending()
    by_module: Dict[str, int] = {}
    for it in items:
        by_module[it["module"]] = by_module.get(it["module"], 0) + 1
    return {"total": len(items), "by_module": by_module, "items": items}


@api.post("/pending-changes/apply")
async def apply_pending_changes(_: dict = Depends(require_roles("owner", "admin"))):
    """Confirma lo capturado: a partir de aquí los datos son del proyecto y se
    aplican hacia afuera (colas y secrets del Mikrotik, vencimientos, etc.).

    No se detiene si un registro falla: un router caído no debe dejar sin
    confirmar al resto — el dato queda guardado y el error se reporta.
    """
    applied, failed = [], []
    for coll in STAGED_COLLECTIONS:
        docs = await db[coll].find({PENDING: {"$exists": True}}, {"_id": 0}).to_list(2000)
        for d in docs:
            op = (d.get(PENDING) or {}).get("op")
            label = _pending_title(coll, d)
            try:
                err = await _effects_on_confirm(coll, d, op)
                if op == "delete":
                    await db[coll].delete_one({"id": d["id"]})
                else:
                    await db[coll].update_one({"id": d["id"]}, {"$unset": {PENDING: ""}})
                entry = {"module": STAGED_COLLECTIONS[coll]["label"], "title": label,
                         "op_label": OP_LABEL.get(op, op)}
                if err:
                    failed.append({**entry, "reason": err})
                else:
                    applied.append(entry)
            except Exception as e:  # noqa: BLE001 — un registro no tumba el lote
                logger.exception("[aplicar-cambios] %s/%s", coll, d.get("id"))
                failed.append({"module": STAGED_COLLECTIONS[coll]["label"], "title": label,
                               "op_label": OP_LABEL.get(op, op), "reason": f"{type(e).__name__}: {e}"[:200]})
    return {"ok": True, "applied": len(applied), "failed": len(failed),
            "details": {"applied": applied, "failed": failed}}


class DiscardPendingIn(BaseModel):
    collection: Optional[str] = None
    id: Optional[str] = None


@api.post("/pending-changes/discard")
async def discard_pending_changes(payload: DiscardPendingIn,
                                  _: dict = Depends(require_roles("owner", "admin"))):
    """Deshace lo capturado sin confirmar: las altas se borran, las ediciones
    vuelven a su valor anterior y las bajas se cancelan. Sin cuerpo descarta
    todo; con `collection` e `id`, solo ese registro."""
    discarded = 0
    for coll in STAGED_COLLECTIONS:
        if payload.collection and coll != payload.collection:
            continue
        q = {PENDING: {"$exists": True}}
        if payload.id:
            q["id"] = payload.id
        docs = await db[coll].find(q, {"_id": 0}).to_list(2000)
        for d in docs:
            p = d.get(PENDING) or {}
            op = p.get("op")
            if op == "create":
                await db[coll].delete_one({"id": d["id"]})
            elif op == "update":
                restore = p.get("prev") or {}
                await db[coll].update_one({"id": d["id"]},
                                          {"$set": restore, "$unset": {PENDING: ""}})
            else:  # delete pendiente: se cancela la baja
                await db[coll].update_one({"id": d["id"]}, {"$unset": {PENDING: ""}})
            discarded += 1
    return {"ok": True, "discarded": discarded}


async def _apply_overdue_block(client: dict, blocked: bool) -> dict:
    """Mete o saca al cliente de la address-list de morosos.

    Nunca lanza: un router caído no debe impedir que el CRM registre el pago
    ni la suspensión. Devuelve qué pasó para poder mostrarlo y reintentar.
    """
    ip = (client.get("ip_address") or "").strip()
    if not ip:
        return {"ok": False, "reason": "el cliente no tiene IP asignada"}
    router = await _router_for_client(client)
    if not router:
        return {"ok": False, "reason": "no se pudo determinar el router del cliente"}
    try:
        res = await ros_set_overdue(
            router["host"], port=int(router.get("api_port") or 8728),
            user=router.get("api_user", ""),
            password=device_secret(router, "api_password"),
            use_ssl=bool(router.get("api_use_ssl")),
            address=ip, blocked=blocked,
            comment=f"Sistema ISP - {client.get('full_name', '')}"[:60],
        )
        return {"ok": True, "router": router.get("name"), "ip": ip, **res}
    except MikrotikRosError as e:
        logger.warning("[mora] %s %s en %s: %s",
                       "bloquear" if blocked else "desbloquear",
                       ip, router.get("name"), e)
        return {"ok": False, "router": router.get("name"), "ip": ip, "reason": str(e)[:200]}

from mikrotik_dynamic import (  # noqa: E402
    get_config as mk_dyn_get,
    get_public_config as mk_dyn_public,
    upsert_config as mk_dyn_upsert,
    record_test_result as mk_dyn_record,
)


# ---------- Mikrotik dinámico (CGNAT / Proton VPN Port Forwarding) ----------
class MikrotikDynamicPatch(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = None
    user: Optional[str] = None
    password: Optional[str] = None
    use_ssl: Optional[bool] = None


class RouterIpWebhookIn(BaseModel):
    current_ip: str
    current_port: int


@api.get("/mikrotik/dynamic")
async def mikrotik_dynamic_get(_: dict = Depends(require_roles("owner", "admin"))):
    """Devuelve la config viva del router dinámico (Proton VPN Port Forwarding).

    El password nunca se expone en claro — solo un `password_masked` + flag
    `has_password`. Los valores viven en `db.mikrotik_dynamic` (singleton) y
    caen a las variables de entorno `MIKROTIK_*` si la DB está vacía.
    """
    return await mk_dyn_public(db)


@api.patch("/mikrotik/dynamic")
async def mikrotik_dynamic_patch(payload: MikrotikDynamicPatch,
                                 _: dict = Depends(require_roles("owner", "admin"))):
    """Actualización manual desde la UI. Solo modifica los campos enviados."""
    patch = {k: v for k, v in payload.dict().items() if v is not None}
    if not patch:
        raise HTTPException(400, "Nada que actualizar")
    await mk_dyn_upsert(db, patch, source="manual")
    return await mk_dyn_public(db)


@api.post("/mikrotik/dynamic/test")
async def mikrotik_dynamic_test(_: dict = Depends(require_roles("owner", "admin"))):
    """Corre `/system/resource/print` contra el router dinámico usando la
    config viva. Devuelve modelo (`board_name`) y uso de CPU (`cpu_load`)
    entre otros campos, y persiste el resultado del último test."""
    cfg = await mk_dyn_get(db)
    host = (cfg.get("host") or "").strip()
    user = (cfg.get("user") or "").strip()
    pwd = cfg.get("password") or ""
    port = int(cfg.get("port") or 8728)
    use_ssl = bool(cfg.get("use_ssl", False))
    if not host:
        raise HTTPException(400, "Falta MIKROTIK_HOST (IP pública/DNS de Proton VPN)")
    if not user or not pwd:
        raise HTTPException(400, "Falta usuario o contraseña de la API Mikrotik")
    try:
        result = await ros_test_connect(
            host, port=port, user=user, password=pwd,
            use_ssl=use_ssl, timeout=8,
        )
    except MikrotikRosError as e:
        await mk_dyn_record(db, ok=False, error=str(e))
        raise HTTPException(424, str(e))
    snap = {k: v for k, v in result.items() if k != "raw"}
    await mk_dyn_record(db, ok=True, snapshot=snap)
    return {
        "ok": True,
        "host": host,
        "port": port,
        "identity": result.get("identity"),
        "board_name": result.get("board_name"),
        "version": result.get("version"),
        "uptime": result.get("uptime"),
        "cpu_load": result.get("cpu_load"),
        "cpu_count": result.get("cpu_count"),
        "free_memory": result.get("free_memory"),
        "total_memory": result.get("total_memory"),
        "architecture": result.get("architecture"),
        "platform": result.get("platform"),
    }


@api.post("/update-router-ip")
async def update_router_ip_webhook(payload: RouterIpWebhookIn, request: Request):
    """Webhook público (protegido por `WEBHOOK_CRON_SECRET`) que recibe la
    IP + puerto actuales asignados por Proton VPN cada vez que el túnel se
    reinicia. Guarda los valores en la DB para que la conexión al router no
    se pierda al rotar el port forwarding.

    Autenticación (dos formas, elige una):
      - Header `X-Webhook-Secret: <WEBHOOK_CRON_SECRET>`
      - Header `Authorization: Bearer <WEBHOOK_CRON_SECRET>`

    Body JSON esperado: {"current_ip": "1.2.3.4", "current_port": "45678"}
    """
    import hmac
    secret = os.environ.get("WEBHOOK_CRON_SECRET") or ""
    provided = (request.headers.get("x-webhook-secret") or "").strip()
    if not provided:
        auth = request.headers.get("authorization") or ""
        provided = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not secret or not provided or not hmac.compare_digest(provided, secret):
        raise HTTPException(401, "Unauthorized webhook — falta X-Webhook-Secret válido")

    ip = (payload.current_ip or "").strip()
    port = int(payload.current_port)
    if not ip:
        raise HTTPException(400, "current_ip vacío")
    if not (1 <= port <= 65535):
        raise HTTPException(400, "current_port fuera de rango")

    updated = await mk_dyn_upsert(db, {"host": ip, "port": port}, source="webhook")
    return {
        "ok": True,
        "host": updated.get("host"),
        "port": int(updated.get("port") or 8728),
        "last_updated_at": updated.get("last_updated_at"),
        "source": updated.get("last_updated_source"),
    }



@api.post("/devices/{device_id}/ros-test")
async def mikrotik_ros_test(device_id: str,
                            _: dict = Depends(require_roles("owner", "admin"))):
    """Conecta al Mikrotik usando la librería `routeros_api` (puerto 8728) y
    corre `/system/resource/print` para verificar la conexión. Devuelve
    version, uptime, cpu-load, memoria y demás datos del router."""
    d = await db.devices.find_one({"id": device_id, "kind": "mikrotik"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Mikrotik no encontrado")
    host = d.get("host") or ""
    if not host or host == "-":
        raise HTTPException(400, "El router no tiene host/IP configurado")
    user = d.get("api_user") or ""
    pwd = device_secret(d, "api_password")
    if not user or not pwd:
        raise HTTPException(400, "Configura usuario y contraseña API en la edición del router")
    port = int(d.get("api_port") or 8728)
    use_ssl = bool(d.get("api_use_ssl", False))

    started = now_iso()
    try:
        result = await ros_test_connect(
            host, port=port, user=user, password=pwd,
            use_ssl=use_ssl, timeout=8,
        )
    except MikrotikRosError as e:
        await db.devices.update_one({"id": device_id}, {"$set": {
            "last_ros_test_at": started,
            "last_ros_test_ok": False,
            "last_ros_test_error": str(e)[:300],
            "vpn_status": "offline",
        }})
        raise HTTPException(424, str(e))

    # Persist a compact snapshot (drop `raw` for storage economy)
    snapshot = {k: v for k, v in result.items() if k != "raw"}
    await db.devices.update_one({"id": device_id}, {"$set": {
        "last_ros_test_at": started,
        "last_ros_test_ok": True,
        "last_ros_test_error": "",
        "ros_info": snapshot,
        "vpn_status": "online",
        "last_seen": started,
    }})
    return {"tested_at": started, **result}


@api.post("/devices/{olt_id}/snmp-test")
async def olt_snmp_test_endpoint(olt_id: str, _: dict = Depends(require_roles("owner", "admin"))):
    """Prueba rápida de conectividad SNMP (lee sysDescr + sysName + ifNumber)."""
    d = await db.devices.find_one({"id": olt_id, "kind": "olt"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "OLT no encontrada")
    if not d.get("host"):
        raise HTTPException(400, "La OLT no tiene host/IP configurado")
    community = d.get("snmp_community") or "public"
    port = int(d.get("snmp_port") or 161)
    version = d.get("snmp_version") or "2c"
    timeout = int(d.get("snmp_timeout") or 3)
    result = await olt_snmp_test(d["host"], community=community, port=port,
                                  version=version, timeout=timeout)
    # Persist last test
    await db.devices.update_one({"id": olt_id}, {"$set": {
        "last_snmp_test_at": now_iso(),
        "last_snmp_test": result,
    }})
    return result


@api.post("/devices/{olt_id}/onu-sync")
async def olt_onu_sync(olt_id: str, _: dict = Depends(require_roles("owner", "admin"))):
    """Sincroniza ONUs desde la OLT vía SNMP y guarda snapshot en `olt_onus`."""
    d = await db.devices.find_one({"id": olt_id, "kind": "olt"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "OLT no encontrada")
    if not d.get("snmp_enabled"):
        raise HTTPException(400, "SNMP no está habilitado en esta OLT. Edítala primero.")
    started = now_iso()
    try:
        result = await olt_read_onus(
            d["host"],
            vendor=d.get("olt_vendor") or "vsol_epon",
            community=d.get("snmp_community") or "public",
            port=int(d.get("snmp_port") or 161),
            version=d.get("snmp_version") or "2c",
            timeout=int(d.get("snmp_timeout") or 3),
            oids_override=d.get("snmp_oids_override"),
        )
    except OLTError as e:
        await db.devices.update_one({"id": olt_id}, {"$set": {
            "last_sync_at": started,
            "last_sync_status": "error",
            "last_sync_error": str(e)[:300],
        }})
        raise HTTPException(424, str(e))

    onus = result.get("onus") or []
    for onu in onus:
        row = {**onu, "device_id": olt_id, "synced_at": started}
        await db.olt_onus.update_one(
            {"device_id": olt_id, "index": onu["index"]},
            {"$set": row},
            upsert=True,
        )
    # Purge stale
    if onus:
        keep_idx = [o["index"] for o in onus]
        await db.olt_onus.delete_many({"device_id": olt_id, "index": {"$nin": keep_idx}})

    online_count = sum(1 for o in onus if o["status"] == "online")
    offline_count = sum(1 for o in onus if o["status"] == "offline")
    await db.devices.update_one({"id": olt_id}, {"$set": {
        "last_sync_at": started,
        "last_sync_status": "ok",
        "last_sync_error": "",
        "onus_count": len(onus),
        "onus_online": online_count,
        "onus_offline": offline_count,
        "sys_descr": result.get("sys_descr"),
    }})
    return {
        "device_id": olt_id,
        "synced_at": started,
        "sys_descr": result.get("sys_descr"),
        "onus_count": len(onus),
        "onus_online": online_count,
        "onus_offline": offline_count,
        "raw_counts": result.get("raw_counts"),
        "onus": onus,
    }


@api.get("/devices/{olt_id}/onus")
async def olt_get_onus(olt_id: str, _: dict = Depends(get_current_user)):
    d = await db.devices.find_one({"id": olt_id, "kind": "olt"}, {"_id": 0})
    if not d:
        raise HTTPException(404, "OLT no encontrada")
    items = await db.olt_onus.find(
        {"device_id": olt_id}, {"_id": 0}
    ).sort("index", 1).to_list(2000)
    return {
        "device_id": olt_id,
        "last_sync_at": d.get("last_sync_at"),
        "last_sync_status": d.get("last_sync_status"),
        "last_sync_error": d.get("last_sync_error"),
        "onus_count": d.get("onus_count", len(items)),
        "onus_online": d.get("onus_online", 0),
        "onus_offline": d.get("onus_offline", 0),
        "sys_descr": d.get("sys_descr"),
        "onus": items,
    }

# ---------- Inventario (Productos + Ventas retail) ----------
class InventoryProductIn(BaseModel):
    name: str
    price: float = Field(ge=0)
    stock: int = Field(ge=0, default=0)
    min_stock: int = Field(ge=0, default=5)
    sku: Optional[str] = ""
    notes: Optional[str] = ""


class InventoryProductUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    stock: Optional[int] = None
    min_stock: Optional[int] = None
    sku: Optional[str] = None
    notes: Optional[str] = None


class SaleItemIn(BaseModel):
    product_id: str
    quantity: int = Field(gt=0)


class SaleIn(BaseModel):
    client_id: Optional[str] = None
    client_name_override: Optional[str] = ""  # for walk-in / anonymous
    items: List[SaleItemIn]
    payment_method: Literal["cash", "transfer", "card", "other"] = "cash"
    notes: Optional[str] = ""


@api.get("/inventory/products")
async def inv_list_products(_: dict = Depends(get_current_user)):
    items = await db.inventory_products.find({}, {"_id": 0}).sort("name", 1).to_list(5000)
    return items


@api.post("/inventory/products")
async def inv_create_product(p: InventoryProductIn,
                             user: dict = Depends(require_roles("owner", "admin"))):
    doc = strip_pending(p.dict())
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    return await stage_create("inventory_products", doc, user)


@api.patch("/inventory/products/{pid}")
async def inv_update_product(pid: str, p: InventoryProductUpdate,
                             user: dict = Depends(require_roles("owner", "admin"))):
    update = strip_pending({k: v for k, v in p.dict().items() if v is not None})
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    res = await stage_update("inventory_products", pid, update, user)
    if res is None:
        raise HTTPException(404, "Producto no encontrado")
    return res


@api.delete("/inventory/products/{pid}")
async def inv_delete_product(pid: str,
                             user: dict = Depends(require_roles("owner", "admin"))):
    return await stage_delete("inventory_products", pid, user)


@api.get("/inventory/customers")
async def inv_list_customers(_: dict = Depends(get_current_user)):
    """Lightweight client list (id, name, phone, email) reused from `clients`
    collection so the Nueva Venta form pickers stay in sync."""
    items = await db.clients.find(
        {}, {"_id": 0, "id": 1, "full_name": 1, "phone": 1, "email": 1, "community": 1}
    ).sort("full_name", 1).to_list(5000)
    return items


@api.get("/inventory/sales")
async def inv_list_sales(client_id: Optional[str] = None,
                         limit: int = 500,
                         _: dict = Depends(get_current_user)):
    q: Dict[str, Any] = {}
    if client_id:
        q["client_id"] = client_id
    items = await db.inventory_sales.find(q, {"_id": 0}).sort("created_at", -1).to_list(int(limit))
    return items


@api.post("/inventory/sales")
async def inv_create_sale(s: SaleIn, user: dict = Depends(get_current_user)):
    if not s.items:
        raise HTTPException(400, "La venta debe tener al menos un producto")

    # 1) Resolve customer (optional)
    client_name = (s.client_name_override or "").strip()
    if s.client_id:
        c = await db.clients.find_one({"id": s.client_id}, {"_id": 0, "full_name": 1})
        if not c:
            raise HTTPException(404, f"Cliente {s.client_id} no encontrado")
        client_name = c.get("full_name") or client_name
    if not client_name:
        client_name = "Cliente ocasional"

    # 2) Validate all products + stock BEFORE mutating anything
    prod_ids = [it.product_id for it in s.items]
    products = await db.inventory_products.find(
        {"id": {"$in": prod_ids}}, {"_id": 0}
    ).to_list(len(prod_ids))
    by_id = {p["id"]: p for p in products}

    # aggregate requested qty per product (in case same product appears twice)
    requested: Dict[str, int] = {}
    for it in s.items:
        requested[it.product_id] = requested.get(it.product_id, 0) + int(it.quantity)

    for pid, qty in requested.items():
        if pid not in by_id:
            raise HTTPException(404, f"Producto {pid} no encontrado")
        if int(by_id[pid].get("stock") or 0) < qty:
            raise HTTPException(
                400,
                f"Stock insuficiente para '{by_id[pid]['name']}': disponible {by_id[pid].get('stock', 0)}, solicitado {qty}"
            )

    # 3) Build sale line items (snapshot price + name so history stays stable)
    line_items: List[Dict[str, Any]] = []
    total = 0.0
    for it in s.items:
        p = by_id[it.product_id]
        unit_price = float(p.get("price") or 0)
        subtotal = round(unit_price * int(it.quantity), 2)
        line_items.append({
            "product_id": it.product_id,
            "product_name": p["name"],
            "sku": p.get("sku") or "",
            "unit_price": unit_price,
            "quantity": int(it.quantity),
            "subtotal": subtotal,
        })
        total += subtotal
    total = round(total, 2)

    # 4) Decrement stock atomically per product (guard against races with $expr)
    started = now_iso()
    applied: List[Dict[str, Any]] = []  # for rollback
    try:
        for pid, qty in requested.items():
            r = await db.inventory_products.update_one(
                {"id": pid, "stock": {"$gte": qty}},
                {"$inc": {"stock": -qty}, "$set": {"updated_at": started}},
            )
            if r.modified_count != 1:
                raise HTTPException(
                    400, f"Stock cambió durante la venta para {by_id[pid]['name']}"
                )
            applied.append({"id": pid, "qty": qty})
    except HTTPException:
        # Rollback previously applied decrements
        for a in applied:
            await db.inventory_products.update_one(
                {"id": a["id"]}, {"$inc": {"stock": a["qty"]}}
            )
        raise

    # 5) Persist sale
    sale_doc = {
        "id": new_id(),
        "client_id": s.client_id,
        "client_name": client_name,
        "items": line_items,
        "total": total,
        "payment_method": s.payment_method,
        "notes": s.notes or "",
        "created_at": started,
        "created_by_id": user.get("id"),
        "created_by_name": user.get("name") or user.get("email") or "",
    }
    await db.inventory_sales.insert_one(sale_doc)
    sale_doc.pop("_id", None)
    return sale_doc


@api.get("/inventory/stats")
async def inv_stats(_: dict = Depends(get_current_user)):
    prods = await db.inventory_products.find({}, {"_id": 0, "stock": 1, "price": 1, "min_stock": 1}).to_list(5000)
    total_products = len(prods)
    total_units = sum(int(p.get("stock") or 0) for p in prods)
    total_value = round(sum(float(p.get("price") or 0) * int(p.get("stock") or 0) for p in prods), 2)
    low_stock = sum(
        1 for p in prods
        if int(p.get("stock") or 0) <= int(p.get("min_stock") or 5)
    )
    # sales totals
    total_sales_agg = await db.inventory_sales.aggregate([
        {"$group": {"_id": None, "count": {"$sum": 1}, "revenue": {"$sum": "$total"}}}
    ]).to_list(1)
    total_sales = int(total_sales_agg[0]["count"]) if total_sales_agg else 0
    total_revenue = round(float(total_sales_agg[0]["revenue"]) if total_sales_agg else 0.0, 2)
    return {
        "total_products": total_products,
        "total_units": total_units,
        "total_value": total_value,
        "low_stock": low_stock,
        "total_sales": total_sales,
        "total_revenue": total_revenue,
    }


# ---------- Map cables (fiber runs traced on the service map) ----------
class CableIn(BaseModel):
    tipo: Literal["troncal", "distribucion", "drop"]
    path: List[Dict[str, float]]  # [{lat, lng}, ...]
    length_m: float = 0
    fibers_count: Optional[int] = 12  # 1, 6, 8, 12 or 24 fiber strands (TIA-598)
    name: Optional[str] = ""          # user-provided display name
    notes: Optional[str] = ""
    color: Optional[str] = None
    weight: Optional[int] = None
    from_node_id: Optional[str] = None  # optional splice/nap/olt at the start
    to_node_id: Optional[str] = None    # optional splice/nap/olt at the end


class CableUpdate(BaseModel):
    tipo: Optional[Literal["troncal", "distribucion", "drop"]] = None
    path: Optional[List[Dict[str, float]]] = None
    length_m: Optional[float] = None
    fibers_count: Optional[int] = None
    name: Optional[str] = None
    notes: Optional[str] = None
    color: Optional[str] = None
    weight: Optional[int] = None
    from_node_id: Optional[str] = None
    to_node_id: Optional[str] = None


# ---------- Map generic nodes (splice boxes, poles, reserves, etc.) ----------
class MapNodeIn(BaseModel):
    type: Literal["splice", "pole", "reserve", "olt_map", "odf", "datacenter", "problem"]
    name: str
    lat: float
    lng: float
    color: Optional[str] = None
    notes: Optional[str] = ""
    # Type-specific fields (loose bag)
    data: Optional[Dict[str, Any]] = None


class MapNodeUpdate(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    color: Optional[str] = None
    notes: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


@api.get("/map/nodes")
async def list_map_nodes(_: dict = Depends(get_current_user)):
    items = await db.map_nodes.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return items


@api.post("/map/nodes")
async def create_map_node(payload: MapNodeIn, _: dict = Depends(require_roles("owner", "admin"))):
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.map_nodes.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/map/nodes/{nid}")
async def update_map_node(nid: str, payload: MapNodeUpdate, _: dict = Depends(require_roles("owner", "admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    r = await db.map_nodes.update_one({"id": nid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Nodo no encontrado")
    return await db.map_nodes.find_one({"id": nid}, {"_id": 0})


@api.delete("/map/nodes/{nid}")
async def delete_map_node(nid: str, _: dict = Depends(require_roles("owner", "admin"))):
    r = await db.map_nodes.delete_one({"id": nid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Nodo no encontrado")
    return {"ok": True}


@api.get("/map/cables")
async def list_cables(_: dict = Depends(get_current_user)):
    items = await db.map_cables.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return items


@api.post("/map/cables")
async def create_cable(payload: CableIn, _: dict = Depends(require_roles("owner", "admin"))):
    doc = payload.dict()
    if not doc["path"] or len(doc["path"]) < 2:
        raise HTTPException(400, "El cable debe tener al menos 2 puntos")
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.map_cables.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.patch("/map/cables/{cid}")
async def update_cable(cid: str, payload: CableUpdate, _: dict = Depends(require_roles("owner", "admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    r = await db.map_cables.update_one({"id": cid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Cable no encontrado")
    return await db.map_cables.find_one({"id": cid}, {"_id": 0})


@api.delete("/map/cables/{cid}")
async def delete_cable(cid: str, _: dict = Depends(require_roles("owner", "admin"))):
    r = await db.map_cables.delete_one({"id": cid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Cable no encontrado")
    return {"ok": True}


# ---------- Virtual splice links (fiber-level connections) ----------
class SpliceEndpoint(BaseModel):
    """One terminal of a virtual splice: an ODF/NAP port (node id + port
    position) or a specific fiber inside a cable (cable id + fiber position,
    1-based)."""
    kind: Literal["odf_port", "nap_port", "cable_fiber"]
    ref_id: str
    position: int
    label: Optional[str] = None


class SpliceLinkIn(BaseModel):
    endpoint_a: SpliceEndpoint
    endpoint_b: SpliceEndpoint
    notes: Optional[str] = ""
    color: Optional[str] = "#22c55e"


@api.get("/map/splice-links")
async def list_splice_links(_: dict = Depends(get_current_user)):
    items = await db.splice_links.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return items


@api.post("/map/splice-links")
async def create_splice_link(payload: SpliceLinkIn,
                             _: dict = Depends(require_roles("owner", "admin"))):
    doc = payload.dict()
    for ep_key in ("endpoint_a", "endpoint_b"):
        ep = doc[ep_key]
        if ep["kind"] in ("odf_port", "nap_port"):
            node = await db.map_nodes.find_one({"id": ep["ref_id"]}, {"_id": 0})
            if not node:
                raise HTTPException(400, f"{ep_key}: nodo {ep['ref_id']} no existe")
            cap = int((node.get("data") or {}).get("capacity") or 0) or 12
            if ep["position"] < 1 or ep["position"] > cap:
                raise HTTPException(400, f"{ep_key}: puerto #{ep['position']} fuera de rango (1-{cap})")
        elif ep["kind"] == "cable_fiber":
            cable = await db.map_cables.find_one({"id": ep["ref_id"]}, {"_id": 0})
            if not cable:
                raise HTTPException(400, f"{ep_key}: cable {ep['ref_id']} no existe")
            fc = int(cable.get("fibers_count") or 12)
            if ep["position"] < 1 or ep["position"] > fc:
                raise HTTPException(400, f"{ep_key}: hilo #{ep['position']} excede los {fc} hilos del cable")
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.splice_links.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.delete("/map/splice-links/{sid}")
async def delete_splice_link(sid: str,
                             _: dict = Depends(require_roles("owner", "admin"))):
    r = await db.splice_links.delete_one({"id": sid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Enlace no encontrado")
    return {"ok": True}


# ---------- Map config (Google Maps API key configurable desde UI) ----------
class MapConfigIn(BaseModel):
    api_key: Optional[str] = None
    center_lat: Optional[float] = None
    center_lng: Optional[float] = None
    zoom: Optional[int] = None


def _mask_key(k: Optional[str]) -> str:
    if not k:
        return ""
    if len(k) <= 8:
        return "•" * len(k)
    return k[:4] + "•" * (len(k) - 8) + k[-4:]


@api.get("/map/config")
async def get_map_config(_: dict = Depends(get_current_user)):
    """Returns the current map config. `api_key` is exposed in full because the
    frontend must load the Google Maps JS script with it (public-by-design;
    referrer restrictions in Google Cloud Console are the actual protection)."""
    doc = await db.map_config.find_one({"_singleton": "map_config"}, {"_id": 0}) or {}
    return {
        "api_key": doc.get("api_key") or "",
        "api_key_masked": _mask_key(doc.get("api_key")),
        "has_key": bool(doc.get("api_key")),
        "center_lat": doc.get("center_lat"),
        "center_lng": doc.get("center_lng"),
        "zoom": doc.get("zoom"),
        "last_tested_ok": doc.get("last_tested_ok"),
        "last_tested_at": doc.get("last_tested_at"),
        "last_tested_error": doc.get("last_tested_error"),
    }


@api.patch("/map/config")
async def patch_map_config(payload: MapConfigIn,
                           _: dict = Depends(require_roles("owner", "admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    if "api_key" in update:
        update["api_key"] = update["api_key"].strip()
    update["updated_at"] = now_iso()
    await db.map_config.update_one(
        {"_singleton": "map_config"},
        {"$set": update, "$setOnInsert": {"_singleton": "map_config"}},
        upsert=True,
    )
    return await get_map_config()


@api.post("/map/config/test")
async def test_map_config(payload: MapConfigIn,
                          _: dict = Depends(require_roles("owner", "admin"))):
    """Validates a Google Maps API key against Google's servers by hitting the
    Geocoding API. Returns success/failure with a helpful message. Note: this
    only proves the key is valid — the Maps JavaScript API must still be
    enabled separately (surfaced via `gm_authFailure` in the browser)."""
    key = (payload.api_key or "").strip()
    if not key:
        # If nothing supplied, use the stored key
        stored = await db.map_config.find_one({"_singleton": "map_config"}, {"_id": 0}) or {}
        key = stored.get("api_key") or ""
    if not key:
        raise HTTPException(400, "Ingresa una API key para probar")

    import httpx
    result = {"ok": False, "message": "", "status": None, "hint": ""}
    try:
        async with httpx.AsyncClient(timeout=10.0) as hc:
            r = await hc.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                params={"address": "Ciudad de México", "key": key},
            )
            data = r.json() if r.content else {}
    except Exception as e:
        raise HTTPException(502, f"No se pudo contactar a Google: {e}")

    status_code = data.get("status") or "UNKNOWN"
    result["status"] = status_code
    err_msg = data.get("error_message") or ""

    if status_code == "OK":
        result["ok"] = True
        result["message"] = "API key válida · Google respondió correctamente."
        result["hint"] = "Recuerda habilitar 'Maps JavaScript API' + billing en tu proyecto."
    elif status_code == "REQUEST_DENIED":
        # Special case: the key IS valid but restricted to HTTP referrers,
        # which is the RECOMMENDED production configuration. From a browser
        # this key will work; only server-side (no Referer header) calls fail.
        if "referer restrictions cannot be used" in err_msg.lower() \
                or ("referer" in err_msg.lower() and "restriction" in err_msg.lower()):
            result["ok"] = True
            result["message"] = "API key válida con restricciones de referrer (recomendado)."
            result["hint"] = ("La key sólo funciona desde el navegador. Asegúrate de que "
                              "tu dominio (customer-net-ops.preview.emergentagent.com y "
                              "jupiterisp.net) esté en la lista de referrers permitidos.")
        else:
            result["ok"] = False
            result["message"] = f"Google rechazó la key: {err_msg or 'REQUEST_DENIED'}"
            if "not authorized" in err_msg.lower() or "not been used" in err_msg.lower():
                result["hint"] = "Habilita la API en Google Cloud Console → APIs & Services → Library."
            elif "billing" in err_msg.lower():
                result["hint"] = "El proyecto no tiene billing habilitado."
            else:
                result["hint"] = "Revisa restricciones de la key en Google Cloud Console."
    elif status_code == "OVER_QUERY_LIMIT":
        result["message"] = "Cuota diaria excedida en el proyecto."
    elif status_code == "INVALID_REQUEST":
        result["message"] = "Solicitud inválida — probablemente el formato de la key esté mal."
    else:
        result["message"] = f"Estado inesperado: {status_code}. {err_msg}"

    # Persist last test outcome
    await db.map_config.update_one(
        {"_singleton": "map_config"},
        {"$set": {
            "last_tested_at": now_iso(),
            "last_tested_ok": bool(result["ok"]),
            "last_tested_error": result["message"] if not result["ok"] else "",
        }, "$setOnInsert": {"_singleton": "map_config"}},
        upsert=True,
    )
    return result


# ---------- Mount ----------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
