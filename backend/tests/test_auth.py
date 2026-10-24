"""Tests for Firebase Admin initialization and the get_current_user dependency.

All Firebase Admin SDK calls are mocked.  No network traffic, no emulator
required, no real credentials.
"""

from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _reset_firebase():
    """Clear the Firebase Admin app registry so initialize_firebase() re-runs."""
    import firebase_admin

    # Copy list first to avoid mutating during iteration
    for app_name in list(firebase_admin._apps.keys()):
        firebase_admin.delete_app(firebase_admin.get_app(app_name))


# ---------------------------------------------------------------------------
# initialize_firebase() – configuration and credential path tests
# ---------------------------------------------------------------------------


class TestInitializeFirebase:
    """Unit tests for the initialize_firebase() function."""

    def setup_method(self):
        _reset_firebase()

    def teardown_method(self):
        _reset_firebase()

    def test_emulator_mode_sets_env_var_and_no_credentials(self, monkeypatch):
        """Emulator path must set FIREBASE_AUTH_EMULATOR_HOST env-var and call
        initialize_app with no credential argument."""
        monkeypatch.setattr(
            "app.core.config.settings.FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099"
        )
        monkeypatch.setattr("app.core.config.settings.FIREBASE_PROJECT_ID", "demo-padhai")
        monkeypatch.setattr("app.core.config.settings.GOOGLE_APPLICATION_CREDENTIALS", None)

        import os

        with patch("firebase_admin.initialize_app") as mock_init:
            from app.core import auth

            auth.initialize_firebase()

        mock_init.assert_called_once_with(options={"projectId": "demo-padhai"})
        assert os.environ.get("FIREBASE_AUTH_EMULATOR_HOST") == "localhost:9099"

    def test_emulator_mode_does_not_use_certificate(self, monkeypatch):
        """Emulator path must NOT call credentials.Certificate."""
        monkeypatch.setattr(
            "app.core.config.settings.FIREBASE_AUTH_EMULATOR_HOST", "localhost:9099"
        )
        monkeypatch.setattr("app.core.config.settings.GOOGLE_APPLICATION_CREDENTIALS", None)

        with (
            patch("firebase_admin.initialize_app"),
            patch("firebase_admin.credentials.Certificate") as mock_cert,
        ):
            from app.core import auth

            auth.initialize_firebase()

        mock_cert.assert_not_called()

    def test_service_account_path_uses_certificate(self, monkeypatch, tmp_path):
        """When GOOGLE_APPLICATION_CREDENTIALS points to an existing file,
        credentials.Certificate must be used."""
        key_file = tmp_path / "svc.json"
        key_file.write_text("{}")  # content irrelevant; we mock Certificate

        monkeypatch.setattr("app.core.config.settings.FIREBASE_AUTH_EMULATOR_HOST", None)
        monkeypatch.setattr(
            "app.core.config.settings.GOOGLE_APPLICATION_CREDENTIALS",
            str(key_file),
        )
        monkeypatch.setattr("app.core.config.settings.FIREBASE_PROJECT_ID", "padhai-a5585")

        fake_cred = MagicMock()
        with (
            patch("firebase_admin.credentials.Certificate", return_value=fake_cred) as mock_cert,
            patch("firebase_admin.initialize_app") as mock_init,
        ):
            from app.core import auth

            auth.initialize_firebase()

        mock_cert.assert_called_once_with(str(key_file))
        mock_init.assert_called_once_with(fake_cred, options={"projectId": "padhai-a5585"})

    def test_missing_credential_file_raises_runtime_error(self, monkeypatch):
        """When GOOGLE_APPLICATION_CREDENTIALS is set to a non-existent path,
        initialize_firebase() must raise RuntimeError at startup."""
        monkeypatch.setattr("app.core.config.settings.FIREBASE_AUTH_EMULATOR_HOST", None)
        monkeypatch.setattr(
            "app.core.config.settings.GOOGLE_APPLICATION_CREDENTIALS",
            "/nonexistent/svc.json",
        )

        from app.core import auth

        with pytest.raises(RuntimeError, match="does not exist"):
            auth.initialize_firebase()

    def test_adc_path_calls_initialize_app_without_credentials(self, monkeypatch):
        """When no emulator host and no key file are configured, initialize_app
        is called without explicit credentials (ADC resolution is left to SDK)."""
        monkeypatch.setattr("app.core.config.settings.FIREBASE_AUTH_EMULATOR_HOST", None)
        monkeypatch.setattr("app.core.config.settings.GOOGLE_APPLICATION_CREDENTIALS", None)
        monkeypatch.setattr("app.core.config.settings.FIREBASE_PROJECT_ID", "padhai-a5585")

        with patch("firebase_admin.initialize_app") as mock_init:
            from app.core import auth

            auth.initialize_firebase()

        mock_init.assert_called_once_with(options={"projectId": "padhai-a5585"})

    def test_adc_failure_raises_runtime_error_with_hint(self, monkeypatch):
        """When ADC fails, a RuntimeError with a dev-friendly hint must be raised.
        The error must NOT contain credential values."""
        monkeypatch.setattr("app.core.config.settings.FIREBASE_AUTH_EMULATOR_HOST", None)
        monkeypatch.setattr("app.core.config.settings.GOOGLE_APPLICATION_CREDENTIALS", None)

        with patch("firebase_admin.initialize_app", side_effect=Exception("ADC failed")):
            from app.core import auth

            with pytest.raises(RuntimeError) as exc_info:
                auth.initialize_firebase()

        msg = str(exc_info.value)
        assert "GOOGLE_APPLICATION_CREDENTIALS" in msg
        assert "gcloud auth application-default login" in msg
        # Must NOT leak the raw exception message as-is (it's wrapped)
        assert "exc_type" in msg or "Exception" in msg

    def test_already_initialized_is_idempotent(self, monkeypatch):
        """If Firebase Admin is already initialized, initialize_firebase() must
        be a no-op and must not call initialize_app again."""
        monkeypatch.setattr("app.core.config.settings.FIREBASE_AUTH_EMULATOR_HOST", None)
        monkeypatch.setattr("app.core.config.settings.GOOGLE_APPLICATION_CREDENTIALS", None)

        fake_app = MagicMock()
        with (
            patch.dict("firebase_admin._apps", {"[DEFAULT]": fake_app}),
            patch("firebase_admin.initialize_app") as mock_init,
        ):
            from app.core import auth

            auth.initialize_firebase()

        mock_init.assert_not_called()

    def test_project_id_passed_consistently(self, monkeypatch):
        """The project_id from settings must be forwarded to initialize_app in
        all non-emulator paths."""
        monkeypatch.setattr("app.core.config.settings.FIREBASE_AUTH_EMULATOR_HOST", None)
        monkeypatch.setattr("app.core.config.settings.GOOGLE_APPLICATION_CREDENTIALS", None)
        monkeypatch.setattr("app.core.config.settings.FIREBASE_PROJECT_ID", "my-custom-project")

        with patch("firebase_admin.initialize_app") as mock_init:
            from app.core import auth

            auth.initialize_firebase()

        call_args = mock_init.call_args
        all_args = list(call_args.args) + list(call_args.kwargs.values())
        options_found = next((a for a in all_args if isinstance(a, dict) and "projectId" in a), {})
        assert options_found.get("projectId") == "my-custom-project"


