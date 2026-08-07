"""Verify portal PINs are globally unique across all clients."""
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


class TestPinUniqueness:
    def test_new_clients_get_unique_pins(self, owner_session):
        """Create 5 clients back-to-back and confirm every PIN is unique."""
        created = []
        try:
            for i in range(5):
                r = owner_session.post(f"{BASE_URL}/api/clients", json={
                    "full_name": f"TEST_PinUniq_{i}_{uuid.uuid4().hex[:5]}",
                    "phone": f"+52{uuid.uuid4().int % 10**10:010d}",
                    "payment_day": 5,
                })
                assert r.status_code == 200, r.text
                created.append(r.json())
            pins = [c["portal_pin"] for c in created]
            assert len(set(pins)) == len(pins), f"Duplicate PINs generated: {pins}"
        finally:
            for c in created:
                owner_session.delete(f"{BASE_URL}/api/clients/{c['id']}")

    def test_regenerate_pin_never_collides_with_others(self, owner_session):
        """When regenerating a client's PIN it must not equal any other client's PIN."""
        a = owner_session.post(f"{BASE_URL}/api/clients", json={
            "full_name": f"TEST_PinRegenA_{uuid.uuid4().hex[:5]}",
            "phone": f"+52{uuid.uuid4().int % 10**10:010d}",
            "payment_day": 5,
        }).json()
        b = owner_session.post(f"{BASE_URL}/api/clients", json={
            "full_name": f"TEST_PinRegenB_{uuid.uuid4().hex[:5]}",
            "phone": f"+52{uuid.uuid4().int % 10**10:010d}",
            "payment_day": 5,
        }).json()
        try:
            for _ in range(3):
                r = owner_session.post(f"{BASE_URL}/api/clients/{a['id']}/regenerate-pin")
                assert r.status_code == 200
                new_pin = r.json()["portal_pin"]
                assert new_pin != b["portal_pin"], "Regenerated PIN clashes with another client"
        finally:
            owner_session.delete(f"{BASE_URL}/api/clients/{a['id']}")
            owner_session.delete(f"{BASE_URL}/api/clients/{b['id']}")
