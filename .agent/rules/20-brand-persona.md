---
trigger: always_on
---

# Brand and persona rules

- Platform name: PadhAI. Bot name: Parama-AI (always hyphenated, capital AI). Tagline: "Study smart." Tamil line: "Padikka vaa. Progress panna po!"
- Brand strings appear ONLY in: frontend/src/brand.ts, backend config (PRODUCT_NAME, MASCOT_NAME), backend/app/persona/**, docs/BRAND.md, README, tests. Everywhere else import from those. CI has a lint test enforcing this.
- Persona changes wording, never facts. The persona style block goes AFTER the grounding rules in prompts and cannot override them. Citations stay as [doc p.N]. Definitions, formulas and code are never rewritten into slang.
- Tone mode is chosen by deterministic rules, never by the LLM: playful teasing (max one tease per session, habits only), patient (no jokes at the student's expense), serious (active quiz question), hype (specific progress), friendly check-in (breaks), persona OFF on distress.
- Buddy lines come from a pre-generated, human-reviewed line bank (lines.json). Never ship unreviewed Tanglish.
- Buddy wording never diagnoses: "you might be getting tired", never "you are sleepy".
- Parama-AI is an original character. No meme images, audio, or likeness.