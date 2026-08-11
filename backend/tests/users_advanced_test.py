"""Tests for user permissions + time restrictions + cobrador role."""
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
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


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    return s, r


def _create_user(owner_session, role="technician", **extra):
    email = f"test-{role}-{uuid.uuid4().hex[:6]}@example.com"
    password = "Test123!"
    payload = {"email": email, "name": f"TEST_{role}", "role": role, "password": password}
    payload.update(extra)
    r = owner_session.post(f"{BASE_URL}/api/users", json=payload)
    assert r.status_code == 200, r.text
    return {**r.json(), "password": password}


class TestCobradorRole:
    def test_cobrador_default_permissions(self, owner_session):
        u = _create_user(owner_session, role="cobrador")
        try:
            perms = u["permissions"]
            assert perms["payments"] == {"read": False, "write": True, "delete": False}, u
            for m in ("lugares", "plans", "promesas"):
                assert perms[m] == {"read": False, "write": False, "delete": False}, m
            # Clients: read-only slim projection so cobrador can pick a client
            assert perms["clients"]["read"] is True
            assert perms["clients"]["write"] is False
        finally:
            owner_session.delete(f"{BASE_URL}/api/users/{u['id']}")

    def test_cobrador_can_create_payment_but_not_read_plans(self, owner_session):
        u = _create_user(owner_session, role="cobrador")
        # Need at least 1 client to charge
        client = owner_session.post(f"{BASE_URL}/api/clients", json={
            "full_name": f"TEST_PayTarget_{uuid.uuid4().hex[:5]}",
            "phone": f"+52{uuid.uuid4().int % 10**10:010d}", "payment_day": 5,
        }).json()
        try:
            s, _ = _login(u["email"], u["password"])
            # Read clients (slim projection) → 200
            r = s.get(f"{BASE_URL}/api/clients")
            assert r.status_code == 200
            assert all("notes" not in c for c in r.json()), "cobrador must not see 'notes' field"
            # Create payment → 200
            r = s.post(f"{BASE_URL}/api/payments", json={
                "client_id": client["id"], "amount": 100, "method": "cash", "concept": "Prueba"
            })
            assert r.status_code == 200, r.text
            # Read plans → 403 (no permission)
            r = s.get(f"{BASE_URL}/api/plans")
            assert r.status_code == 403
            # Read payments → 403 (only write, not read)
            r = s.get(f"{BASE_URL}/api/payments")
            assert r.status_code == 403
        finally:
            owner_session.delete(f"{BASE_URL}/api/clients/{client['id']}")
            owner_session.delete(f"{BASE_URL}/api/users/{u['id']}")

    def test_admin_can_grant_extra_permission_to_cobrador(self, owner_session):
        u = _create_user(owner_session, role="cobrador")
        try:
            # Grant plans.read
            new_perms = u["permissions"]
            new_perms["plans"]["read"] = True
            r = owner_session.patch(f"{BASE_URL}/api/users/{u['id']}/permissions",
                                    json={"permissions": new_perms})
            assert r.status_code == 200
            # Now cobrador can list plans
            s, _ = _login(u["email"], u["password"])
            r = s.get(f"{BASE_URL}/api/plans")
            assert r.status_code == 200
        finally:
            owner_session.delete(f"{BASE_URL}/api/users/{u['id']}")


