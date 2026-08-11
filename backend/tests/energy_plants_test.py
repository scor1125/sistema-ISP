"""Multi-plant Growatt tests (plants CRUD + estado routing)."""
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


class TestEnergyPlants:
    def test_default_plant_seeded(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/energia/plants")
        assert r.status_code == 200
        assert len(r.json()) >= 1, "at least the env-seeded plant should be present"

    def test_create_update_delete_plant(self, owner_session):
        r = owner_session.post(f"{BASE_URL}/api/energia/plants", json={
            "name": f"TEST_Plant_{uuid.uuid4().hex[:5]}",
            "plant_id": "99999999",
            "color": "#ff00aa",
            "order": 99,
        })
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        r = owner_session.patch(f"{BASE_URL}/api/energia/plants/{pid}", json={
            "name": "TEST_Plant_updated",
        })
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Plant_updated"

        r = owner_session.delete(f"{BASE_URL}/api/energia/plants/{pid}")
        assert r.status_code == 200

    def test_estado_with_unknown_plant_returns_404(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/energia/estado", params={"plant": "does-not-exist"})
        assert r.status_code == 404

    def test_estado_with_valid_plant_returns_shape(self, owner_session):
        plants = owner_session.get(f"{BASE_URL}/api/energia/plants").json()
        assert plants, "seed should provide at least 1 plant"
        pid = plants[0]["id"]
        r = owner_session.get(f"{BASE_URL}/api/energia/estado", params={"plant": pid})
        # 200 with real data OR 502 if Growatt rejects — the endpoint is wired
        assert r.status_code in (200, 502)
        if r.status_code == 200:
            data = r.json()
            for key in ("soc", "load_w", "charge_w"):
                assert key in data
            assert data.get("plant_ref") == pid
            assert data.get("plant_name") == plants[0]["name"]
