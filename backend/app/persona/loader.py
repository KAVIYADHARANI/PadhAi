"""Typed loader for persona packs, dialogue line banks, and tone rules."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PERSONA_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class LineBankEntry:
    """Entry in lines.json."""

    id: str
    trigger: str
    tone: str
    text: str
    reviewed_by: str
    reviewed_on: str


@dataclass(frozen=True)
class PersonaPack:
    """Full contents of a persona pack directory."""

    name: str
    raw_style_block: str
    lines: list[LineBankEntry]
    tone_rules: dict[str, Any]

    def render_style_block(self, mascot_name: str, address_term: str) -> str:
        """Render style block with placeholder replacements."""
        rendered = self.raw_style_block.replace("{{mascot_name}}", mascot_name)
        rendered = rendered.replace("{{address_term}}", address_term)
        return rendered


def load_persona_pack(pack_name: str = "tanglish") -> PersonaPack:
    """Load a persona pack by directory name.

    Falls back to 'english' if the requested pack does not exist.
    """
    pack_path = PERSONA_DIR / pack_name
    if not pack_path.is_dir():
        pack_path = PERSONA_DIR / "english"
        pack_name = "english"

    style_path = pack_path / "style_block.md"
    style_content = style_path.read_text(encoding="utf-8") if style_path.exists() else ""

    lines_path = pack_path / "lines.json"
    lines: list[LineBankEntry] = []
    if lines_path.exists():
        try:
            raw_lines = json.loads(lines_path.read_text(encoding="utf-8"))
            for item in raw_lines:
                lines.append(
                    LineBankEntry(
                        id=item.get("id", ""),
                        trigger=item.get("trigger", ""),
                        tone=item.get("tone", ""),
                        text=item.get("text", ""),
                        reviewed_by=item.get("reviewed_by", "pending"),
                        reviewed_on=item.get("reviewed_on", ""),
                    )
                )
        except Exception:
            lines = []

    tone_rules_path = pack_path / "tone_rules.json"
    tone_rules: dict[str, Any] = {}
    if tone_rules_path.exists():
        try:
            tone_rules = json.loads(tone_rules_path.read_text(encoding="utf-8"))
        except Exception:
            tone_rules = {}

    return PersonaPack(
        name=pack_name,
        raw_style_block=style_content,
        lines=lines,
        tone_rules=tone_rules,
    )
