from datetime import UTC, datetime, timedelta

import jwt
from fastapi.testclient import TestClient

from app.core.config import get_settings


def _login(client: TestClient, username: str, password: str):
    return client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )


def test_login_success(client: TestClient, seeded_user: str) -> None:
    resp = _login(client, "tester", "Password123!")
    assert resp.status_code == 200

    body = resp.json()
    assert body["ok"] is True
    assert body["data"]["token"]
    assert body["data"]["user"]["id"] == seeded_user
    assert body["data"]["user"]["displayName"] == "tester"
    assert body["data"]["user"]["bound"] is True
    assert body["data"]["user"]["goUserId"] == "10001"


def test_login_wrong_password(client: TestClient, seeded_user: str) -> None:
    resp = _login(client, "tester", "wrong-password")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"


def test_login_unknown_user(client: TestClient) -> None:
    resp = _login(client, "nobody", "whatever")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"


def test_login_disabled_user(client: TestClient, disabled_user: str) -> None:
    resp = _login(client, "disabled", "Password123!")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "AUTH_USER_DISABLED"


def test_me_requires_token(client: TestClient) -> None:
    resp = client.get("/api/auth/me")
    assert resp.status_code == 401


def test_me_with_token(client: TestClient, seeded_user: str) -> None:
    login = _login(client, "tester", "Password123!")
    token = login.json()["data"]["token"]

    resp = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["username"] == "tester"


def test_invalid_token(client: TestClient) -> None:
    resp = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AUTH_TOKEN_INVALID"


def test_expired_token(client: TestClient, seeded_user: str) -> None:
    settings = get_settings()
    expired = jwt.encode(
        {
            "sub": seeded_user,
            "exp": datetime.now(UTC) - timedelta(minutes=1),
        },
        settings.app_secret_key,
        algorithm=settings.jwt_algorithm,
    )

    resp = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {expired}"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AUTH_TOKEN_EXPIRED"


def test_logout(client: TestClient, seeded_user: str) -> None:
    login = _login(client, "tester", "Password123!")
    token = login.json()["data"]["token"]

    resp = client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True