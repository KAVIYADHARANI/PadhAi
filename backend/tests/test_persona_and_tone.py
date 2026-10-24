"""Tests for persona packs, deterministic tone engine, and prompt builder."""

from __future__ import annotations

import pytest

from app.buddy.tone import ToneContext, select_tone
from app.persona.loader import load_persona_pack
from app.persona.prompt_builder import (
    GROUNDING_RULES,
    PERSONA_BOUNDARY_DISCLAIMER,
    build_tutor_system_prompt,
)


@pytest.mark.parametrize(
    ("context", "expected_tone"),
    [
        # 1. Distress detected -> Persona OFF (highest precedence)
        (
            ToneContext(distress_flag=True, quiz_active=True, mastery_event=True),
            "off",
        ),
        (
            ToneContext(distress_flag=True, minutes_since_last_session=3000.0),
            "off",
        ),
        # 2. Active quiz question -> Serious
        (
            ToneContext(quiz_active=True, mastery_event=True, recent_miss_count=3),
            "serious",
        ),
        (
            ToneContext(quiz_active=True, minutes_since_last_session=2000.0),
            "serious",
        ),
        # 3. User setting "serious" -> Serious
        (
            ToneContext(user_tone_setting="serious", mastery_event=True),
            "serious",
        ),
        # 4. Break suggestion -> Checkin
        (
            ToneContext(break_prompt=True, recent_miss_count=3),
            "checkin",
        ),
        # 5. Mastery gain -> Hype
        (
            ToneContext(mastery_event=True, recent_miss_count=1),
            "hype",
        ),
        # 6. Struggling (recent misses >= 2) -> Patient
        (
            ToneContext(recent_miss_count=2),
            "patient",
        ),
        (
            ToneContext(recent_miss_count=5),
            "patient",
        ),
        # 7. Returning after gap (>24h / 1440 mins) & not yet teased -> Playful
        (
            ToneContext(
                minutes_since_last_session=1500.0,
                teased_this_session=False,
                user_tone_setting="balanced",
            ),
            "playful",
        ),
        (
            ToneContext(
                minutes_since_last_session=2880.0,
                teased_this_session=False,
                user_tone_setting="full",
            ),
            "playful",
        ),
        # 8. Returning after gap, but already teased this session -> Max one tease per session enforced
        (
            ToneContext(
                minutes_since_last_session=1500.0,
                teased_this_session=True,
                user_tone_setting="balanced",
            ),
            "patient",
        ),
        # 9. Normal default study session -> Patient
        (
            ToneContext(minutes_since_last_session=30.0, recent_miss_count=0),
            "patient",
        ),
    ],
)
def test_select_tone_table_driven(context: ToneContext, expected_tone: str):
    """Test every row and priority boundary of deterministic tone selection."""
    assert select_tone(context) == expected_tone


def test_seed_lines_bank_loaded():
    """Verify seed lines are loaded and conform to README 11.5 schema."""
    pack = load_persona_pack("tanglish")
    assert pack.name == "tanglish"
    assert len(pack.lines) == 4

    for line in pack.lines:
        assert line.id
        assert line.trigger in {
            "struggling_topic",
            "low_quiz_score",
            "mastery_gained",
            "long_unbroken_study",
        }
        assert line.tone in {"patient", "hype", "friendly_checkin"}
        assert line.reviewed_by == "pending"
        assert line.text


def test_prompt_builder_grounding_precedes_persona():
    """Security rule: Grounding rules must be positioned BEFORE persona block."""
    prompt = build_tutor_system_prompt(tone="patient", pack_name="tanglish")

    grounding_idx = prompt.find("GROUNDING & INTEGRITY RULES")
    persona_idx = prompt.find("PERSONA STYLE SPECIFICATION")

    assert grounding_idx != -1
    assert persona_idx != -1
    assert grounding_idx < persona_idx, "Grounding rules must come before persona block"
    assert GROUNDING_RULES in prompt
    assert PERSONA_BOUNDARY_DISCLAIMER in prompt
    assert "[doc p.N]" in prompt


def test_prompt_builder_tone_off_omits_persona():
    """Distress/off mode must disable jokes, slang, and banter."""
    prompt = build_tutor_system_prompt(tone="off", pack_name="tanglish")
    assert "Persona mode is currently OFF" in prompt
    assert "Do not use jokes, slang, memes" in prompt
    # Grounding remains intact
    assert "GROUNDING & INTEGRITY RULES" in prompt


def test_mascot_name_swap_changes_only_name():
    """Swapping MASCOT_NAME must change only the name without altering grounding."""
    prompt_a = build_tutor_system_prompt(mascot_name="AlphaBot", pack_name="english")
    prompt_b = build_tutor_system_prompt(mascot_name="BetaBot", pack_name="english")

    assert "AlphaBot" in prompt_a
    assert "BetaBot" in prompt_b
    assert "AlphaBot" not in prompt_b

    # Verify that replacing BetaBot with AlphaBot produces identical text
    assert prompt_b.replace("BetaBot", "AlphaBot") == prompt_a
