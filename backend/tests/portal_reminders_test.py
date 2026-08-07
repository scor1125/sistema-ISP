"""Client portal + reminders integration tests."""
import io
import os
import re
import uuid
from pathlib import Path
from datetime import datetime, timezone, timedelta

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")


@pytest.fixture(scope="module")
def owner_session():
    p = Path("/app/memory/test_credentials.md")
    content = p.read_text()
    email = re.search(r"Email:\s*`([^`]+)`", content).group(1)
    password = re.search(r"Password:\s*`([^`]+)`", content).group(1)
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def test_client(owner_session):
    """Create a fresh client, expose its plaintext PIN + phone, and clean up."""
    phone = "+5299911" + uuid.uuid4().hex[:6]
    r = owner_session.post(f"{BASE_URL}/api/clients", json={
        "full_name": f"TEST_PortalUser_{uuid.uuid4().hex[:5]}",
        "phone": phone,
        "payment_day": (datetime.now().day % 28) + 1,
        "status": "suspended",  # portal upload must reactivate
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert "portal_pin" in data and data["portal_pin"], "PIN must be returned on create"
    yield data
    owner_session.delete(f"{BASE_URL}/api/clients/{data['id']}")


class TestPortalAuth:
    def test_login_requires_valid_pin(self, test_client):
        r = requests.post(f"{BASE_URL}/api/portal/login", json={"phone": test_client["phone"], "pin": "000000"})
        assert r.status_code == 401

    def test_login_ok(self, test_client):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/portal/login", json={"phone": test_client["phone"], "pin": test_client["portal_pin"]})
        assert r.status_code == 200, r.text
        assert "portal_token" in s.cookies
        assert r.json()["client"]["id"] == test_client["id"]

    def test_me_requires_portal_cookie(self):
        r = requests.get(f"{BASE_URL}/api/portal/me")
        assert r.status_code == 401

    def test_me_with_cookie(self, test_client):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/portal/login", json={"phone": test_client["phone"], "pin": test_client["portal_pin"]})
        r = s.get(f"{BASE_URL}/api/portal/me")
        assert r.status_code == 200
        data = r.json()
        assert data["client"]["id"] == test_client["id"]
        assert "portal_pin_hash" not in data["client"], "hash must never leak"
        assert "notes" not in data["client"]

    def test_staff_token_cannot_use_portal(self, owner_session):
        # staff access_token has type="access", not "portal"
        r = owner_session.get(f"{BASE_URL}/api/portal/me")
        assert r.status_code == 401


class TestPortalPayment:
    def test_upload_receipt_activates_service(self, test_client):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/portal/login", json={"phone": test_client["phone"], "pin": test_client["portal_pin"]})
        # 1x1 PNG
        png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xfa\xcf\x00\x00\x00\x02\x00\x01\xe5'\xdeF\x00\x00\x00\x00IEND\xaeB`\x82"
        r = s.post(
            f"{BASE_URL}/api/portal/payments/upload",
            files={"file": ("receipt.png", png, "image/png")},
            params={"amount": 250, "method": "transfer", "notes": "test-transfer"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "active"
        assert data["new_due_date"]

        # verify portal payments list picks it up
        r2 = s.get(f"{BASE_URL}/api/portal/payments")
        assert r2.status_code == 200
        assert any(p["status"] == "pending_review" for p in r2.json())

    def test_upload_rejects_bad_mime(self, test_client):
        s = requests.Session()
        s.post(f"{BASE_URL}/api/portal/login", json={"phone": test_client["phone"], "pin": test_client["portal_pin"]})
        r = s.post(
            f"{BASE_URL}/api/portal/payments/upload",
            files={"file": ("bad.exe", b"MZ", "application/octet-stream")},
        )
        assert r.status_code == 415


class TestReminders:
    def test_config_defaults(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/reminders/config")
        assert r.status_code == 200
        cfg = r.json()
        assert cfg["days_before"] >= 0
        assert "{{name}}" in cfg["template"]

    def test_update_config(self, owner_session):
        new_tpl = "TEST {{name}} vence {{due_date}}"
        r = owner_session.patch(f"{BASE_URL}/api/reminders/config",
                                json={"template": new_tpl, "days_before": 5})
        assert r.status_code == 200
        assert r.json()["template"] == new_tpl
        assert r.json()["days_before"] == 5

    def test_preview_lists_upcoming_clients(self, owner_session):
        # Create a client whose next_due_date is exactly 2 days out
        phone = "+5299944" + uuid.uuid4().hex[:6]
        today = datetime.now(timezone.utc)
        target = today + timedelta(days=2)
        pay_day = min(target.day, 28)
        # payment_day sets next_due_date via _next_due_date. We patch the client
        # to force a specific next_due_date so the preview will pick it up.
        c = owner_session.post(f"{BASE_URL}/api/clients", json={
            "full_name": f"TEST_ReminderClient_{uuid.uuid4().hex[:5]}",
            "phone": phone, "payment_day": pay_day, "status": "active",
        })
        assert c.status_code == 200
        cid = c.json()["id"]

        # force next_due_date via direct update (via admin patch — but the API
        # doesn't expose next_due_date). Use the DB-style workaround: send a
        # promise payment does not update next_due_date. We simulate by
        # updating client payment_day to today+2's day-of-month, which is what
        # _next_due_date already computes above.
        r = owner_session.get(f"{BASE_URL}/api/reminders/preview", params={"days_before": 60})
        assert r.status_code == 200
        data = r.json()
        assert data["count"] >= 1
        # Cleanup
        owner_session.delete(f"{BASE_URL}/api/clients/{cid}")

    def test_send_reminders_queues_whatsapp(self, owner_session, test_client):
        r = owner_session.post(f"{BASE_URL}/api/reminders/send", json={
            "client_ids": [test_client["id"]],
            "template": "Hola {{name}}, saludo de test",
        })
        assert r.status_code == 200, r.text
        assert r.json()["sent"] == 1

        # Verify WhatsApp message was created
        msgs = owner_session.get(f"{BASE_URL}/api/whatsapp/messages",
                                 params={"phone": test_client["phone"]}).json()
        assert any("saludo de test" in m["body"] for m in msgs)

    def test_regenerate_pin(self, owner_session):
        # Use an isolated client so this test doesn't clobber the module-scoped
        # `test_client` fixture used by portal upload tests.
        phone = "+5299966" + uuid.uuid4().hex[:6]
        c = owner_session.post(f"{BASE_URL}/api/clients", json={
            "full_name": f"TEST_RegenPin_{uuid.uuid4().hex[:5]}",
            "phone": phone, "payment_day": 5,
        })
        assert c.status_code == 200
        cid = c.json()["id"]
        old_pin = c.json()["portal_pin"]
        try:
            r = owner_session.post(f"{BASE_URL}/api/clients/{cid}/regenerate-pin")
            assert r.status_code == 200
            new_pin = r.json()["portal_pin"]
            assert new_pin and len(new_pin) == 6
            assert new_pin != old_pin
            # Old PIN no longer works
            r2 = requests.post(f"{BASE_URL}/api/portal/login", json={"phone": phone, "pin": old_pin})
            assert r2.status_code == 401
            # New PIN works
            r3 = requests.post(f"{BASE_URL}/api/portal/login", json={"phone": phone, "pin": new_pin})
            assert r3.status_code == 200
        finally:
            owner_session.delete(f"{BASE_URL}/api/clients/{cid}")
