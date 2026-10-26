"""Brand isolation lint test.

SECURITY & BRAND RULE:
Ensures platform and mascot brand strings ('PadhAI', 'Parama') do NOT appear
outside the allowed files specified in .agent/rules/20-brand-persona.md:
- frontend/src/brand.ts
- backend/app/core/config.py
- backend/app/persona/**
- docs/BRAND.md
- README.md / Readme.md
- BUILD_PLAYBOOK.md
- .agent/rules/**
- .env.example
- docker-compose.yml
- backend/tests/**
"""

import re
from pathlib import Path

BRAND_PATTERNS = [
    re.compile(r"\bPadhAI\b", re.IGNORECASE),
    re.compile(r"\bParama\b", re.IGNORECASE),
]

ALLOWED_EXACT_FILES = {
    "frontend/src/brand.ts",
    "backend/app/core/config.py",
    "docs/brand.md",
    "docs/deploy.md",
    "readme.md",
    "build_playbook.md",
    ".env.example",
    "docker-compose.yml",
    "start_dev.ps1",
    "start.ps1",
    "backend/readme.md",
    "backend/pyproject.toml",
}

ALLOWED_DIR_PREFIXES = (
    "backend/app/persona/",
    "backend/tests/",
    ".agent/rules/",
)

IGNORED_DIR_PARTS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    "dist",
    "build",
    "storage",
    "test_storage",
}


def test_brand_strings_only_in_allowed_files():
    # Repository root is parent of backend directory
    repo_root = Path(__file__).resolve().parents[2]

    violations = []

    for file_path in repo_root.rglob("*"):
        if not file_path.is_file():
            continue

        # Skip ignored directories
        if any(ignored in file_path.parts for ignored in IGNORED_DIR_PARTS):
            continue

        rel_path = file_path.relative_to(repo_root).as_posix()
        rel_path_lower = rel_path.lower()

        # Check if allowed
        if rel_path_lower in ALLOWED_EXACT_FILES or any(
            rel_path_lower.startswith(prefix.lower()) for prefix in ALLOWED_DIR_PREFIXES
        ):
            continue

        # Skip binary files or non-source files
        if file_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".ico", ".pdf", ".bin", ".lock"}:
            continue

        # Skip local uncommitted environment files (e.g. .env, .env.local)
        if file_path.name.startswith(".env") and file_path.name != ".env.example":
            continue

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        for pattern in BRAND_PATTERNS:
            matches = pattern.findall(content)
            if matches:
                violations.append(
                    f"{rel_path}: Found {len(matches)} prohibited brand occurrence(s): {matches[:3]}"
                )

    assert not violations, (
        "Brand lint failed! Prohibited brand names found outside allowed files:\n"
        + "\n".join(violations)
    )
