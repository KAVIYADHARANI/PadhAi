"""Tests for Firebase Authentication dependency and /api/me."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import User


def test_unauthenticated_request_returns_401(client: TestClient):
    """Requests without Authorization header must be rejected."""
    response = client.get("/api/me")
    assert response.status_code == 401
    assert "Missing Authorization header" in response.json()["detail"]


def test_invalid_token_returns_401(client: TestClient):
    """Requests with bad or expired tokens must be rejected."""
    response = client.get("/api/me", headers={"Authorization": "Bearer bad_token"})
    assert response.status_code == 401
    assert "Invalid or expired token" in response.json()["detail"]


def test_valid_token_resolves_and_creates_user(
    client: TestClient,
    auth_headers_user1: dict,
    db_session: Session,
):
    """First sign-in with verified token creates user row and returns profile."""
    # Ensure user does not exist beforehand
    existing = db_session.query(User).filter(User.firebase_uid == "firebase_uid_1").first()
    assert existing is None

    response = client.get("/api/me", headers=auth_headers_user1)
    assert response.status_code == 200
    data = response.json()
    assert data["firebase_uid"] == "firebase_uid_1"
    assert data["email"] == "user1@example.com"
    assert data["display_name"] == "User One"
    assert isinstance(data["id"], int)

    # Check user row exists in database
    created = db_session.query(User).filter(User.firebase_uid == "firebase_uid_1").first()
    assert created is not None
    assert created.id == data["id"]

    # Subsequent request reuses the same user row
    second_response = client.get("/api/me", headers=auth_headers_user1)
    assert second_response.status_code == 200
    assert second_response.json()["id"] == data["id"]
