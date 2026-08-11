"""Tests for MikroTik REST API sync (/rest/interface).

A tiny threaded HTTP server on 127.0.0.1 stands in for the RouterOS box —
so the FastAPI backend (running in a separate process) can hit it via
Basic Auth exactly like it would a real router.
"""
import base64
import json
import os
import re
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")


SAMPLE_INTERFACES = [
    {
        ".id": "*1", "name": "ether1", "type": "ether",
        "mac-address": "AA:BB:CC:DD:EE:01", "running": "true", "disabled": "false",
        "mtu": "1500", "actual-mtu": "1500",
        "rx-byte": "123456789", "tx-byte": "987654321",
        "rx-packet": "1000", "tx-packet": "800",
        "comment": "WAN",
    },
    {
        ".id": "*2", "name": "ether2", "type": "ether",
        "mac-address": "AA:BB:CC:DD:EE:02", "running": "false", "disabled": "false",
        "mtu": "1500", "actual-mtu": "1500",
        "rx-byte": "0", "tx-byte": "0",
        "comment": "LAN dormido",
    },
    {
        ".id": "*3", "name": "bridge-clients", "type": "bridge",
        "mac-address": "AA:BB:CC:DD:EE:03", "running": "true", "disabled": "false",
        "rx-byte": "555", "tx-byte": "666",
    },
    {
        ".id": "*4", "name": "wg-crm", "type": "wg",
        "running": "true", "disabled": "true",
        "comment": "Deshabilitada temporalmente",
    },
]


class _FakeRouterState:
    """Shared state for the fake router HTTP server (per-test override)."""
    def __init__(self):
        self.status = 200
        self.payload = SAMPLE_INTERFACES
        self.expect_user = "crm-api"
        self.expect_pass = "s3cret"


_state = _FakeRouterState()


