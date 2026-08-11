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
from typing import Optional, List, Any, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, status, UploadFile, File
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
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
    token = request.cookies.get("portal_token")
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

async def generate_portal_pin(max_attempts: int = 20) -> str:
    """Generate a 6-digit PIN that is guaranteed unique across all existing
    client portal PINs (verified against bcrypt hashes). Ensures no two
    clients ever share the same portal login PIN."""
    import secrets
    for _ in range(max_attempts):
        pin = f"{secrets.randbelow(1_000_000):06d}"
        # Verify uniqueness — scan existing hashes and reject if any matches
        collision = False
        async for doc in db.clients.find({"portal_pin_hash": {"$exists": True}}, {"portal_pin_hash": 1, "_id": 0}):
            h = doc.get("portal_pin_hash")
            if h and verify_password(pin, h):
                collision = True
                break
        if not collision:
            return pin
    # Fallback (extremely unlikely): raise so admin knows to expand namespace
    raise HTTPException(500, "No se pudo generar un PIN único; contacta soporte.")

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
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
    return user

def require_roles(*roles):
    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(403, "Permiso denegado")
        return user
    return _dep

# ---------- Models ----------
Role = Literal["owner", "admin", "technician", "secretary"]

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserCreate(BaseModel):
    email: EmailStr
    name: str
    role: Role = "technician"
    password: str
    phone: Optional[str] = None

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

class PlanIn(BaseModel):
    name: str
    speed_mbps: int
    price: float
    description: Optional[str] = ""
    active: bool = True

class NapBoxIn(BaseModel):
    name: str
    lat: float
    lng: float
    port_type: Literal["1x8","1x16"] = "1x16"
    capacity: int = 16
    address: Optional[str] = ""
    notes: Optional[str] = ""

    @model_validator(mode="after")
    def _derive_capacity(self):
        # capacity is always derived from port_type so the DB stays consistent
        self.capacity = 8 if self.port_type == "1x8" else 16
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
    vpn_protocol: Optional[Literal["wireguard","l2tp"]] = None
    vpn_user: Optional[str] = ""
    vpn_password: Optional[str] = ""
    vpn_public_key: Optional[str] = ""  # router pubkey when WG
    api_enabled: Optional[bool] = False
    api_user: Optional[str] = ""
    api_password: Optional[str] = ""
    management_modes: Optional[List[Literal["ppp","queues"]]] = []
    interfaces: Optional[List[str]] = None  # e.g., ["ether1","bridge","pppoe-out1"]

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
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none",
                        max_age=int(ACCESS_TTL.total_seconds()), path="/")
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"]}
    }

