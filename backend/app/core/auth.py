"""Firebase Authentication dependency for FastAPI.

Verifies Firebase ID tokens via Firebase Admin SDK.
Supports the Firebase Auth Emulator via FIREBASE_AUTH_EMULATOR_HOST.
Gets or creates the user in the database, ensuring strict user_id scoping.
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
    """Initializes Firebase Admin SDK if not already initialized."""
    if not firebase_admin._apps:
        if settings.FIREBASE_AUTH_EMULATOR_HOST:
            os.environ["FIREBASE_AUTH_EMULATOR_HOST"] = settings.FIREBASE_AUTH_EMULATOR_HOST
            project_id = settings.FIREBASE_PROJECT_ID or "demo-app"
            firebase_admin.initialize_app(options={"projectId": project_id})
            logger.info("Firebase Admin initialized targeting Auth Emulator at %s", settings.FIREBASE_AUTH_EMULATOR_HOST)
        elif settings.GOOGLE_APPLICATION_CREDENTIALS and os.path.exists(settings.GOOGLE_APPLICATION_CREDENTIALS):
            cred = credentials.Certificate(settings.GOOGLE_APPLICATION_CREDENTIALS)
            firebase_admin.initialize_app(cred, options={"projectId": settings.FIREBASE_PROJECT_ID or None})
            logger.info("Firebase Admin initialized with service account credentials.")
        else:
            project_id = settings.FIREBASE_PROJECT_ID or "padhai-a5585"
            try:
                import google.auth

                g_cred, _ = google.auth.default()
                cred = credentials._ExternalCredentials(g_cred)
                firebase_admin.initialize_app(cred, options={"projectId": project_id})
                logger.info(
                    "Firebase Admin initialized with application default credentials."
                )
            except Exception:
                import google.auth.credentials

                anon_cred = credentials._ExternalCredentials(
                    google.auth.credentials.AnonymousCredentials()
                )
                firebase_admin.initialize_app(anon_cred, options={"projectId": project_id})
                logger.info(
                    "Firebase Admin initialized with public key verification for project %s.",
                    project_id,
                )


# Initialize on module import
initialize_firebase()


def get_current_user(
    auth_credentials: HTTPAuthorizationCredentials | None = Security(security_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Dependency that validates Firebase ID token and resolves/creates the DB User.

    SECURITY RULE: user_id always comes from this verified dependency.
    """
    if not auth_credentials or not auth_credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth_credentials.credentials

    try:
        decoded_token = firebase_auth.verify_id_token(token, clock_skew_seconds=10)
    except Exception as exc:
        logger.warning("Token verification failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    firebase_uid = decoded_token.get("uid")
    if not firebase_uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload missing uid",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Get or create user
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
        logger.info("Created new user record for uid: %s", firebase_uid)

    return user
