"""Core configuration module for PadhAI backend.

Reads configuration from environment variables and provides sensible defaults.
All brand strings are strictly sourced from here per brand rules.
"""


from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings schema matching README section 17."""

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Brand
    PRODUCT_NAME: str = Field(default="PadhAI", description="Platform brand name")
    MASCOT_NAME: str = Field(default="Parama-AI", description="Mascot character name")

    # Database
    DATABASE_URL: str = Field(
        default="postgresql+psycopg://padhai:padhai@localhost:5432/padhai",
        description="SQLAlchemy database connection URI",
    )

    # Auth (Firebase)
    FIREBASE_PROJECT_ID: str = Field(default="", description="Firebase Project ID")
    GOOGLE_APPLICATION_CREDENTIALS: str | None = Field(
        default=None, description="Path to Firebase admin service account key JSON"
    )
    FIREBASE_AUTH_EMULATOR_HOST: str | None = Field(
        default=None, description="Firebase Auth emulator host (e.g. localhost:9099)"
    )

    # LLM Gateway
    LLM_CHAIN: str = Field(
        default="openrouter,groq,cerebras,google",
        description="Ordered failover provider chain",
    )
    OPENROUTER_API_KEY: str = Field(default="", description="OpenRouter API Key")
    GROQ_API_KEY: str = Field(default="", description="Groq API Key")
    CEREBRAS_API_KEY: str = Field(default="", description="Cerebras API Key")
    GOOGLE_API_KEY: str = Field(default="", description="Google AI Studio API Key")

    MODEL_SMART: str = Field(
        default="openrouter:slug|groq:slug",
        description="Smart model slug mappings per provider",
    )
    MODEL_FAST: str = Field(
        default="groq:slug|openrouter:slug",
        description="Fast model slug mappings per provider",
    )
    MODEL_VISION: str | None = Field(
        default=None, description="Vision model slug for handwriting fallback"
    )

    LLM_TIMEOUT_S: int = Field(default=30, description="Per-call LLM timeout in seconds")
    LLM_MAX_RETRIES: int = Field(default=2, description="Max retries for LLM calls")
    USER_DAILY_LLM_CALLS: int = Field(default=150, description="Daily call quota per user")
    REQUEST_MAX_LLM_CALLS: int = Field(default=6, description="Max LLM calls per request")

    # Embeddings
    EMBED_PROVIDER: str = Field(default="", description="Hosted provider for BGE-M3")
    EMBED_MODEL: str = Field(default="BAAI/bge-m3", description="Embedding model name")
    EMBED_DIM: int = Field(default=1024, description="Vector dimension")
    USE_HALFVEC: bool = Field(
        default=True, description="Use halfvec(1024) instead of vector(1024)"
    )

    # OCR (Indra)
    OCR_BACKEND: str = Field(default="indra", description="OCR backend engine")
    INDRA_OCR_MODEL_DIR: str = Field(
        default="/models/indra-ocr", description="Local path for baked Indra weights"
    )
    OCR_MODE: str = Field(default="auto", description="auto | ocr | text")
    OCR_THREADS: int = Field(default=2, description="Worker thread count for OCR")
    OCR_MATH: bool = Field(default=False, description="Enable slower math OCR mode")
    OCR_MIN_LINE_CONF: float = Field(default=0.80, description="Minimum line confidence threshold")
    OCR_VLM_FALLBACK: bool = Field(default=False, description="Fallback to vision LLM on low confidence")
    MAX_UPLOAD_MB: int = Field(default=25, description="Max upload size in megabytes")
    MAX_PAGES_PER_DOC: int = Field(default=300, description="Max pages per document")

    # Router and Guardrails
    ROUTER_MIN_CONFIDENCE: float = Field(
        default=0.6, description="Minimum confidence for router execution"
    )
    ROUTER_CONFIRM_BELOW: float = Field(
        default=0.8, description="Confidence threshold below which write agents require confirmation"
    )
    RETRIEVAL_MIN_SCORE: float | None = Field(
        default=None, description="Retrieval sufficiency gate score threshold"
    )

    # Persona
    PERSONA_PACK: str = Field(default="tanglish", description="Active persona pack: tanglish | english")
    PERSONA_DEFAULT_TONE: str = Field(default="balanced", description="Default tone setting")
    PERSONA_ADDRESS_TERM: str = Field(default="boss", description="Default address term")

    # Storage Backend
    STORAGE_BACKEND: str = Field(default="local", description="Storage backend: local | s3")
    STORAGE_LOCAL_DIR: str = Field(default="./storage", description="Local file storage root directory")
    S3_ENDPOINT_URL: str | None = Field(default=None, description="S3 / R2 endpoint URL")
    S3_BUCKET_NAME: str | None = Field(default=None, description="S3 bucket name")
    S3_ACCESS_KEY_ID: str | None = Field(default=None, description="S3 access key")
    S3_SECRET_ACCESS_KEY: str | None = Field(default=None, description="S3 secret key")


settings = Settings()