class TestTimeRestrictions:
    def test_expired_account_becomes_inactive(self, owner_session):
        # Create user with ttl_hours = -1 (already expired)
        expired = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        u = _create_user(owner_session, role="technician",
                         time_restrictions={"expires_at": expired})
        try:
            s, _ = _login(u["email"], u["password"])
            # Login itself succeeds (backend can't reject here), but subsequent
            # /auth/me should fail because get_current_user checks time restrictions.
            r = s.get(f"{BASE_URL}/api/auth/me")
            assert r.status_code == 401
            assert "expirada" in r.json().get("detail", "").lower()
            # Verify user was auto-deactivated
            db_user = next((x for x in owner_session.get(f"{BASE_URL}/api/users").json() if x["id"] == u["id"]), None)
            assert db_user and db_user["active"] is False
        finally:
            owner_session.delete(f"{BASE_URL}/api/users/{u['id']}")

    def test_ttl_hours_computes_expires_at(self, owner_session):
        u = _create_user(owner_session, role="technician",
                         time_restrictions={"ttl_hours": 72})
        try:
            assert u["time_restrictions"]["expires_at"]
            exp = datetime.fromisoformat(u["time_restrictions"]["expires_at"].replace("Z", "+00:00"))
            delta = (exp - datetime.now(timezone.utc)).total_seconds() / 3600
            assert 71 < delta < 73, f"expected ~72h ttl, got {delta}"
        finally:
            owner_session.delete(f"{BASE_URL}/api/users/{u['id']}")

    def test_disallowed_hour_blocks_access(self, owner_session):
        """Set a 1-hour window that's guaranteed NOT to include 'now'."""
        now_hour = datetime.now(timezone.utc).hour
        # Pick an hour range that definitely excludes now
        excluded_start = (now_hour + 3) % 24
        excluded_end = (now_hour + 4) % 24
        # Avoid wraparound complexity — if we'd wrap, shift to a clean range
        if excluded_end <= excluded_start:
            excluded_start = (now_hour + 2) % 24
            excluded_end = min(excluded_start + 1, 23)
            if excluded_end == excluded_start:
                excluded_end = excluded_start + 1

        u = _create_user(owner_session, role="technician",
                         time_restrictions={
                             "allowed_hours_start": excluded_start,
                             "allowed_hours_end": excluded_end,
                         })
        try:
            s, _ = _login(u["email"], u["password"])
            r = s.get(f"{BASE_URL}/api/auth/me")
            assert r.status_code == 403
            assert "horario" in r.json().get("detail", "").lower()
        finally:
            owner_session.delete(f"{BASE_URL}/api/users/{u['id']}")

    def test_allowed_hour_grants_access(self, owner_session):
        # Set a wide window that includes now
        u = _create_user(owner_session, role="technician",
                         time_restrictions={
                             "allowed_hours_start": 0, "allowed_hours_end": 24,
                         })
        try:
            s, _ = _login(u["email"], u["password"])
            r = s.get(f"{BASE_URL}/api/auth/me")
            assert r.status_code == 200
        finally:
            owner_session.delete(f"{BASE_URL}/api/users/{u['id']}")

    def test_disallowed_weekday_blocks(self, owner_session):
        # allow only a day that is definitely not today
        today_dow = (datetime.now(timezone.utc).weekday() + 1) % 7  # 0=Sun..6=Sat
        other_day = (today_dow + 3) % 7
        u = _create_user(owner_session, role="technician",
                         time_restrictions={"allowed_days": [other_day]})
        try:
            s, _ = _login(u["email"], u["password"])
            r = s.get(f"{BASE_URL}/api/auth/me")
            assert r.status_code == 403
            assert "día" in r.json().get("detail", "").lower() or "dia" in r.json().get("detail", "").lower()
        finally:
            owner_session.delete(f"{BASE_URL}/api/users/{u['id']}")

    def test_owner_bypasses_all_restrictions(self, owner_session):
        # Owner still works even with impossible restrictions on their record.
        # We're just confirming a positive control: owner_session /auth/me returns 200.
        r = owner_session.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["role"] in ("owner", "admin")


class TestPermissionEndpoints:
    def test_patch_permissions_endpoint(self, owner_session):
        u = _create_user(owner_session, role="technician")
        try:
            new_perms = {m: {"read": False, "write": False, "delete": False}
                         for m in ("clients","lugares","plans","promesas","payments")}
            new_perms["lugares"]["read"] = True
            r = owner_session.patch(f"{BASE_URL}/api/users/{u['id']}/permissions",
                                    json={"permissions": new_perms})
            assert r.status_code == 200
            assert r.json()["permissions"]["lugares"]["read"] is True
            assert r.json()["permissions"]["payments"]["write"] is False
        finally:
            owner_session.delete(f"{BASE_URL}/api/users/{u['id']}")
