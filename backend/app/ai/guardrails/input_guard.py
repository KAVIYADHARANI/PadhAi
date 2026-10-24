"""Input guardrails for checking user chat messages.

SECURITY & WELLBEING RULES:
1. Max length enforcement (2000 chars).
2. Wellbeing / distress detection routes to a fixed supportive message.
3. Prompt injection detection logs guardrail event and sets flag.
4. NO raw message text is logged.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MAX_MESSAGE_LENGTH = 2000

DISTRESS_PATTERNS = [
    re.compile(
        r"\b(suicide|kill myself|end my life|want to die|hurt myself|self[- ]harm)\b", re.IGNORECASE
    ),
    re.compile(r"\b(can't go on|hopeless|depressed|end it all)\b", re.IGNORECASE),
]

INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions?", re.IGNORECASE),
    re.compile(
        r"(reveal|print|show|dump)\s+(your\s+)?(system\s+prompt|instructions)", re.IGNORECASE
    ),
    re.compile(r"\b(jailbreak|dan\s+mode|developer\s+mode)\b", re.IGNORECASE),
    re.compile(r"\byou\s+are\s+now\s+an\s+unrestricted\b", re.IGNORECASE),
    re.compile(r"<\s*/?\s*(system|instruction|prompt)\s*>", re.IGNORECASE),
]

DISTRESS_SUPPORT_REPLY = (
    "It sounds like you might be going through a really difficult time. Please remember that you are not alone "
    "and there is support available. Please reach out to someone you trust, or contact a local crisis support service:\n\n"
    "- India: Tele-MANAS (14416 or 1800 891 4416), Vandrevala Foundation (+91 9999 666 555)\n"
    "- International: Visit https://findahelpline.com to find free, confidential support in your country.\n\n"
    "I am here as a study companion, but your wellbeing is what matters most."
)


@dataclass
class GuardrailAuditRecord:
    """Record to be saved to guardrail_events without message text."""

    layer: str
    rule: str
    action: str


@dataclass
class InputGuardResult:
    """Result of running guard_in on a user message."""

    is_blocked: bool = False
    is_distress: bool = False
    injection_flag: bool = False
    response_override: str | None = None
    audit_records: list[GuardrailAuditRecord] = field(default_factory=list)


def check_input_guardrails(message: str) -> InputGuardResult:
    """Run all input guardrail checks on an incoming user message.

    Returns an InputGuardResult with flags, optional response override, and audit events.
    """
    result = InputGuardResult()

    # 1. Length check
    if len(message) > MAX_MESSAGE_LENGTH:
        result.is_blocked = True
        result.response_override = f"Your message is too long (maximum {MAX_MESSAGE_LENGTH} characters). Please ask a more concise question."
        result.audit_records.append(
            GuardrailAuditRecord(layer="input", rule="length_limit", action="blocked_length")
        )
        return result

    # 2. Wellbeing / Distress check
    for pattern in DISTRESS_PATTERNS:
        if pattern.search(message):
            result.is_blocked = True
            result.is_distress = True
            result.response_override = DISTRESS_SUPPORT_REPLY
            result.audit_records.append(
                GuardrailAuditRecord(
                    layer="wellbeing", rule="distress_detector", action="routed_support"
                )
            )
            return result

    # 3. Prompt Injection Heuristics
    for pattern in INJECTION_PATTERNS:
        if pattern.search(message):
            result.injection_flag = True
            result.audit_records.append(
                GuardrailAuditRecord(
                    layer="input", rule="injection_heuristic", action="flagged_injection"
                )
            )
            break

    return result
