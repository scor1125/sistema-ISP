from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import logging
import uuid
import jwt
import bcrypt
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any, Literal
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, status
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

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
    capacity: int = 16
    address: Optional[str] = ""
    notes: Optional[str] = ""

class ClientIn(BaseModel):
    full_name: str
    dni: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    plan_id: Optional[str] = None
    nap_box_id: Optional[str] = None
    payment_day: int = Field(ge=1, le=31, default=1)
    onu_serial: Optional[str] = ""
    ip_address: Optional[str] = ""
    mikrotik_server: Optional[str] = ""
    status: Literal["active","suspended","offline","new"] = "new"
    notes: Optional[str] = ""

class ClientUpdate(BaseModel):
    full_name: Optional[str] = None
    dni: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    plan_id: Optional[str] = None
    nap_box_id: Optional[str] = None
    payment_day: Optional[int] = None
    onu_serial: Optional[str] = None
    ip_address: Optional[str] = None
    mikrotik_server: Optional[str] = None
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
    invoice_number: Optional[str] = None

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

class TaskIn(BaseModel):
    title: str
    description: Optional[str] = ""
    stage: Literal["backlog","today","in_progress","done"] = "backlog"
    assigned_to: Optional[str] = None
    client_id: Optional[str] = None
    due_date: Optional[str] = None

class DeviceIn(BaseModel):
    name: str
    kind: Literal["olt","mikrotik"] = "olt"
    host: str
    port: Optional[int] = None
    username: Optional[str] = ""
    connection: Literal["public_ip","vpn"] = "public_ip"
    location: Optional[str] = ""
    notes: Optional[str] = ""

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

# ---------- Clients (custom with derived fields) ----------
def _next_due_date(payment_day: int, from_iso: Optional[str] = None) -> str:
    base = datetime.fromisoformat(from_iso) if from_iso else datetime.now(timezone.utc)
    year, month = base.year, base.month
    # move to next month
    month += 1
    if month > 12: month = 1; year += 1
    day = min(payment_day, 28)
    return datetime(year, month, day, tzinfo=timezone.utc).isoformat()

async def _check_nap_capacity(nap_box_id: str, exclude_client_id: Optional[str] = None):
    if not nap_box_id: return
    nap = await db.nap_boxes.find_one({"id": nap_box_id})
    if not nap: return
    q = {"nap_box_id": nap_box_id}
    if exclude_client_id: q["id"] = {"$ne": exclude_client_id}
    count = await db.clients.count_documents(q)
    if count >= nap.get("capacity", 16):
        raise HTTPException(400, f"La caja NAP '{nap['name']}' está llena ({count}/{nap['capacity']})")

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
    await db.clients.insert_one(doc)
    doc.pop("_id", None)
    return doc

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
async def create_payment(payload: PaymentIn, _: dict = Depends(get_current_user)):
    client = await db.clients.find_one({"id": payload.client_id})
    if not client:
        raise HTTPException(404, "Cliente no encontrado")
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["updated_at"] = now_iso()
    await db.payments.insert_one(doc)
    # advance due date + reactivate if this is a real payment (not a promise)
    if not payload.is_promise:
        current_due = client.get("next_due_date") or now_iso()
        new_due = _next_due_date(client.get("payment_day", 1), current_due)
        await db.clients.update_one(
            {"id": client["id"]},
            {"$set": {"next_due_date": new_due, "status": "active", "updated_at": now_iso()}}
        )
    doc.pop("_id", None)
    return doc

@api.delete("/payments/{pid}")
async def delete_payment(pid: str, _: dict = Depends(require_roles("owner","admin"))):
    await db.payments.delete_one({"id": pid})
    return {"ok": True}

# ---------- WhatsApp ----------
@api.get("/whatsapp/messages")
async def list_wa(client_id: Optional[str] = None, phone: Optional[str] = None, _: dict = Depends(get_current_user)):
    q = {}
    if client_id: q["client_id"] = client_id
    if phone: q["phone"] = phone
    items = await db.whatsapp.find(q, {"_id": 0}).sort("created_at", -1).to_list(3000)
    return items

@api.post("/whatsapp/messages")
async def create_wa(payload: WhatsAppMessageIn, _: dict = Depends(get_current_user)):
    doc = payload.dict()
    doc["id"] = new_id()
    doc["created_at"] = now_iso()
    doc["status"] = "queued" if payload.direction == "outgoing" else "received"
    await db.whatsapp.insert_one(doc)
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
    doc.pop("_id", None)
    return doc

# ---------- Business config ----------
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
    total = await db.clients.count_documents({})
    active = await db.clients.count_documents({"status": "active"})
    suspended = await db.clients.count_documents({"status": "suspended"})
    offline = await db.clients.count_documents({"status": "offline"})
    new_c = await db.clients.count_documents({"status": "new"})
    # new this month
    month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    new_month = await db.clients.count_documents({"created_at": {"$gte": month_start}})
    # revenue this month
    revenue_pipe = [
        {"$match": {"created_at": {"$gte": month_start}, "is_promise": {"$ne": True}}},
        {"$group": {"_id": None, "sum": {"$sum": "$amount"}}}
    ]
    rev = await db.payments.aggregate(revenue_pipe).to_list(1)
    revenue = rev[0]["sum"] if rev else 0
    open_leads = await db.leads.count_documents({"status": {"$in": ["new", "in_progress"]}})
    disconnected_recent = await db.clients.count_documents({"status": "offline"})
    return {
        "total_clients": total,
        "active": active,
        "suspended": suspended,
        "offline": offline,
        "new": new_c,
        "new_this_month": new_month,
        "revenue_this_month": revenue,
        "open_leads": open_leads,
        "disconnected_recent": disconnected_recent,
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
        result.append({
            "client_id": c["id"],
            "full_name": c["full_name"],
            "onu_serial": c.get("onu_serial") or f"ONU{seed:08X}",
            "ip_address": c.get("ip_address") or f"10.10.{h[7] % 255}.{h[8] % 255}",
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

# ---------- Startup ----------
async def seed():
    await db.users.create_index("email", unique=True)
    await db.clients.create_index("status")
    await db.payments.create_index("client_id")
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
