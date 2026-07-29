"""Backend tests for ISP CRM iteration 2 refactors.

Covers:
- Auth via httpOnly cookies (login/me/logout)
- /api/onus deterministic SHA-256 derived values (no random)
- /api/clients POST accepts minimal payload (no email/lat/lng/onu_serial)
- /api/clients PATCH still works on remaining fields
"""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")


@pytest.fixture(scope="session")
def test_credentials():
    p = Path("/app/memory/test_credentials.md")
    content = p.read_text()
    email = re.search(r"Email:\s*`([^`]+)`", content).group(1)
    password = re.search(r"Password:\s*`([^`]+)`", content).group(1)
    return {"email": email, "password": password}


@pytest.fixture(scope="session")
def auth_session(test_credentials):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=test_credentials)
    if r.status_code != 200:
        pytest.fail(f"Login failed: {r.status_code} {r.text[:300]}")
    # verify cookie set
    assert "access_token" in s.cookies, "access_token cookie not set on login"
    return s


@pytest.fixture(scope="session")
def created_client_ids():
    return []


@pytest.fixture(scope="session", autouse=True)
def cleanup(auth_session, created_client_ids):
    yield
    for cid in created_client_ids:
        auth_session.delete(f"{BASE_URL}/api/clients/{cid}")


# ---------- Auth ----------
class TestAuth:
    def test_login_returns_user_and_cookie(self, test_credentials):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json=test_credentials)
        assert r.status_code == 200
        data = r.json()
        assert data["user"]["email"] == test_credentials["email"]
        assert data["user"]["role"] == "owner"
        assert "access_token" in s.cookies

    def test_me_with_cookie(self, auth_session, test_credentials):
        r = auth_session.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == test_credentials["email"]

    def test_me_without_cookie_401(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_logout_clears_cookie(self, test_credentials):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/auth/login", json=test_credentials)
        assert s.get(f"{BASE_URL}/api/auth/me").status_code == 200
        r = s.post(f"{BASE_URL}/api/auth/logout")
        assert r.status_code == 200
        # cookie removed => new bare session shouldn't be authed
        s.cookies.clear()
        assert s.get(f"{BASE_URL}/api/auth/me").status_code == 401


# ---------- ONUs (deterministic) ----------
class TestOnus:
    def test_onus_deterministic(self, auth_session, created_client_ids):
        # Ensure at least one client exists
        payload = {"full_name": "TEST_ONU_Client", "address": "calle 1", "payment_day": 5}
        r = auth_session.post(f"{BASE_URL}/api/clients", json=payload)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        created_client_ids.append(cid)

        r1 = auth_session.get(f"{BASE_URL}/api/onus")
        r2 = auth_session.get(f"{BASE_URL}/api/onus")
        assert r1.status_code == 200 and r2.status_code == 200
        d1 = {x["client_id"]: x for x in r1.json()}
        d2 = {x["client_id"]: x for x in r2.json()}
        assert cid in d1
        o1, o2 = d1[cid], d2[cid]
        for k in ["power_dbm", "rx_mbps", "tx_mbps", "ip_address", "onu_serial"]:
            assert o1[k] == o2[k], f"{k} not deterministic"
        # ranges
        assert -28.5 <= o1["power_dbm"] <= -12
        assert 1 <= o1["rx_mbps"] <= 90
        assert 0.2 <= o1["tx_mbps"] <= 12


# ---------- Clients minimal payload ----------
class TestClientsMinimal:
    def test_create_without_email_lat_lng_onu_serial(self, auth_session, created_client_ids):
        payload = {
            "full_name": "TEST_MinimalClient",
            "phone": "5551234567",
            "address": "Av Siempre Viva 742",
            "payment_day": 10,
            "mikrotik_server": "MK-Central",
            "status": "new",
            "notes": "created without optional fields",
        }
        r = auth_session.post(f"{BASE_URL}/api/clients", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        cid = data["id"]
        created_client_ids.append(cid)
        assert data["full_name"] == "TEST_MinimalClient"
        assert data["mikrotik_server"] == "MK-Central"

        # verify GET
        r2 = auth_session.get(f"{BASE_URL}/api/clients")
        assert r2.status_code == 200
        found = [c for c in r2.json() if c["id"] == cid]
        assert found and found[0]["mikrotik_server"] == "MK-Central"

    def test_patch_remaining_fields(self, auth_session, created_client_ids):
        # create
        r = auth_session.post(f"{BASE_URL}/api/clients", json={
            "full_name": "TEST_PatchClient", "address": "addr", "payment_day": 15,
        })
        assert r.status_code == 200
        cid = r.json()["id"]
        created_client_ids.append(cid)

        patch = {
            "phone": "5559998888",
            "address": "New Addr 123",
            "payment_day": 20,
            "ip_address": "10.10.5.5",
            "mikrotik_server": "MK-Sur",
            "status": "active",
            "notes": "updated",
        }
        r = auth_session.patch(f"{BASE_URL}/api/clients/{cid}", json=patch)
        assert r.status_code == 200, r.text
        updated = r.json()
        for k, v in patch.items():
            assert updated[k] == v, f"{k} not updated"


# ---------- Devices (mikrotik) - required for FE select test ----------
class TestDevices:
    def test_create_mikrotik(self, auth_session):
        r = auth_session.get(f"{BASE_URL}/api/devices")
        assert r.status_code == 200
        existing = [d for d in r.json() if d.get("kind") == "mikrotik" and d.get("name") == "MK-Central"]
        if not existing:
            r = auth_session.post(f"{BASE_URL}/api/devices", json={
                "name": "MK-Central", "kind": "mikrotik", "host": "10.0.0.1",
                "port": 8728, "connection": "public_ip", "location": "Central",
            })
            assert r.status_code == 200, r.text
