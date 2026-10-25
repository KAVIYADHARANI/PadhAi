"""Structured logging module for learning platform.

Ensures strict compliance with security rules:
- NEVER logs message text or uploaded document text.
- Formats logs as structured JSON carrying IDs, agent, model, latency, tokens, and status codes only.
"""

import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Any

SECRET_PATTERNS = [
    re.compile(r"([?&](?:key|api_key|apikey|token|secret|access_token)=)[^&\s\"']+", re.IGNORECASE),
    re.compile(r"(Bearer\s+)[A-Za-z0-9_\-\.]{8,}", re.IGNORECASE),
    re.compile(r"\bAIzaSy[A-Za-z0-9_\-]{20,}\b"),
    re.compile(r"\bsk-or-v1-[A-Za-z0-9_\-]{20,}\b"),
    re.compile(r"\bgsk_[A-Za-z0-9_\-]{20,}\b"),
    re.compile(r"\btvly-[A-Za-z0-9_\-]{15,}\b"),
]


def redact_secrets(text: str) -> str:
    """Scrub known API keys, bearer tokens, and sensitive query parameters from string."""
    if not text:
        return text
    result = text
    for pattern in SECRET_PATTERNS:
        if "Bearer" in pattern.pattern:
            result = pattern.sub(r"\1[REDACTED]", result)
        elif "[?&]" in pattern.pattern:
            result = pattern.sub(r"\1[REDACTED]", result)
        else:
            result = pattern.sub("[REDACTED_API_KEY]", result)
    return result


class SafeJsonFormatter(logging.Formatter):
    """JSON log formatter that enforces omission of raw document/user message content and redacts secrets."""

    FORBIDDEN_KEYS = {
        "message_text",
        "doc_text",
        "document_text",
        "prompt",
        "completion",
        "content",
        "user_input",
        "system_prompt",
        "chunk_text",
    }

    def format(self, record: logging.LogRecord) -> str:
        clean_event = redact_secrets(record.getMessage())
        log_data: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": clean_event,
        }

        # Attach extra contextual fields if present, filtering forbidden content
        extra = getattr(record, "extra", None)
        if isinstance(extra, dict):
            for k, v in extra.items():
                if k.lower() in self.FORBIDDEN_KEYS:
                    log_data[k] = "[REDACTED_BY_SECURITY_RULE]"
                elif isinstance(v, str):
                    log_data[k] = redact_secrets(v)
                else:
                    log_data[k] = v

        for attr in (
            "user_id",
            "course_id",
            "document_id",
            "agent",
            "model",
            "provider",
            "latency_ms",
            "tokens",
            "status",
        ):
            if hasattr(record, attr):
                val = getattr(record, attr)
                if isinstance(val, str):
                    val = redact_secrets(val)
                log_data[attr] = val

        if record.exc_info:
            log_data["exception"] = redact_secrets(self.formatException(record.exc_info))

        return json.dumps(log_data)


def setup_logging(level: int = logging.INFO) -> None:
    """Configures the root logger with the SafeJsonFormatter."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(SafeJsonFormatter())

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)


def get_logger(name: str) -> logging.Logger:
    """Returns a named logger configured with safe logging."""
    return logging.getLogger(name)
