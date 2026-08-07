"""NAP box port-type + capacity tests."""
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


class TestNapPortType:
    def test_create_1x8_caps_at_8(self, owner_session):
        r = owner_session.post(f"{BASE_URL}/api/nap-boxes", json={
            "name": f"TEST_NAP_1x8_{uuid.uuid4().hex[:5]}",
            "lat": 19.4326, "lng": -99.1332, "port_type": "1x8",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["port_type"] == "1x8"
        assert data["capacity"] == 8
        owner_session.delete(f"{BASE_URL}/api/nap-boxes/{data['id']}")

    def test_create_1x16_caps_at_16(self, owner_session):
        r = owner_session.post(f"{BASE_URL}/api/nap-boxes", json={
            "name": f"TEST_NAP_1x16_{uuid.uuid4().hex[:5]}",
            "lat": 19.4326, "lng": -99.1332, "port_type": "1x16",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["capacity"] == 16
        owner_session.delete(f"{BASE_URL}/api/nap-boxes/{data['id']}")

    def test_full_nap_rejects_new_client(self, owner_session):
        nap = owner_session.post(f"{BASE_URL}/api/nap-boxes", json={
            "name": f"TEST_NAP_full_{uuid.uuid4().hex[:5]}",
            "lat": 19.4326, "lng": -99.1332, "port_type": "1x8",
        }).json()
        client_ids = []
        try:
            # Fill up 8 clients
            for i in range(8):
                r = owner_session.post(f"{BASE_URL}/api/clients", json={
                    "full_name": f"TEST_NAPfill_{i}_{uuid.uuid4().hex[:4]}",
                    "phone": f"+52{uuid.uuid4().int % 10**10:010d}",
                    "payment_day": 5,
                    "nap_box_id": nap["id"],
                })
                assert r.status_code == 200, r.text
                client_ids.append(r.json()["id"])

            # 9th one must be rejected
            r = owner_session.post(f"{BASE_URL}/api/clients", json={
                "full_name": "TEST_NAPfill_overflow",
                "phone": f"+52{uuid.uuid4().int % 10**10:010d}",
                "payment_day": 5,
                "nap_box_id": nap["id"],
            })
            assert r.status_code == 400
            assert "llena" in r.json()["detail"].lower()
        finally:
            for cid in client_ids:
                owner_session.delete(f"{BASE_URL}/api/clients/{cid}")
            owner_session.delete(f"{BASE_URL}/api/nap-boxes/{nap['id']}")

    def test_status_endpoint(self, owner_session):
        nap = owner_session.post(f"{BASE_URL}/api/nap-boxes", json={
            "name": f"TEST_NAP_status_{uuid.uuid4().hex[:5]}",
            "lat": 19.4326, "lng": -99.1332, "port_type": "1x8",
        }).json()
        try:
            r = owner_session.get(f"{BASE_URL}/api/nap-boxes/status")
            assert r.status_code == 200
            entry = next(n for n in r.json() if n["id"] == nap["id"])
            assert entry["capacity"] == 8
            assert entry["used"] == 0
            assert entry["status"] == "empty"
            assert entry["available"] == 8
        finally:
            owner_session.delete(f"{BASE_URL}/api/nap-boxes/{nap['id']}")

    def test_change_port_type_reduces_capacity(self, owner_session):
        nap = owner_session.post(f"{BASE_URL}/api/nap-boxes", json={
            "name": f"TEST_NAP_change_{uuid.uuid4().hex[:5]}",
            "lat": 19.4326, "lng": -99.1332, "port_type": "1x16",
        }).json()
        assert nap["capacity"] == 16
        try:
            r = owner_session.patch(f"{BASE_URL}/api/nap-boxes/{nap['id']}", json={
                "port_type": "1x8",
            })
            assert r.status_code == 200
            assert r.json()["port_type"] == "1x8"
            # Effective capacity is always derived from port_type on read via
            # /nap-boxes/status.
            status = owner_session.get(f"{BASE_URL}/api/nap-boxes/status").json()
            entry = next(n for n in status if n["id"] == nap["id"])
            assert entry["capacity"] == 8
            assert entry["port_type"] == "1x8"
        finally:
            owner_session.delete(f"{BASE_URL}/api/nap-boxes/{nap['id']}")
