"""Sub-millisecond deterministic keyword and regex routing rules.

Follows README Section 9:
Zero-cost, sub-millisecond pattern matching for unambiguous phrasing and slash commands.
"""

from __future__ import annotations

import re
from typing import NamedTuple

from app.ai.router.schemas import AgentType
from app.core.config import settings

SLASH_COMMAND_MAP: dict[str, AgentType] = {
    "/quiz": "quiz_gen",
    "/test": "quiz_gen",
    "/cards": "flashcards",
    "/card": "flashcards",
    "/flashcards": "flashcards",
    "/flashcard": "flashcards",
    "/srs": "flashcards",
    "/plan": "roadmap",
    "/roadmap": "roadmap",
    "/schedule": "roadmap",
    "/progress": "insights",
    "/insights": "insights",
    "/stats": "insights",
    "/mastery": "insights",
    "/tutor": "tutor",
    "/ask": "tutor",
    "/explain": "tutor",
}

# Regex patterns for unambiguous matching
QUIZ_PATTERNS = [
    re.compile(r"^(?:please\s+)?quiz\s+me(?:\s+on\s+(.+))?", re.IGNORECASE),
    re.compile(r"^(?:please\s+)?test\s+me(?:\s+on\s+(.+))?", re.IGNORECASE),
    re.compile(r"\b(?:give\s+me|create|generate|start)\s+(?:a\s+)?(?:quick\s+)?quiz\b", re.IGNORECASE),
    re.compile(r"\b(?:take|do)\s+(?:a\s+)?quiz\b", re.IGNORECASE),
    re.compile(r"\bpractice\s+questions(?:\s+on\s+(.+))?\b", re.IGNORECASE),
    re.compile(r"\btest\s+my\s+knowledge\b", re.IGNORECASE),
]

FLASHCARD_PATTERNS = [
    re.compile(r"\b(?:make|create|generate|give\s+me)\s+(?:some\s+)?flashcards?\b", re.IGNORECASE),
    re.compile(r"\b(?:review|study|practice)\s+(?:my\s+)?flashcards?\b", re.IGNORECASE),
    re.compile(r"\b(?:spaced\s+repetition|srs\s+review|due\s+cards)\b", re.IGNORECASE),
    re.compile(r"\bflashcards?\s+for\s+(.+)", re.IGNORECASE),
]

ROADMAP_PATTERNS = [
    re.compile(r"\b(?:show|view|see|check|open)\s+(?:my\s+)?(?:study\s+)?roadmap\b", re.IGNORECASE),
    re.compile(r"\b(?:what\s+should\s+i\s+study\s+(?:next|today)|what\s+to\s+study\s+(?:today|next))\b", re.IGNORECASE),
    re.compile(r"\b(?:my\s+)?(?:study|learning)\s+plan\b", re.IGNORECASE),
    re.compile(r"\b(?:replan|regenerate|update)\s+(?:my\s+)?roadmap\b", re.IGNORECASE),
    re.compile(r"\b(?:what(?:\s+is|'s)?\s+on\s+my\s+schedule|show\s+(?:my\s+)?(?:daily\s+)?schedule)\b", re.IGNORECASE),
]

INSIGHTS_PATTERNS = [
    re.compile(r"\bhow\s+am\s+i\s+doing\b", re.IGNORECASE),
    re.compile(r"\b(?:show|view|check)\s+(?:my\s+)?(?:overall\s+)?progress\b", re.IGNORECASE),
    re.compile(r"\b(?:show|check)\s+(?:my\s+)?mastery\b", re.IGNORECASE),
    re.compile(r"\b(?:what\s+are\s+my\s+)?weak\s+topics\b", re.IGNORECASE),
    re.compile(r"\b(?:where\s+am\s+i\s+struggling|where\s+do\s+i\s+need\s+work)\b", re.IGNORECASE),
    re.compile(r"\b(?:my\s+)?study\s+(?:stats|statistics|summary|insights)\b", re.IGNORECASE),
]

