"""Payment review workflow tests."""
import os
import re
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or frontend_env.get("REACT_APP_BACKEND_URL")).rstrip("/")


@pytest.fixture(scope="module")
def owner_session():
    content = Path("/app/memory/test_credentials.md").read_text()
    email = re.search(r"Email:\s*`([^`]+)`", content).group(1)
    password = re.search(r"Password:\s*`([^`]+)`", content).group(1)
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200
    return s


@pytest.fixture()
def client_with_portal_payment(owner_session):
    """Create a client, log into portal, upload a receipt, return everything needed."""
    r = owner_session.post(f"{BASE_URL}/api/clients", json={
        "full_name": f"TEST_ReviewClient_{uuid.uuid4().hex[:5]}",
        "phone": f"+52{uuid.uuid4().int % 10**10:010d}",
        "payment_day": 5,
        "status": "suspended",
    })
    assert r.status_code == 200
    data = r.json()

    # Log into portal
    portal = requests.Session()
    r = portal.post(f"{BASE_URL}/api/portal/login", json={"pin": data["portal_pin"]})
    assert r.status_code == 200

    # Upload a PNG receipt
    png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xfa\xcf\x00\x00\x00\x02\x00\x01\xe5'\xdeF\x00\x00\x00\x00IEND\xaeB`\x82"
    r = portal.post(
        f"{BASE_URL}/api/portal/payments/upload",
        files={"file": ("r.png", png, "image/png")},
        params={"amount": 300, "method": "transfer"},
    )
    assert r.status_code == 200
    payment_id = r.json()["payment"]["id"]

    yield {"client_id": data["id"], "portal_pin": data["portal_pin"],
           "phone": data["phone"], "payment_id": payment_id, "portal": portal}
    owner_session.delete(f"{BASE_URL}/api/clients/{data['id']}")


class TestPagosRevisar:
    def test_pending_review_lists_uploaded(self, owner_session, client_with_portal_payment):
        r = owner_session.get(f"{BASE_URL}/api/payments/pending-review")
        assert r.status_code == 200
        pids = {p["id"] for p in r.json()}
        assert client_with_portal_payment["payment_id"] in pids

        # Response must include receipt_url for the admin preview
        my_payment = next(p for p in r.json() if p["id"] == client_with_portal_payment["payment_id"])
        assert my_payment.get("receipt_url", "").startswith("data:image"), "receipt must be attached"
        assert my_payment.get("client_full_name")

    def test_accept_flows_to_portal(self, owner_session, client_with_portal_payment):
        pid = client_with_portal_payment["payment_id"]
        r = owner_session.patch(f"{BASE_URL}/api/payments/{pid}/review", json={
            "status": "accepted", "review_notes": "¡Gracias!",
        })
        assert r.status_code == 200
        assert r.json()["status"] == "accepted"
        assert r.json()["review_notes"] == "¡Gracias!"
        assert r.json()["reviewed_by_name"]

        # Client sees it via the portal endpoint
        portal = client_with_portal_payment["portal"]
        pays = portal.get(f"{BASE_URL}/api/portal/payments").json()
        mine = next(p for p in pays if p["id"] == pid)
        assert mine["status"] == "accepted"
        assert mine["review_notes"] == "¡Gracias!"

    def test_reject_with_rollback_reverses_extension(self, owner_session, client_with_portal_payment):
        pid = client_with_portal_payment["payment_id"]
        cid = client_with_portal_payment["client_id"]

        client_before = next(c for c in owner_session.get(f"{BASE_URL}/api/clients").json() if c["id"] == cid)
        due_before = client_before["next_due_date"]

        r = owner_session.patch(f"{BASE_URL}/api/payments/{pid}/review", json={
            "status": "rejected", "review_notes": "Comprobante inválido",
            "rollback_extension": True,
        })
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"

        # Client's next_due_date should be earlier than it was (rolled back ~30 days)
        client_after = next(c for c in owner_session.get(f"{BASE_URL}/api/clients").json() if c["id"] == cid)
        due_after = client_after["next_due_date"]
        assert due_after < due_before, f"expected due to roll back, got {due_after} vs {due_before}"

        # Client sees rejected via portal
        portal = client_with_portal_payment["portal"]
        pays = portal.get(f"{BASE_URL}/api/portal/payments").json()
        mine = next(p for p in pays if p["id"] == pid)
        assert mine["status"] == "rejected"

    def test_reject_without_rollback_keeps_due_date(self, owner_session, client_with_portal_payment):
        pid = client_with_portal_payment["payment_id"]
        cid = client_with_portal_payment["client_id"]
        due_before = next(c for c in owner_session.get(f"{BASE_URL}/api/clients").json() if c["id"] == cid)["next_due_date"]

        r = owner_session.patch(f"{BASE_URL}/api/payments/{pid}/review", json={
            "status": "rejected", "rollback_extension": False,
        })
        assert r.status_code == 200

        due_after = next(c for c in owner_session.get(f"{BASE_URL}/api/clients").json() if c["id"] == cid)["next_due_date"]
        assert due_after == due_before, "due should not change when rollback_extension=false"

    def test_pending_status_syncs_to_portal(self, owner_session, client_with_portal_payment):
        pid = client_with_portal_payment["payment_id"]
        r = owner_session.patch(f"{BASE_URL}/api/payments/{pid}/review", json={
            "status": "pending_review",
        })
        assert r.status_code == 200

        portal = client_with_portal_payment["portal"]
        pays = portal.get(f"{BASE_URL}/api/portal/payments").json()
        mine = next(p for p in pays if p["id"] == pid)
        assert mine["status"] == "pending_review"

    def test_review_missing_payment_404(self, owner_session):
        r = owner_session.patch(f"{BASE_URL}/api/payments/does-not-exist/review",
                                json={"status": "accepted"})
        assert r.status_code == 404
