"""WhatsApp module tests: funnels, conversations, provider config, webhook, tagging."""
import os
import re
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")


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


@pytest.fixture(scope="module")
def test_phone():
    return "+52999" + str(uuid.uuid4().int)[:8]


class TestFunnels:
    def test_default_funnels_seeded(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/whatsapp/funnels")
        assert r.status_code == 200
        names = {f["name"] for f in r.json()}
        # Seed included at least these four
        assert {"Nuevos", "En proceso", "Esperando pago", "Cerrado"}.issubset(names)
        assert any(f.get("is_default") for f in r.json())

    def test_create_and_delete_funnel(self, owner_session):
        r = owner_session.post(f"{BASE_URL}/api/whatsapp/funnels",
                               json={"name": "TEST_Cobranza", "color": "#ff00aa", "order": 9})
        assert r.status_code == 200, r.text
        fid = r.json()["id"]
        assert r.json()["name"] == "TEST_Cobranza"

        r = owner_session.patch(f"{BASE_URL}/api/whatsapp/funnels/{fid}",
                                json={"name": "TEST_Cobranza2"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Cobranza2"

        r = owner_session.delete(f"{BASE_URL}/api/whatsapp/funnels/{fid}")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_cannot_delete_default(self, owner_session):
        default = next(f for f in owner_session.get(f"{BASE_URL}/api/whatsapp/funnels").json() if f.get("is_default"))
        r = owner_session.delete(f"{BASE_URL}/api/whatsapp/funnels/{default['id']}")
        assert r.status_code == 400


class TestConversationsAndTagging:
    def test_outgoing_tags_responder(self, owner_session, test_phone):
        r = owner_session.post(f"{BASE_URL}/api/whatsapp/messages", json={
            "phone": test_phone, "body": "Hola desde el CRM", "direction": "outgoing"
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["responded_by_name"], "outgoing must be tagged with responder name"
        assert data["direction"] == "outgoing"

    def test_conversation_created_and_moved(self, owner_session, test_phone):
        # ensure conversation exists after send
        convs = owner_session.get(f"{BASE_URL}/api/whatsapp/conversations").json()
        assert any(c["phone"] == test_phone for c in convs), "conversation not created"
        funnels = owner_session.get(f"{BASE_URL}/api/whatsapp/funnels").json()
        target = next(f for f in funnels if f["name"] == "En proceso")
        r = owner_session.patch(f"{BASE_URL}/api/whatsapp/conversations/{test_phone}",
                                json={"funnel_id": target["id"], "tags": ["urgente"]})
        assert r.status_code == 200
        assert r.json()["funnel_id"] == target["id"]
        assert "urgente" in r.json()["tags"]


@pytest.mark.xdist_group("whatsapp_config_singleton")
class TestProviderConfig:
    def test_get_default_config(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/whatsapp/config")
        assert r.status_code == 200
        data = r.json()
        assert data["provider"] in ("simulated", "baileys", "evolution", "waha", "wasenderapi", "custom")

    def test_patch_config_persists(self, owner_session):
        webhook_token = "test-token-" + uuid.uuid4().hex[:8]
        r = owner_session.patch(f"{BASE_URL}/api/whatsapp/config", json={
            "provider": "simulated",
            "webhook_token": webhook_token,
        })
        assert r.status_code == 200
        r2 = owner_session.get(f"{BASE_URL}/api/whatsapp/config")
        assert r2.json()["webhook_token"] == webhook_token

    def test_status_endpoint_simulated(self, owner_session):
        r = owner_session.get(f"{BASE_URL}/api/whatsapp/status")
        assert r.status_code == 200
        assert r.json()["mode"] in ("simulated", "provider")

    def test_qr_endpoint_simulated(self, owner_session):
        # switch to simulated first to guarantee no external call
        owner_session.patch(f"{BASE_URL}/api/whatsapp/config", json={"provider": "simulated", "base_url": ""})
        r = owner_session.get(f"{BASE_URL}/api/whatsapp/qr")
        assert r.status_code == 200
        assert r.json()["mode"] == "simulated"


@pytest.mark.xdist_group("whatsapp_config_singleton")
class TestWebhook:
    def test_webhook_requires_valid_token(self, owner_session):
        token = "hook-" + uuid.uuid4().hex
        owner_session.patch(f"{BASE_URL}/api/whatsapp/config", json={"webhook_token": token})
        phone = "+52111" + str(uuid.uuid4().int)[:7]

        # Wrong token -> 401
        bad = requests.post(f"{BASE_URL}/api/whatsapp/webhook",
                            headers={"X-Webhook-Token": "wrong"},
                            json={"phone": phone, "body": "hola"})
        assert bad.status_code == 401

        # Correct token -> ok
        pid = "test-msg-" + uuid.uuid4().hex[:10]
        good = requests.post(f"{BASE_URL}/api/whatsapp/webhook",
                             headers={"X-Webhook-Token": token},
                             json={"phone": phone, "body": "hola desde webhook",
                                   "provider_message_id": pid, "sender_name": "Tester"})
        assert good.status_code == 200, good.text
        assert good.json()["ok"] is True

        # message should show up in list
        msgs = owner_session.get(f"{BASE_URL}/api/whatsapp/messages", params={"phone": phone}).json()
        assert any(m["body"] == "hola desde webhook" and m["direction"] == "incoming" for m in msgs)

    def test_webhook_idempotent(self, owner_session):
        token = owner_session.get(f"{BASE_URL}/api/whatsapp/config").json().get("webhook_token")
        assert token
        phone = "+52222" + str(uuid.uuid4().int)[:7]
        pid = "dup-" + uuid.uuid4().hex[:8]
        for _ in range(2):
            r = requests.post(f"{BASE_URL}/api/whatsapp/webhook",
                              headers={"X-Webhook-Token": token},
                              json={"phone": phone, "body": "dupe", "provider_message_id": pid})
            assert r.status_code == 200
        # Only 1 message stored despite double delivery
        msgs = owner_session.get(f"{BASE_URL}/api/whatsapp/messages", params={"phone": phone}).json()
        assert len([m for m in msgs if m.get("provider_message_id") == pid]) == 1
