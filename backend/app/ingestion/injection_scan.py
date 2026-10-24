"""Prompt injection detection heuristics for document ingestion.

SECURITY RULE:
Detects adversarial prompt injection attempts embedded in uploaded documents.
Sets injection_flag = True, but NEVER drops the chunk. The chunk remains searchable,
and is wrapped in safety boundaries / untrusted data tags during RAG context construction.
"""

import re

INJECTION_PATTERNS = [
    r"\bignore\s+(?:all\s+)?previous\s+instructions\b",
    r"\bdisregard\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions|directives|rules)\b",
    r"\bsystem\s+prompt\b",
    r"\bprint\s+(?:the\s+)?system\s+prompt\b",
    r"\breveal\s+(?:the\s+)?hidden\s+(?:prompt|instructions)\b",
    r"\b(?:enter|switch\s+to|enable)\s+(?:developer\s+mode|dan\s+mode|unfiltered\s+mode)\b",
    r"\byou\s+are\s+now\s+(?:in\s+developer\s+mode|unrestricted|dan)\b",
    r"\bjailbreak\b",
    r"\bexfiltrate\s+(?:data|prompt|keys)\b",
    r"\bforget\s+all\s+(?:safety\s+rules|prior\s+instructions)\b",
    r"\bbypass\s+(?:guardrails|safety\s+filters|content\s+filters)\b",
    r"\boverride\s+system\s+instructions\b",
    r"\bact\s+as\s+an?\s+(?:unrestricted|unaligned)\s+ai\b",
]

COMPILED_INJECTION_REGEX = re.compile(
    "|".join(INJECTION_PATTERNS),
    re.IGNORECASE,
)


def scan_prompt_injection(text: str) -> bool:
    """Scans text for prompt-injection heuristics.

    Returns:
        True if an injection phrase is detected, False otherwise.
    """
    if not text:
        return False
    return bool(COMPILED_INJECTION_REGEX.search(text))
