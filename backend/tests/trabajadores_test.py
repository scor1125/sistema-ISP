"""Trabajadores (workforce roster) CRUD tests."""
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
    p = Path("/app/memory/test_credentials.md")
    content = p.read_text()
    email = re.search(r"Email:\s*`([^`]+)`", content).group(1)
    password = re.search(r"Password:\s*`([^`]+)`", content).group(1)
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


class TestTrabajadoresCRUD:
    def test_list_starts(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/trabajadores")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_update_delete(self, owner_session):
        name = f"TEST_Trabajador_{uuid.uuid4().hex[:6]}"
        r = owner_session.post(f"{BASE_URL}/api/trabajadores", json={
            "full_name": name,
            "role": "technician",
            "phone": "5551112233",
            "email": "t@example.com",
            "community": "Centro",
            "hire_date": "2025-01-15",
            "daily_rate": 500,
            "active": True,
            "notes": "creado por test",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        tid = data["id"]
        assert data["full_name"] == name
        assert data["role"] == "technician"
        assert data["daily_rate"] == 500
        assert data["active"] is True

        # PATCH
        r = owner_session.patch(f"{BASE_URL}/api/trabajadores/{tid}", json={
            "community": "Norte", "active": False, "daily_rate": 750,
        })
        assert r.status_code == 200
        updated = r.json()
        assert updated["community"] == "Norte"
        assert updated["active"] is False
        assert updated["daily_rate"] == 750

        # verify in list
        listed = owner_session.get(f"{BASE_URL}/api/trabajadores").json()
        assert any(t["id"] == tid and t["community"] == "Norte" for t in listed)

        # DELETE
        r = owner_session.delete(f"{BASE_URL}/api/trabajadores/{tid}")
        assert r.status_code == 200
        assert r.json()["ok"] is True

        # confirm gone
        r = owner_session.delete(f"{BASE_URL}/api/trabajadores/{tid}")
        assert r.status_code == 404

    def test_patch_invalid_id(self, owner_session):
        r = owner_session.patch(f"{BASE_URL}/api/trabajadores/does-not-exist",
                                json={"community": "X"})
        assert r.status_code == 404

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/trabajadores")
        assert r.status_code == 401