class _RouterHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Basic Auth
        auth = self.headers.get("Authorization", "")
        expected = "Basic " + base64.b64encode(
            f"{_state.expect_user}:{_state.expect_pass}".encode()
        ).decode()
        if auth != expected:
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"invalid user name or password","detail":"unauthorized"}')
            return
        if self.path != "/rest/interface":
            self.send_response(404); self.end_headers(); return

        if _state.status != 200:
            self.send_response(_state.status)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "forced"}).encode())
            return
        body = json.dumps(_state.payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass  # silence


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def fake_router():
    port = _free_port()
    srv = HTTPServer(("127.0.0.1", port), _RouterHandler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{port}"
    srv.shutdown()


@pytest.fixture(scope="module")
def session():
    content = Path("/app/memory/test_credentials.md").read_text()
    email = re.search(r"Email:\s*`([^`]+)`", content).group(1)
    password = re.search(r"Password:\s*`([^`]+)`", content).group(1)
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture
def device(session, fake_router):
    payload = {
        "name": "MK-REST-Test",
        "kind": "mikrotik",
        "host": "127.0.0.1",
        "connection": "vpn",
        "vpn_protocol": "wireguard",
        "api_enabled": True,
        "api_user": "crm-api",
        "api_password": "s3cret",
        "rest_api_url": fake_router,
        "rest_verify_ssl": False,
    }
    _state.expect_user = "crm-api"
    _state.expect_pass = "s3cret"
    _state.status = 200
    _state.payload = SAMPLE_INTERFACES
    r = session.post(f"{BASE_URL}/api/devices", json=payload)
    assert r.status_code == 200, r.text
    dev = r.json()
    yield dev
    session.delete(f"{BASE_URL}/api/devices/{dev['id']}")


class TestMikrotikRestSync:
    def test_sync_requires_rest_config(self, session):
        payload = {
            "name": "MK-NoRest", "kind": "mikrotik", "host": "1.2.3.4",
            "connection": "vpn", "vpn_protocol": "wireguard",
            "api_user": "u", "api_password": "p",
        }
        r = session.post(f"{BASE_URL}/api/devices", json=payload)
        dev = r.json()
        try:
            resp = session.post(f"{BASE_URL}/api/devices/{dev['id']}/rest-sync")
            assert resp.status_code == 400
            assert "REST" in resp.json().get("detail", "") or "URL" in resp.json().get("detail", "")
        finally:
            session.delete(f"{BASE_URL}/api/devices/{dev['id']}")

    def test_sync_success_stores_interfaces(self, session, device):
        _state.status = 200
        _state.payload = SAMPLE_INTERFACES
        r = session.post(f"{BASE_URL}/api/devices/{device['id']}/rest-sync")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["interfaces_count"] == 4
        # ether2 running=false + disabled=false -> 1 down
        assert body["interfaces_down"] == 1
        names = [i["name"] for i in body["interfaces"]]
        assert set(names) == {"ether1", "ether2", "bridge-clients", "wg-crm"}
        by_name = {i["name"]: i for i in body["interfaces"]}
        assert by_name["ether1"]["running"] is True
        assert by_name["ether1"]["disabled"] is False
        assert by_name["ether2"]["running"] is False
        assert by_name["wg-crm"]["disabled"] is True
        assert by_name["ether1"]["rx_byte"] == 123456789
        assert by_name["ether1"]["tx_byte"] == 987654321

    def test_get_interfaces_after_sync(self, session, device):
        _state.status = 200
        _state.payload = SAMPLE_INTERFACES
        session.post(f"{BASE_URL}/api/devices/{device['id']}/rest-sync")
        r = session.get(f"{BASE_URL}/api/devices/{device['id']}/interfaces")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["interfaces_count"] == 4
        assert body["interfaces_down"] == 1
        assert body["last_sync_status"] == "ok"
        assert not body.get("last_sync_error")
        assert len(body["interfaces"]) == 4

    def test_sync_401_returns_friendly_error(self, session, device):
        # Force auth mismatch on the router side
        _state.expect_pass = "wrong"
        try:
            r = session.post(f"{BASE_URL}/api/devices/{device['id']}/rest-sync")
            assert r.status_code == 424
            detail = r.json().get("detail", "")
            assert "401" in detail or "Credenciales" in detail
        finally:
            _state.expect_pass = "s3cret"

        r2 = session.get(f"{BASE_URL}/api/devices/{device['id']}/interfaces")
        assert r2.status_code == 200
        assert r2.json()["last_sync_status"] == "error"

    def test_sync_purges_removed_interfaces(self, session, device):
        _state.status = 200
        _state.payload = SAMPLE_INTERFACES
        session.post(f"{BASE_URL}/api/devices/{device['id']}/rest-sync")

        # Second sync with only 2 interfaces
        _state.payload = [i for i in SAMPLE_INTERFACES if i["name"] in ("ether1", "bridge-clients")]
        r = session.post(f"{BASE_URL}/api/devices/{device['id']}/rest-sync")
        assert r.status_code == 200, r.text
        assert r.json()["interfaces_count"] == 2

        r = session.get(f"{BASE_URL}/api/devices/{device['id']}/interfaces")
        names = [i["name"] for i in r.json()["interfaces"]]
        assert set(names) == {"ether1", "bridge-clients"}

    def test_sync_rejects_non_http_url(self, session):
        payload = {
            "name": "MK-BadUrl", "kind": "mikrotik", "host": "1.2.3.4",
            "connection": "vpn", "vpn_protocol": "wireguard",
            "api_user": "u", "api_password": "p",
            "rest_api_url": "ftp://bad-url",
        }
        r = session.post(f"{BASE_URL}/api/devices", json=payload)
        dev = r.json()
        try:
            resp = session.post(f"{BASE_URL}/api/devices/{dev['id']}/rest-sync")
            assert resp.status_code == 400
            assert "http" in resp.json().get("detail", "").lower()
        finally:
            session.delete(f"{BASE_URL}/api/devices/{dev['id']}")
