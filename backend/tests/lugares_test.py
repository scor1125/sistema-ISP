"""Tests for the Lugares (places) catalog CRUD."""
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


class TestLugaresCRUD:
    def test_list_ok(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/lugares")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_update_delete(self, owner_session):
        name = f"TEST_Lugar_{uuid.uuid4().hex[:5]}"
        r = owner_session.post(f"{BASE_URL}/api/lugares",
                               json={"name": name, "color": "#ff0000", "notes": "creado por test"})
        assert r.status_code == 200
        lid = r.json()["id"]
        assert r.json()["name"] == name

        # Duplicate name rejected
        r = owner_session.post(f"{BASE_URL}/api/lugares", json={"name": name})
        assert r.status_code == 400

        # PATCH renames
        new_name = name + "_renombrado"
        r = owner_session.patch(f"{BASE_URL}/api/lugares/{lid}", json={"name": new_name})
        assert r.status_code == 200
        assert r.json()["name"] == new_name

        # DELETE
        r = owner_session.delete(f"{BASE_URL}/api/lugares/{lid}")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_rename_cascades_to_clients(self, owner_session):
        """When a lugar is renamed, clients referencing it by name are updated."""
        name = f"TEST_LugarRen_{uuid.uuid4().hex[:5]}"
        r = owner_session.post(f"{BASE_URL}/api/lugares", json={"name": name})
        lid = r.json()["id"]

        # Create a client using this place
        c = owner_session.post(f"{BASE_URL}/api/clients", json={
            "full_name": f"TEST_LugarClient_{uuid.uuid4().hex[:5]}",
            "phone": "+5299900" + uuid.uuid4().hex[:6],
            "community": name,
            "payment_day": 5,
        })
        cid = c.json()["id"]

        try:
            new_name = name + "_v2"
            owner_session.patch(f"{BASE_URL}/api/lugares/{lid}", json={"name": new_name})
            r = owner_session.get(f"{BASE_URL}/api/clients")
            client = next(x for x in r.json() if x["id"] == cid)
            assert client["community"] == new_name
        finally:
            owner_session.delete(f"{BASE_URL}/api/clients/{cid}")
            owner_session.delete(f"{BASE_URL}/api/lugares/{lid}")

    def test_delete_reports_affected_clients(self, owner_session):
        name = f"TEST_LugarUsed_{uuid.uuid4().hex[:5]}"
        lid = owner_session.post(f"{BASE_URL}/api/lugares", json={"name": name}).json()["id"]
        c = owner_session.post(f"{BASE_URL}/api/clients", json={
            "full_name": f"TEST_C_{uuid.uuid4().hex[:5]}",
            "phone": "+5299911" + uuid.uuid4().hex[:6],
            "community": name,
            "payment_day": 5,
        }).json()

        r = owner_session.delete(f"{BASE_URL}/api/lugares/{lid}")
        assert r.status_code == 200
        assert r.json()["clients_affected"] == 1
        owner_session.delete(f"{BASE_URL}/api/clients/{c['id']}")