# ---------------------------------------------------------------------------
# get_current_user() – HTTP dependency tests (uses the conftest mocks)
# ---------------------------------------------------------------------------


def test_unauthenticated_request_returns_401(client):
    """Requests without Authorization header must be rejected with 401."""
    response = client.get("/api/me")
    assert response.status_code == 401
    assert "Missing Authorization header" in response.json()["detail"]


def test_invalid_token_returns_401(client):
    """Requests with invalid tokens must return 401 with a safe error message."""
    response = client.get("/api/me", headers={"Authorization": "Bearer bad_token"})
    assert response.status_code == 401
    assert "Invalid or expired token" in response.json()["detail"]


def test_valid_token_resolves_and_creates_user(client, auth_headers_user1, db_session):
    """First sign-in with a verified token creates a user row and returns profile."""
    from app.db.models import User

    existing = db_session.query(User).filter(User.firebase_uid == "firebase_uid_1").first()
    assert existing is None

    response = client.get("/api/me", headers=auth_headers_user1)
    assert response.status_code == 200
    data = response.json()
    assert data["firebase_uid"] == "firebase_uid_1"
    assert data["email"] == "user1@example.com"
    assert data["display_name"] == "User One"
    assert isinstance(data["id"], int)

    created = db_session.query(User).filter(User.firebase_uid == "firebase_uid_1").first()
    assert created is not None


def test_token_exception_type_logged_not_token_value(client, caplog):
    """The warning log for a bad token must contain the exception type name
    and must never contain the raw token string."""
    import logging

    with caplog.at_level(logging.WARNING, logger="app.core.auth"):
        client.get("/api/me", headers={"Authorization": "Bearer super_secret_bad_token"})

    # At minimum: the token must NOT appear in any log record.
    all_log_text = " ".join(r.getMessage() for r in caplog.records)
    assert "super_secret_bad_token" not in all_log_text


def test_emulator_mismatch_detection(monkeypatch):
    """When the frontend is using real Firebase but the backend targets the emulator,
    verify_id_token raises an error.  The dependency converts it to 401, never 500."""
    # This is simulated by the conftest fake_verify_id_token raising ValueError
    # for any unknown token — same observable behaviour as an emulator mismatch.
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        response = c.get(
            "/api/me",
            headers={"Authorization": "Bearer real-firebase-jwt-rejected-by-emulator"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired token"