TUTOR_PATTERNS = [
    re.compile(r"^(?:what\s+is|what\s+are|what\s+does|how\s+does|why\s+does|explain|define|tell\s+me\s+about)\b", re.IGNORECASE),
]

# Secondary intent follow-up chips
SECONDARY_CHIPS: dict[AgentType, str] = {
    "quiz_gen": "Take a practice quiz on this?",
    "flashcards": "Review flashcards for this?",
    "roadmap": "Check your study roadmap?",
    "insights": "View your mastery progress?",
    "tutor": f"Ask {settings.MASCOT_NAME} for an explanation?",
}


class RuleMatchResult(NamedTuple):
    agent: AgentType
    reason: str
    topic_hint: str | None = None
    secondary_agent: AgentType | None = None
    follow_up_chip: str | None = None


def match_deterministic_rules(message: str) -> RuleMatchResult | None:
    """Matches text against deterministic slash commands and keyword patterns.

    Returns RuleMatchResult if matched, otherwise None.
    """
    clean_msg = message.strip()
    if not clean_msg:
        return None

    # 1. Exact or prefixed slash command matching
    first_token = clean_msg.split()[0].lower()
    if first_token in SLASH_COMMAND_MAP:
        agent = SLASH_COMMAND_MAP[first_token]
        # Extract remaining text as topic hint if any
        remainder = clean_msg[len(first_token) :].strip()
        topic = remainder if remainder else None
        return RuleMatchResult(
            agent=agent,
            reason=f"slash_command:{first_token}",
            topic_hint=topic,
        )

    # 2. Specific intent scan: check quiz, flashcards, roadmap, insights
    matched_intents: list[tuple[int, AgentType, str, str | None]] = []

    # Check quiz patterns
    for p in QUIZ_PATTERNS:
        m = p.search(clean_msg)
        if m:
            topic = m.group(1).strip() if (m.lastindex and m.group(1)) else None
            matched_intents.append((m.start(), "quiz_gen", "rule:quiz_pattern", topic))
            break

    # Check flashcard patterns
    for p in FLASHCARD_PATTERNS:
        m = p.search(clean_msg)
        if m:
            topic = m.group(1).strip() if (m.lastindex and m.group(1)) else None
            matched_intents.append((m.start(), "flashcards", "rule:flashcard_pattern", topic))
            break

    # Check roadmap patterns
    for p in ROADMAP_PATTERNS:
        m = p.search(clean_msg)
        if m:
            matched_intents.append((m.start(), "roadmap", "rule:roadmap_pattern", None))
            break

    # Check insights patterns
    for p in INSIGHTS_PATTERNS:
        m = p.search(clean_msg)
        if m:
            matched_intents.append((m.start(), "insights", "rule:insights_pattern", None))
            break

    # Sort matched domain intents by position in message so earlier intent is primary
    matched_intents.sort(key=lambda x: x[0])

    # If multiple intents detected, pick the first as primary, second as follow-up chip
    if len(matched_intents) >= 2:
        _, primary_agent, primary_reason, primary_topic = matched_intents[0]
        _, secondary_agent, _, _ = matched_intents[1]
        return RuleMatchResult(
            agent=primary_agent,
            reason=f"multi_intent:{primary_reason}",
            topic_hint=primary_topic,
            secondary_agent=secondary_agent,
            follow_up_chip=SECONDARY_CHIPS.get(secondary_agent),
        )

    if len(matched_intents) == 1:
        _, agent, reason, topic = matched_intents[0]
        return RuleMatchResult(
            agent=agent,
            reason=reason,
            topic_hint=topic,
        )

    # 3. Check generic conceptual tutor patterns only if no specific domain matched
    for p in TUTOR_PATTERNS:
        m = p.search(clean_msg)
        if m:
            return RuleMatchResult(
                agent="tutor",
                reason="rule:tutor_pattern",
                topic_hint=None,
            )

    return None
