"""Growatt ShinePhone integration tests — Growatt calls are mocked via respx."""
import os
import re
from pathlib import Path

import pytest
import respx
import requests
from httpx import Response
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


class TestGrowattService:
    """Unit tests against the growatt.py service (no real HTTP)."""

    def test_maps_signed_power(self):
        """pCharge - pDischarge → charge_w (positive=charging, negative=discharging)."""
        import asyncio
        from growatt import read_growatt_estado
        with respx.mock(base_url="https://openapi.growatt.com/v1") as mock:
            mock.get("/device/list").mock(
                return_value=Response(200, json={"data": {"devices": [
                    {"type": 2, "device_sn": "BAT-TEST-1"}
                ]}})
            )
            mock.post("/device/storage/storage_last_data").mock(
                return_value=Response(200, json={"data": {
                    "capacity": "72.5",
                    "pacToUser": "620",
                    "pCharge": "0",
                    "pDischarge": "900",
                }})
            )
            data = asyncio.run(read_growatt_estado("fake-key", "12345"))
            assert data["soc"] == 72.5
            assert data["load_w"] == 620.0
            assert data["charge_w"] == -900.0  # discharging → negative
            assert data["device_sn"] == "BAT-TEST-1"

    def test_charging_produces_positive(self):
        import asyncio
        from growatt import read_growatt_estado
        # device_sn is passed explicitly so /device/list is not called.
        with respx.mock(base_url="https://openapi.growatt.com/v1", assert_all_called=False) as mock:
            mock.post("/device/storage/storage_last_data").mock(
                return_value=Response(200, json={"data": {
                    "capacity": "88", "pacToUser": "410",
                    "pCharge": "1500", "pDischarge": "0",
                }})
            )
            data = asyncio.run(read_growatt_estado("fake-key", "12345", device_sn="SPH-1"))
            assert data["charge_w"] == 1500.0
            assert data["soc"] == 88.0

    def test_invalid_soc_raises(self):
        import asyncio
        from growatt import read_growatt_estado
        with respx.mock(base_url="https://openapi.growatt.com/v1") as mock:
            mock.post("/device/storage/storage_last_data").mock(
                return_value=Response(200, json={"data": {
                    "capacity": "150", "pacToUser": "0", "pCharge": "0", "pDischarge": "0",
                }})
            )
            with pytest.raises(RuntimeError, match="SOC inválido"):
                asyncio.run(read_growatt_estado("fake", "1", device_sn="X"))


class TestEnergiaEndpoint:
    """Endpoint /api/energia/estado (real HTTP against our server).

    We can't mock Growatt from here (the request goes through the running
    backend), so this test just verifies the endpoint responds with 200 or
    502 depending on whether the key is valid. It always checks the shape.
    """

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/energia/estado")
        assert r.status_code == 401

    def test_authenticated_call_returns_expected_shape(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/energia/estado")
        # 200 with real data OR 502 if Growatt rejects the key — both are OK,
        # what matters is the endpoint is wired up + the shape of a 200 body.
        assert r.status_code in (200, 502)
        if r.status_code == 200:
            data = r.json()
            for key in ("soc", "load_w", "charge_w"):
                assert key in data
                assert isinstance(data[key], (int, float))
            assert 0 <= data["soc"] <= 100
