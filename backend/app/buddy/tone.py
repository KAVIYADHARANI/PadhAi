"""Deterministic tone mode selection for tutor and buddy interactions.

Rule: The tone mode is selected by deterministic rules from context, never by an LLM.
Persona changes wording, never facts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ToneType = Literal["playful", "patient", "serious", "hype", "checkin", "off"]
ToneSetting = Literal["full", "balanced", "serious", "english_only"]

# Gap threshold to consider a returning student (e.g. > 24 hours / 1440 mins)
RETURN_GAP_MINUTES_THRESHOLD = 1440.0


@dataclass(frozen=True)
class ToneContext:
    """Contextual signals used to choose the tone mode deterministically."""

    minutes_since_last_session: float | None = None
    recent_miss_count: int = 0
    quiz_active: bool = False
    mastery_event: bool = False
    break_prompt: bool = False
    distress_flag: bool = False
    teased_this_session: bool = False
    user_tone_setting: ToneSetting = "balanced"


def select_tone(context: ToneContext) -> ToneType:
    """Deterministically choose the tone mode from student context.

    Precedence order:
    1. Distress detected -> "off" (wellbeing guardrail: plain supportive language, no jokes/slang).
    2. Active quiz question -> "serious" (neutral, no banter during active questions).
    3. User requested "serious" mode -> "serious" (respects user setting).
    4. Break suggestions -> "checkin" (friendly check-in, no guilt).
    5. Mastery gain or streak -> "hype" (celebrates specific progress).
    6. Struggling (recent misses >= 2) -> "patient" (re-explain, no jokes at student's expense).
    7. Returning after gap (> 24h) and not yet teased -> "playful" (habits only, max 1 per session).
    8. Default -> "patient" (supportive and encouraging).
    """
    if context.distress_flag:
        return "off"

    if context.quiz_active:
        return "serious"

    if context.user_tone_setting == "serious":
        return "serious"

    if context.break_prompt:
        return "checkin"

    if context.mastery_event:
        return "hype"

    if context.recent_miss_count >= 2:
        return "patient"

    # Playful teasing is allowed only when returning after a gap, and at most once per session
    if (
        context.minutes_since_last_session is not None
        and context.minutes_since_last_session >= RETURN_GAP_MINUTES_THRESHOLD
        and not context.teased_this_session
        and context.user_tone_setting in ("full", "balanced")
    ):
        return "playful"

    return "patient"
