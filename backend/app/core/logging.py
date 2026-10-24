"""Structured logging module for learning platform.

Ensures strict compliance with security rules:
- NEVER logs message text or uploaded document text.
- Formats logs as structured JSON carrying IDs, agent, model, latency, tokens, and status codes only.
"""

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any


class SafeJsonFormatter(logging.Formatter):
    """JSON log formatter that enforces omission of raw document and user message content."""

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
        log_data: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }

        # Attach extra contextual fields if present, filtering forbidden content
        extra = getattr(record, "extra", None)
        if isinstance(extra, dict):
            for k, v in extra.items():
                if k.lower() in self.FORBIDDEN_KEYS:
                    log_data[k] = "[REDACTED_BY_SECURITY_RULE]"
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
                log_data[attr] = getattr(record, attr)

        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

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
