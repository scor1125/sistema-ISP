"""Tests for the colaboradores weekly summary + toggle endpoint."""
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


@pytest.fixture()
def colaborador(owner_session):
    r = owner_session.post(f"{BASE_URL}/api/trabajadores", json={
        "full_name": f"TEST_Colab_{uuid.uuid4().hex[:6]}",
        "role": "technician",
        "daily_rate": 500,
    })
    assert r.status_code == 200
    tid = r.json()["id"]
    yield tid
    owner_session.delete(f"{BASE_URL}/api/trabajadores/{tid}")


def _sunday_of(d):
    return d - timedelta(days=(d.weekday() + 1) % 7)


class TestWorkDays:
    def test_toggle_adds_then_removes_day(self, owner_session, colaborador):
        today = datetime.now(timezone.utc).date()
        target = _sunday_of(today) + timedelta(days=1)  # Monday of current week
        d = target.isoformat()

        r = owner_session.post(f"{BASE_URL}/api/trabajadores/{colaborador}/work-days/toggle",
                               json={"date": d})
        assert r.status_code == 200
        assert r.json()["added"] is True
        assert d in r.json()["work_days"]

        # Toggle again removes it
        r = owner_session.post(f"{BASE_URL}/api/trabajadores/{colaborador}/work-days/toggle",
                               json={"date": d})
        assert r.status_code == 200
        assert r.json()["added"] is False
        assert d not in r.json()["work_days"]

    def test_toggle_missing_worker(self, owner_session):
        r = owner_session.post(f"{BASE_URL}/api/trabajadores/nope/work-days/toggle",
                               json={"date": "2026-02-10"})
        assert r.status_code == 404


class TestWeekSummary:
    def test_summary_current_week(self, owner_session, colaborador):
        today = datetime.now(timezone.utc).date()
        sunday = _sunday_of(today)
        saturday = sunday + timedelta(days=6)
        # Toggle 3 weekdays inside current week
        for offset in (1, 2, 3):  # Mon, Tue, Wed
            r = owner_session.post(
                f"{BASE_URL}/api/trabajadores/{colaborador}/work-days/toggle",
                json={"date": (sunday + timedelta(days=offset)).isoformat()}
            )
            assert r.status_code == 200

        r = owner_session.get(f"{BASE_URL}/api/trabajadores/week-summary")
        assert r.status_code == 200
        data = r.json()
        assert data["week_start"] == sunday.isoformat()
        assert data["week_end"] == saturday.isoformat()
        me = next((t for t in data["trabajadores"] if t["id"] == colaborador), None)
        assert me is not None
        assert me["days_count"] == 3
        assert me["weekly_total"] == 500 * 3

    def test_summary_with_anchor_navigates_past_weeks(self, owner_session, colaborador):
        # Add a day 2 weeks ago and confirm summary picks it up when anchored
        two_wk_ago = _sunday_of(datetime.now(timezone.utc).date()) - timedelta(days=14)
        d = (two_wk_ago + timedelta(days=2)).isoformat()  # Tue two weeks ago
        r = owner_session.post(f"{BASE_URL}/api/trabajadores/{colaborador}/work-days/toggle",
                               json={"date": d})
        assert r.status_code == 200

        r = owner_session.get(f"{BASE_URL}/api/trabajadores/week-summary",
                              params={"anchor": d})
        assert r.status_code == 200
        data = r.json()
        assert data["week_start"] == two_wk_ago.isoformat()
        me = next(t for t in data["trabajadores"] if t["id"] == colaborador)
        assert me["days_count"] == 1
        assert me["weekly_total"] == 500