@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
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
    doc = {
        "id": new_id(), "email": email, "name": u.name, "role": u.role,
        "phone": u.phone or "", "password_hash": hash_password(u.password),
        "active": True, "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    doc.pop("password_hash", None); doc.pop("_id", None)
    return doc

@api.patch("/users/{uid}")
async def update_user(uid: str, u: UserUpdate, _: dict = Depends(require_roles("owner","admin"))):
    updates = {k: v for k, v in u.dict(exclude_none=True).items()}
    if "password" in updates:
        updates["password_hash"] = hash_password(updates.pop("password"))
    if updates:
        await db.users.update_one({"id": uid}, {"$set": updates})
    doc = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    return doc

@api.delete("/users/{uid}")
async def delete_user(uid: str, current: dict = Depends(require_roles("owner","admin"))):
    if uid == current["id"]:
        raise HTTPException(400, "No puedes eliminar tu propia cuenta")
    await db.users.delete_one({"id": uid})
    return {"ok": True}

# ---------- Generic collection helpers ----------
def crud_router(prefix: str, model_in, collection: str, extra_defaults=None):
    r = APIRouter(prefix=prefix)

    @r.get("")
    async def _list(_: dict = Depends(get_current_user)):
        items = await db[collection].find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return items

    @r.post("")
    async def _create(payload: model_in, _: dict = Depends(get_current_user)):
        doc = payload.dict()
        doc["id"] = new_id()
        doc["created_at"] = now_iso()
        doc["updated_at"] = now_iso()
        if extra_defaults:
            for k, v in extra_defaults.items():
                doc.setdefault(k, v)
        await db[collection].insert_one(doc)
        doc.pop("_id", None)
        return doc

    @r.patch("/{item_id}")
    async def _update(item_id: str, payload: dict, _: dict = Depends(get_current_user)):
        payload = {k: v for k, v in payload.items() if v is not None}
        payload["updated_at"] = now_iso()
        await db[collection].update_one({"id": item_id}, {"$set": payload})
        return await db[collection].find_one({"id": item_id}, {"_id": 0})

    @r.delete("/{item_id}")
    async def _delete(item_id: str, _: dict = Depends(get_current_user)):
        await db[collection].delete_one({"id": item_id})
        return {"ok": True}

    return r

# ---------- Plans, NAP, Extras, Leads, Tasks, Devices ----------
api.include_router(crud_router("/plans", PlanIn, "plans"))
api.include_router(crud_router("/nap-boxes", NapBoxIn, "nap_boxes"))
api.include_router(crud_router("/extras", ExtraServiceIn, "extras"))
api.include_router(crud_router("/leads", LeadIn, "leads"))
api.include_router(crud_router("/tasks", TaskIn, "tasks"))
api.include_router(crud_router("/devices", DeviceIn, "devices"))
api.include_router(crud_router("/vpn", VpnConnectionIn, "vpn_connections"))

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
            f"PublicKey = {v.get('preshared_key') or '<PUBLIC_KEY_DEL_MIKROTIK>'}\n"
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
        add("Credenciales L2TP", bool(d.get("vpn_user") and d.get("vpn_password")),
            "usuario/contraseña completos" if d.get("vpn_user") and d.get("vpn_password") else "faltan credenciales",
            fix="Reconfigura y presiona 'Autogenerar' en Usuario VPN." if not (d.get("vpn_user") and d.get("vpn_password")) else "")
    else:
        add("Public Key del servidor", bool(cfg.get("server_public_key")),
            "configurada" if cfg.get("server_public_key") else "sin configurar",
            fix="En Datos del servidor, edita 'Public Key del servidor'." if not cfg.get("server_public_key") else "")
    add("IP pública del CRM", bool(cfg.get("public_ip")), cfg.get("public_ip") or "sin definir",
        fix="Edita 'Datos del servidor' y completá la IP pública." if not cfg.get("public_ip") else "")
    if d.get("api_enabled"):
        add("Usuario API", bool(d.get("api_user") and d.get("api_password")),
            (d.get("api_user") or "") + (" · pass ok" if d.get("api_password") else " · pass vacío"),
            fix="Reconfigura y presiona 'Generar credenciales API'." if not (d.get("api_user") and d.get("api_password")) else "")
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
async def list_clients(_: dict = Depends(get_current_user)):
    items = await db.clients.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return items

@api.get("/clients/{cid}")
async def get_client(cid: str, _: dict = Depends(get_current_user)):
    c = await db.clients.find_one({"id": cid}, {"_id": 0})
    if not c: raise HTTPException(404, "Cliente no encontrado")
    return c

@api.post("/clients")
async def create_client(payload: ClientIn, _: dict = Depends(get_current_user)):
    if payload.nap_box_id:
        await _check_nap_capacity(payload.nap_box_id)
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    doc["next_due_date"] = _next_due_date(doc["payment_day"])
    doc["last_seen"] = None
    doc["onu_power_dbm"] = None
    # Autogenerate PIN for the client portal (6-digit). Store hashed; also
    # return the plaintext once so admin can share it with the client.
    pin_plain = await generate_portal_pin()
    doc["portal_pin_hash"] = hash_password(pin_plain)
    await db.clients.insert_one(doc)
    doc.pop("_id", None)
    doc.pop("portal_pin_hash", None)
    doc["portal_pin"] = pin_plain
    return doc

@api.post("/clients/{cid}/regenerate-pin")
async def regenerate_portal_pin(cid: str, _: dict = Depends(require_roles("owner","admin"))):
    client = await db.clients.find_one({"id": cid}, {"_id": 0, "id": 1, "phone": 1})
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    pin = await generate_portal_pin()
    await db.clients.update_one({"id": cid}, {"$set": {
        "portal_pin_hash": hash_password(pin), "updated_at": now_iso(),
    }})
    return {"portal_pin": pin, "phone": client.get("phone", "")}

@api.patch("/clients/{cid}")
async def update_client(cid: str, payload: ClientUpdate, _: dict = Depends(get_current_user)):
    updates = payload.dict(exclude_none=True)
    if updates.get("nap_box_id"):
        await _check_nap_capacity(updates["nap_box_id"], exclude_client_id=cid)
    if "payment_day" in updates:
        updates["next_due_date"] = _next_due_date(updates["payment_day"])
    updates["updated_at"] = now_iso()
    await db.clients.update_one({"id": cid}, {"$set": updates})
    return await db.clients.find_one({"id": cid}, {"_id": 0})

@api.delete("/clients/{cid}")
async def delete_client(cid: str, _: dict = Depends(require_roles("owner","admin"))):
    await db.clients.delete_one({"id": cid})
    return {"ok": True}

# ---------- Payments ----------
@api.get("/payments")
async def list_payments(client_id: Optional[str] = None, _: dict = Depends(get_current_user)):
    q = {"client_id": client_id} if client_id else {}
    items = await db.payments.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return items

@api.post("/payments")
async def create_payment(payload: PaymentIn, user: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": payload.client_id})
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    doc["created_by"] = user.get("id")
    doc["created_by_name"] = user.get("name")
    await db.payments.insert_one(doc)
    if not payload.is_promise:
        current_due = client.get("next_due_date") or now_iso()
        new_due = _next_due_date(client.get("payment_day", 1), current_due)
        await db.clients.update_one(
            {"id": client["id"]},
            {"$set": {"next_due_date": new_due, "status": "active", "updated_at": now_iso()}}
        )
    doc.pop("_id", None)
    return doc

@api.post("/payments/bulk-delete")
async def bulk_delete_payments(payload: BulkDeleteIn, _: dict = Depends(require_roles("owner","admin"))):
    if not payload.ids:
        return {"deleted": 0}
    res = await db.payments.delete_many({"id": {"$in": payload.ids}})
    return {"deleted": res.deleted_count}

@api.patch("/payments/{pid}")
async def update_payment(pid: str, payload: dict, _: dict = Depends(require_roles("owner","admin"))):
    existing = await db.payments.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Pago no encontrado")
    # Only allow editing these fields; do NOT re-apply the next_due_date side
    # effect from create — edits should not shift the client's billing cycle.
    ALLOWED = {"amount", "method", "concept", "invoice_number", "is_promise",
               "promise_date", "extension_days", "notes"}
    changes = {k: v for k, v in (payload or {}).items() if k in ALLOWED}
    if not changes:
        return existing
    changes["updated_at"] = now_iso()
    await db.payments.update_one({"id": pid}, {"$set": changes})
    updated = await db.payments.find_one({"id": pid}, {"_id": 0})
    return updated

@api.delete("/payments/{pid}")
async def delete_payment(pid: str, _: dict = Depends(require_roles("owner","admin"))):
    await db.payments.delete_one({"id": pid})
    return {"ok": True}

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
    devices = await db.devices.find({}, {"_id": 0}).to_list(500)
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

    client = None
    # Fast path — if phone was provided (legacy clients), narrow the search.
    if payload.phone:
        phone = payload.phone.strip()
        candidate = await db.clients.find_one({"phone": phone})
        if candidate and candidate.get("portal_pin_hash") \
                and verify_password(payload.pin, candidate["portal_pin_hash"]):
            client = candidate

    # Otherwise (or if phone lookup failed) scan clients since PINs are unique.
    if not client:
        async for doc in db.clients.find({"portal_pin_hash": {"$exists": True}}):
            if verify_password(payload.pin, doc.get("portal_pin_hash", "")):
                client = doc
                break

    if not client:
        raise HTTPException(401, "PIN inválido")

    token = create_portal_token(client["id"], client.get("phone", ""))
    response.set_cookie(
        "portal_token", token,
        max_age=30 * 24 * 3600, httponly=True, secure=True, samesite="lax", path="/",
    )
    return {"token": token, "client": _sanitize_client_portal({k: v for k, v in client.items() if k != "portal_pin_hash"})}

@api.post("/portal/logout")
async def portal_logout(response: Response):
    response.delete_cookie("portal_token", path="/")
    return {"ok": True}

@api.get("/portal/me")
async def portal_me(client: dict = Depends(get_portal_client)):
    plan = None
    if client.get("plan_id"):
        plan = await db.plans.find_one({"id": client["plan_id"]}, {"_id": 0, "name": 1, "speed_mbps": 1, "price": 1})
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
async def create_lugar(payload: LugarIn, _: dict = Depends(require_roles("owner","admin"))):
    existing = await db.lugares.find_one({"name": payload.name}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(400, f"Ya existe un lugar con el nombre '{payload.name}'")
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.lugares.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.patch("/lugares/{lid}")
async def update_lugar(lid: str, payload: LugarUpdate,
                       _: dict = Depends(require_roles("owner","admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    old = await db.lugares.find_one({"id": lid}, {"_id": 0, "name": 1})
    if not old:
        raise HTTPException(404, "Lugar no encontrado")
    await db.lugares.update_one({"id": lid}, {"$set": update})
    # Rename cascades to clients that referenced this place by name
    if "name" in update and update["name"] != old["name"]:
        await db.clients.update_many({"community": old["name"]}, {"$set": {"community": update["name"]}})
    return await db.lugares.find_one({"id": lid}, {"_id": 0})

@api.delete("/lugares/{lid}")
async def delete_lugar(lid: str, _: dict = Depends(require_roles("owner","admin"))):
    doc = await db.lugares.find_one({"id": lid}, {"_id": 0, "name": 1})
    if not doc:
        raise HTTPException(404, "Lugar no encontrado")
    used = await db.clients.count_documents({"community": doc["name"]})
    r = await db.lugares.delete_one({"id": lid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Lugar no encontrado")
    return {"ok": True, "clients_affected": used}

# ---------- Trabajadores (workforce roster) ----------
@api.get("/trabajadores")
async def list_trabajadores(_: dict = Depends(get_current_user)):
    items = await db.trabajadores.find({}, {"_id": 0}).sort("full_name", 1).to_list(2000)
    return items

@api.post("/trabajadores")
async def create_trabajador(payload: TrabajadorIn, _: dict = Depends(require_roles("owner","admin"))):
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.trabajadores.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.patch("/trabajadores/{tid}")
async def update_trabajador(tid: str, payload: TrabajadorUpdate,
                            _: dict = Depends(require_roles("owner","admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    r = await db.trabajadores.update_one({"id": tid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Trabajador no encontrado")
    return await db.trabajadores.find_one({"id": tid}, {"_id": 0})

@api.delete("/trabajadores/{tid}")
async def delete_trabajador(tid: str, _: dict = Depends(require_roles("owner","admin"))):
    r = await db.trabajadores.delete_one({"id": tid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Trabajador no encontrado")
    return {"ok": True}


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
                              _: dict = Depends(require_roles("owner","admin"))):
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    await db.energy_plants.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.patch("/energia/plants/{pid}")
async def update_energy_plant(pid: str, payload: EnergyPlantUpdate,
                              _: dict = Depends(require_roles("owner","admin"))):
    update = {k: v for k, v in payload.dict().items() if v is not None}
    if not update:
        raise HTTPException(400, "Nada que actualizar")
    update["updated_at"] = now_iso()
    r = await db.energy_plants.update_one({"id": pid}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Planta no encontrada")
    return await db.energy_plants.find_one({"id": pid}, {"_id": 0})

@api.delete("/energia/plants/{pid}")
async def delete_energy_plant(pid: str, _: dict = Depends(require_roles("owner","admin"))):
    r = await db.energy_plants.delete_one({"id": pid})
    if r.deleted_count == 0:
        raise HTTPException(404, "Planta no encontrada")
    return {"ok": True}

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
    if to_suspend:
        ids = [c["id"] for c in to_suspend]
        await db.clients.update_many(
            {"id": {"$in": ids}},
            {"$set": {"status": "suspended", "updated_at": now.isoformat(),
                      "suspended_at": now.isoformat(), "suspended_reason": "billing_overdue"}}
        )
    await db.cron_runs.insert_one({
        "run_id": run_id,
        "job": "suspend-overdue",
        "started_at": now.isoformat(),
        "suspended_count": len(to_suspend),
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
async def seed():
    await db.users.create_index("email", unique=True)
    await db.clients.create_index("status")
    await db.payments.create_index("client_id")
    await db.whatsapp_funnels.create_index("id", unique=True)
    await db.whatsapp_conversations.create_index("phone", unique=True)
    await db.whatsapp.create_index("provider_message_id", sparse=True)

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

# ---------- Mount ----------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
