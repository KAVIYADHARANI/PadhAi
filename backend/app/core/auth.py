"""Firebase Authentication dependency for FastAPI.

Verifies Firebase ID tokens via Firebase Admin SDK.
Supports the Firebase Auth Emulator via FIREBASE_AUTH_EMULATOR_HOST.
Gets or creates the user in the database, ensuring strict user_id scoping.

Initialization order
--------------------
1. Emulator mode  – when FIREBASE_AUTH_EMULATOR_HOST is set.
   Firebase Admin is initialized with no credentials (emulator provides them).
   The env-var is set on os.environ so the Admin SDK can read it internally.

2. Service-account file – when GOOGLE_APPLICATION_CREDENTIALS points to an
   existing JSON key file.  Uses ``credentials.Certificate``.

3. Application Default Credentials – when neither of the above applies.
   Works automatically on GCP (Cloud Run, GKE …) and locally after
   ``gcloud auth application-default login``.
   Uses ``firebase_admin.initialize_app()`` with no explicit credential arg
   so the SDK resolves ADC itself via google-auth (supported public API).

If ADC is also unavailable a ``RuntimeError`` is raised at startup so the
problem surfaces immediately rather than causing silent 401s at request time.
"""

import os

import firebase_admin
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models import User
from app.db.session import get_db

logger = get_logger(__name__)

security_scheme = HTTPBearer(auto_error=False)


def initialize_firebase() -> None:
    """Initializes Firebase Admin SDK (idempotent – skipped when already initialized).

    Raises
    ------
    RuntimeError
        When the backend is not in emulator mode and no usable credential can
        be found.  The message intentionally avoids printing credential values.
    """
    if firebase_admin._apps:
        return  # Already initialized; nothing to do.

    project_id = settings.FIREBASE_PROJECT_ID

    # ------------------------------------------------------------------
    # Path 1: Emulator mode
    # ------------------------------------------------------------------
    if settings.FIREBASE_AUTH_EMULATOR_HOST:
        # Propagate to os.environ so the Admin SDK internals pick it up.
        os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = settings.FIREBASE_AUTH_EMULATOR_HOST
        firebase_admin.initialize_app(options={"projectId": project_id})
        logger.info(
            "Firebase Admin initialized in emulator mode. "
            "project_id=%s emulator_host=%s",
            project_id,
            settings.FIREBASE_AUTH_EMULATOR_HOST,
        )
        return

    # ------------------------------------------------------------------
    # Path 2: Explicit service-account key file
    # ------------------------------------------------------------------
    cred_path = settings.GOOGLE_APPLICATION_CREDENTIALS
    if cred_path:
        if not os.path.exists(cred_path):
            raise RuntimeError(
                f"GOOGLE_APPLICATION_CREDENTIALS is set to '{cred_path}' "
                "but that file does not exist. "
                "On Windows dev, download the service-account JSON from "
                "Firebase Console → Project settings → Service accounts and "
                "set GOOGLE_APPLICATION_CREDENTIALS to its absolute path."
            )
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred, options={"projectId": project_id})
        logger.info(
            "Firebase Admin initialized with service-account key. project_id=%s",
            project_id,
        )
        return

    # ------------------------------------------------------------------
    # Path 3: Application Default Credentials (GCP / gcloud ADC)
    # ------------------------------------------------------------------
    # Let the Admin SDK resolve ADC via google-auth (supported public API).
    # If ADC is unavailable, google-auth raises DefaultCredentialsError, which
    # we catch and re-raise as a RuntimeError with a clear dev hint.
    try:
        firebase_admin.initialize_app(options={"projectId": project_id})
        logger.info(
            "Firebase Admin initialized with Application Default Credentials. "
            "project_id=%s",
            project_id,
        )
    except Exception as exc:
        raise RuntimeError(
            "Firebase Admin SDK could not find credentials. "
            "For local development, either:\n"
            "  a) Set GOOGLE_APPLICATION_CREDENTIALS to the absolute path of your "
            "Firebase service-account JSON file, or\n"
            "  b) Run `gcloud auth application-default login` and ensure the "
            "authenticated account has the 'Firebase Authentication Admin' role.\n"
            f"Underlying error type: {type(exc).__name__}"
            # Note: exc message may contain paths but never tokens or key material.
        ) from exc


# Initialize on module import so misconfiguration surfaces at startup, not
# at the first authenticated request.
initialize_firebase()


def get_current_user(
    auth_credentials: HTTPAuthorizationCredentials | None = Security(security_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Dependency that validates Firebase ID token and resolves/creates the DB User.

    SECURITY RULE: user_id always comes from this verified dependency.
    The token string is never logged.
    """
    if not auth_credentials or not auth_credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth_credentials.credentials

    try:
        decoded_token = firebase_auth.verify_id_token(token, clock_skew_seconds=60)
    except Exception as exc:
        # Log the exception *type* and message only – never the token value.
        logger.warning(
            "Token verification failed. exc_type=%s detail=%s",
            type(exc).__name__,
            str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    firebase_uid = decoded_token.get("uid")
    if not firebase_uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload missing uid",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Get or create user – user_id comes from the verified token, never from
    # the request body or model output (security rule §1).
    user = db.query(User).filter(User.firebase_uid == firebase_uid).first()
    if not user:
        email = decoded_token.get("email")
        display_name = decoded_token.get("name") or decoded_token.get("display_name")
        user = User(
            firebase_uid=firebase_uid,
            email=email,
            display_name=display_name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info("Created new user record. uid=%s", firebase_uid)

    return user
