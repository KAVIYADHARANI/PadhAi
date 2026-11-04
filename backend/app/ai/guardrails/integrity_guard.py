"""Academic Integrity Guardrail.

Detects requests for submit-ready solutions to graded work (exams, homework, graded quizzes)
and converts them into concept explanations and guided scaffolding questions.
Follows README Section 10: Academic integrity control.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.ai.guardrails.input_guard import GuardrailAuditRecord

GRADED_WORK_PATTERNS = [
    re.compile(r"\b(?:this\s+is\s+(?:for\s+)?(?:a\s+)?(?:my\s+)?graded\s+(?:exam|quiz|test|homework|assignment))\b", re.IGNORECASE),
    re.compile(r"\b(?:solve|do|complete|write)\s+(?:my\s+)?(?:graded\s+)?(?:exam|test|homework|assignment)\s+(?:for\s+me)\b", re.IGNORECASE),
    re.compile(r"\b(?:give\s+me\s+the\s+(?:direct\s+|exact\s+)?answers?\s+to\s+(?:my\s+)?(?:graded|exam|test|quiz|homework))\b", re.IGNORECASE),
    re.compile(r"\b(?:take|cheat\s+on)\s+(?:this|my)\s+(?:exam|quiz|test)\b", re.IGNORECASE),
    re.compile(r"\b(?:submit[- ]ready|write\s+my\s+submission)\b", re.IGNORECASE),
]

ACADEMIC_INTEGRITY_SCAFFOLDING_PROMPT = (
    "ACADEMIC INTEGRITY DIRECTIVE ACTIVE:\n"
    "The student has indicated that this question is part of graded work (exam, assignment, or test).\n"
    "Under academic integrity policy, you must NOT provide the complete submit-ready answer or write their solution directly.\n"
    "Instead, provide instructional scaffolding:\n"
    "1. Explain the underlying theorem, formula, or concept from the course materials.\n"
    "2. Break down the problem into conceptual solving steps without computing the final answer.\n"
    "3. Conclude with a helpful check-in question or diagnostic hint to guide their own solution.\n"
)


@dataclass
class IntegrityCheckResult:
    """Result of running academic integrity check on user input."""

    is_triggered: bool = False
    system_directive: str | None = None
    audit_records: list[GuardrailAuditRecord] = field(default_factory=list)


def check_academic_integrity(message: str, integrity_enabled: bool = True) -> IntegrityCheckResult:
    """Evaluates message for graded-work exploitation when integrity setting is enabled."""
    if not integrity_enabled:
        return IntegrityCheckResult(is_triggered=False)

    for pattern in GRADED_WORK_PATTERNS:
        if pattern.search(message):
            return IntegrityCheckResult(
                is_triggered=True,
                system_directive=ACADEMIC_INTEGRITY_SCAFFOLDING_PROMPT,
                audit_records=[
                    GuardrailAuditRecord(
                        layer="academic_integrity",
                        rule="graded_work_detection",
                        action="guided_explanation",
                    )
                ],
            )

    return IntegrityCheckResult(is_triggered=False)
