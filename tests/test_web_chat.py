import sqlite3
import subprocess
import os
import time

import pytest
from werkzeug.security import generate_password_hash

from app import app
from hermes_dashboard import web_chat


@pytest.fixture
def private_chat(tmp_path, monkeypatch):
    monkeypatch.setattr(web_chat, "ENABLED", True)
    monkeypatch.setattr(web_chat, "PASSWORD_HASH", generate_password_hash("senha-forte-de-teste"))
    monkeypatch.setattr(web_chat, "DB_PATH", tmp_path / "private" / "queue.db")
    monkeypatch.setattr(web_chat.lab, "snapshot", lambda: {
        "now": "2026-09-23T12:00:00Z", "metrics": {"cpu": 42, "memory": 61, "processes": 3},
        "workers": [{"id": "guide:vm", "name": "VM", "sector": "vm", "kind": "guide", "status": "observed", "description": "Infraestrutura", "facts": ["CPU real"]}],
    })
    app.secret_key = "test-session-secret"
    app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
    with app.test_client() as client:
        yield client


def authorize(client):
    response = client.post("/api/lab/hermes-chat/login", json={"password": "senha-forte-de-teste"})
    assert response.status_code == 200
    return {"X-Chat-CSRF": response.get_json()["csrf"]}


def test_private_queue_requires_login_csrf_and_informational_question(private_chat):
    url = "/api/lab/hermes-chat/jobs"
    body = {"robot_id": "guide:vm", "question": "Qual é o uso da CPU?"}
    assert private_chat.post(url, json=body).status_code == 401
    assert private_chat.post("/api/lab/hermes-chat/login", json={"password": "errada"}).status_code == 401
    headers = authorize(private_chat)
    assert private_chat.post(url, json=body).status_code == 403
    assert private_chat.post(url, json=body, headers={**headers, "Origin": "https://evil.test"}).status_code == 403
    assert private_chat.post(url, json={**body, "question": "Execute rm -rf /"}, headers=headers).status_code == 400
    assert private_chat.post(url, json={**body, "question": "/tools enable terminal"}, headers=headers).status_code == 400
    accepted = private_chat.post(url, json=body, headers=headers)
    assert accepted.status_code == 202
    item = private_chat.get(f"{url}/{accepted.get_json()['id']}").get_json()
    assert item["status"] == "queued" and item["question"] == body["question"]
    if os.name != "nt":
        assert web_chat.DB_PATH.stat().st_mode & 0o777 == 0o600


def test_queue_recovers_a_crashed_worker_and_keeps_history(private_chat, monkeypatch):
    headers = authorize(private_chat)
    created = private_chat.post("/api/lab/hermes-chat/jobs", json={"robot_id": "guide:vm", "question": "O que a VM faz?"}, headers=headers).get_json()["id"]
    row = web_chat._claim()
    assert row["id"] == created
    conn = sqlite3.connect(web_chat.DB_PATH)
    conn.execute("UPDATE jobs SET lease_until=? WHERE id=?", (time.time() - 1, created))
    conn.commit(); conn.close()
    recovered = web_chat._claim()
    assert recovered["id"] == created
    web_chat._finish(recovered, answer="A VM usa CPU e RAM.")
    jobs = private_chat.get("/api/lab/hermes-chat/history?robot_id=guide:vm").get_json()["jobs"]
    assert jobs[0]["status"] == "done" and jobs[0]["answer"] == "A VM usa CPU e RAM."


def test_hermes_invocation_has_no_tools_and_no_shell(private_chat, monkeypatch):
    calls = []
    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 0, "CPU em 42%.\nsession_id: abc", "")
    monkeypatch.setattr(web_chat.subprocess, "run", run)
    row = {"robot_id": "guide:vm", "question": "Qual a CPU?", "context": "{}"}
    assert web_chat._answer(row) == "CPU em 42%."
    assert "get_tool_definitions" in calls[0][0][-1]
    assert calls[1][0][calls[1][0].index("--toolsets") + 1] == "context_engine"
    assert calls[1][0][calls[1][0].index("--query-file") + 1] == "-"
    assert isinstance(calls[1][0], list) and calls[1][1]["input"].endswith('"Qual a CPU?"')
