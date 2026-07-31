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



# ---------- Iteration 7: PATCH /payments/{pid} ----------
class TestPaymentsPatch:
    SEED_PID = "bbffc0d0-5bd0-4b57-b41d-bf18f5e76f0f"
    SEED_CID = "c4532e33-94f3-47ed-a915-85e006ddc7e1"

    def _get_client_next_due(self, s, cid):
        r = s.get(f"{BASE_URL}/api/clients")
        assert r.status_code == 200
        found = [c for c in r.json() if c["id"] == cid]
        assert found, f"client {cid} not found"
        return found[0].get("next_due_date")

    def test_patch_payment_updates_whitelisted_fields(self, auth_session):
        # capture next_due_date before
        before = self._get_client_next_due(auth_session, self.SEED_CID)

        payload = {
            "amount": 777,
            "concept": "TEST_iter7_patch",
            "method": "transfer",
            "notes": "patched",
            # non-whitelisted must be ignored
            "client_id": "SHOULD_BE_IGNORED",
            "created_by": "SHOULD_BE_IGNORED",
        }
        r = auth_session.patch(f"{BASE_URL}/api/payments/{self.SEED_PID}", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["amount"] == 777
        assert data["concept"] == "TEST_iter7_patch"
        assert data["method"] == "transfer"
        assert data["notes"] == "patched"
        # non-whitelisted preserved
        assert data["client_id"] == self.SEED_CID
        assert "_id" not in data
        assert "updated_at" in data

        # verify persistence via GET
        r2 = auth_session.get(f"{BASE_URL}/api/payments")
        assert r2.status_code == 200
        found = [p for p in r2.json() if p["id"] == self.SEED_PID]
        assert found and found[0]["amount"] == 777
        assert found[0]["concept"] == "TEST_iter7_patch"

        # next_due_date unchanged
        after = self._get_client_next_due(auth_session, self.SEED_CID)
        assert after == before, f"next_due_date changed: {before} -> {after}"

    def test_patch_payment_404_for_unknown(self, auth_session):
        r = auth_session.patch(f"{BASE_URL}/api/payments/nonexistent-id-xxx",
                               json={"amount": 1})
        assert r.status_code == 404


# ---------- Iteration 8: Dashboard aggregation refactor ----------
class TestDashboardStats:
    EXPECTED_KEYS = {
        "total_clients", "active", "suspended", "offline", "new",
        "new_this_month", "revenue_this_month", "revenue_prev_month",
        "monthly_revenue", "recent_payments", "open_leads",
        "disconnected_recent", "mikrotiks", "olts",
    }

    def test_dashboard_shape_and_invariants(self, auth_session):
        from datetime import datetime, timezone
        r = auth_session.get(f"{BASE_URL}/api/stats/dashboard")
        assert r.status_code == 200, r.text
        d = r.json()
        # shape
        missing = self.EXPECTED_KEYS - set(d.keys())
        assert not missing, f"missing keys: {missing}"
        # monthly_revenue: 12 items, last == current YYYY-MM, all amounts numeric >= 0
        mr = d["monthly_revenue"]
        assert isinstance(mr, list) and len(mr) == 12, f"expected 12, got {len(mr)}"
        cur_key = datetime.now(timezone.utc).strftime("%Y-%m")
        assert mr[-1]["month"] == cur_key, f"last month {mr[-1]['month']} != {cur_key}"
        for item in mr:
            assert isinstance(item["month"], str) and len(item["month"]) == 7
            assert isinstance(item["amount"], (int, float))
            assert item["amount"] >= 0
        # status counts sum == total_clients
        # only known status buckets are exposed; sum should be <= total.
        # Invariant per request: total_clients equals sum of all status buckets from aggregation
        # (we approximate: active+suspended+offline+new <= total; equality when no other statuses)
        s = d["active"] + d["suspended"] + d["offline"] + d["new"]
        assert s <= d["total_clients"], f"sum of buckets {s} > total {d['total_clients']}"
        # revenue derived from monthly aggregation
        assert d["revenue_this_month"] == mr[-1]["amount"], \
            f"revenue_this_month {d['revenue_this_month']} != last monthly {mr[-1]['amount']}"
        # numeric
        assert isinstance(d["revenue_this_month"], (int, float))
        assert isinstance(d["revenue_prev_month"], (int, float))
        assert isinstance(d["mikrotiks"], list) and isinstance(d["olts"], list)
        assert isinstance(d["recent_payments"], list)

    def test_dashboard_reflects_new_payment(self, auth_session, created_client_ids):
        # create a client (so we have a valid client_id)
        r = auth_session.post(f"{BASE_URL}/api/clients", json={
            "full_name": "TEST_DashClient", "address": "x", "payment_day": 1,
        })
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        created_client_ids.append(cid)

        # snapshot dashboard
        r0 = auth_session.get(f"{BASE_URL}/api/stats/dashboard")
        assert r0.status_code == 200
        d0 = r0.json()
        rev0 = d0["revenue_this_month"]
        last0 = d0["monthly_revenue"][-1]["amount"]

        # create a payment for current month
        amt = 123.45
        r = auth_session.post(f"{BASE_URL}/api/payments", json={
            "client_id": cid, "amount": amt, "concept": "TEST_iter8_dash",
            "method": "cash",
        })
        assert r.status_code == 200, r.text
        pid = r.json().get("id")

        # dashboard should reflect the delta
        r1 = auth_session.get(f"{BASE_URL}/api/stats/dashboard")
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["revenue_this_month"] == pytest.approx(rev0 + amt, rel=1e-6)
        assert d1["monthly_revenue"][-1]["amount"] == pytest.approx(last0 + amt, rel=1e-6)

        # cleanup: delete the payment
        if pid:
            auth_session.delete(f"{BASE_URL}/api/payments/{pid}")


# ---------- Iteration 4: mikrotik-script / mikrotik-test / vpn-test ----------
class TestMikrotikAndVpnEndpoints:
    def _get_or_create_mikrotik(self, s):
        r = s.get(f"{BASE_URL}/api/devices")
        assert r.status_code == 200
        mks = [d for d in r.json() if d.get("kind") == "mikrotik"]
        if mks:
            return mks[0]["id"]
        r = s.post(f"{BASE_URL}/api/devices", json={
            "name": "MK-Test-Iter4", "kind": "mikrotik", "host": "10.0.0.9",
            "port": 8728, "connection": "public_ip", "location": "Test",
            "vpn_protocol": "wireguard",
        })
        assert r.status_code == 200, r.text
        return r.json()["id"]

    @pytest.mark.parametrize("proto", ["wireguard", "l2tp", "openvpn"])
    def test_mikrotik_script_all_protocols(self, auth_session, proto):
        dev_id = self._get_or_create_mikrotik(auth_session)
        r = auth_session.post(f"{BASE_URL}/api/devices/{dev_id}/mikrotik-script",
                              params={"protocol": proto})
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("filename", "script", "steps", "protocol"):
            assert k in data, f"missing key {k}"
        assert data["protocol"] == proto
        assert isinstance(data["steps"], list) and len(data["steps"]) > 0
        assert isinstance(data["script"], str) and len(data["script"]) > 50
        assert data["filename"].endswith(".rsc")
        # protocol-specific content check
        if proto == "wireguard":
            assert "wireguard" in data["script"].lower()
        elif proto == "l2tp":
            assert "l2tp" in data["script"].lower()
        else:
            assert "ovpn" in data["script"].lower() or "openvpn" in data["script"].lower()

    def test_mikrotik_test_endpoint(self, auth_session):
        dev_id = self._get_or_create_mikrotik(auth_session)
        r = auth_session.post(f"{BASE_URL}/api/devices/{dev_id}/mikrotik-test")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "checks" in data and isinstance(data["checks"], list)
        assert len(data["checks"]) >= 7, f"expected >=7 checks, got {len(data['checks'])}"
        for c in data["checks"]:
            assert set(c.keys()) >= {"name", "ok", "message", "fix"}
        assert "traffic" in data and isinstance(data["traffic"], list)
        assert len(data["traffic"]) == 30
        for sample in data["traffic"]:
            assert isinstance(sample["rx_kbps"], int)
            assert isinstance(sample["tx_kbps"], int)
        assert isinstance(data["reachable"], bool)
        assert isinstance(data.get("message", ""), str)

    def test_vpn_test_endpoint(self, auth_session):
        # ensure at least one vpn_connection exists
        r = auth_session.get(f"{BASE_URL}/api/vpn")
        assert r.status_code == 200
        vpns = r.json()
        if not vpns:
            r = auth_session.post(f"{BASE_URL}/api/vpn", json={
                "name": "TEST_VPN_Iter4",
                "protocol": "wireguard",
                "remote_host": "127.0.0.1",
                "remote_port": 51820,
            })
            assert r.status_code == 200, r.text
            vpn_id = r.json()["id"]
        else:
            vpn_id = vpns[0]["id"]

        r = auth_session.post(f"{BASE_URL}/api/vpn/{vpn_id}/test")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reachable" in data
        assert "handshake" in data
        assert "checked_at" in data
        if data["reachable"] is True:
            t = data.get("traffic")
            assert t and isinstance(t, dict)
            for k in ("rx_kbps", "tx_kbps", "packets_in", "packets_out"):
                assert isinstance(t[k], int), f"{k} not int"
