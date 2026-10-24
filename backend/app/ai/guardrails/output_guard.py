"""Output guardrails for checking, grounding, and sanitizing model replies.

SECURITY RULES:
1. Every [doc p.N] citation must map to a retrieved chunk's page.
2. If citations fail verification, return the safe fallback:
   "I could not verify this answer against the source documents."
3. Strip external URLs, images, and HTML. Only internal tokens like [doc p.N] render.
4. Log guardrail events with NO text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from app.ai.guardrails.input_guard import GuardrailAuditRecord

if TYPE_CHECKING:
    from app.retrieval.search import SearchResult

CITATION_PATTERN = re.compile(r"\[doc p\.(\d+)\]")
MD_IMAGE_PATTERN = re.compile(r"!\[.*?\]\(.*?\)")
MD_LINK_PATTERN = re.compile(r"\[(.*?)\]\((https?://[^\s)]+)\)")
RAW_URL_PATTERN = re.compile(r"https?://[^\s<>\"'()]+")
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")

SAFE_VERIFY_FALLBACK = "I could not verify this answer against the source documents."


@dataclass
class OutputGuardResult:
    """Result of running guard_out on a generated answer."""

    clean_reply: str
    citations: list[str] = field(default_factory=list)
    is_grounded: bool = True
    audit_records: list[GuardrailAuditRecord] = field(default_factory=list)


def check_output_guardrails(
    reply: str,
    retrieved_chunks: list[SearchResult],
) -> OutputGuardResult:
    """Validate citations against retrieved chunks and sanitize links and HTML."""
    audit_records: list[GuardrailAuditRecord] = []

    # 1. Sanitize Markdown images, HTML, and external URLs
    original_text = reply
    sanitized = MD_IMAGE_PATTERN.sub("", original_text)
    sanitized = MD_LINK_PATTERN.sub(r"\1", sanitized)  # Keep link anchor text, remove URL
    sanitized = RAW_URL_PATTERN.sub("", sanitized)
    sanitized = HTML_TAG_PATTERN.sub("", sanitized)

    if sanitized != original_text:
        audit_records.append(
            GuardrailAuditRecord(
                layer="output",
                rule="content_sanitization",
                action="stripped_links_or_html",
            )
        )

    # 2. Extract and validate citations
    citation_matches = CITATION_PATTERN.findall(sanitized)
    unique_pages = {int(p) for p in citation_matches}
    retrieved_pages = {chunk.page for chunk in retrieved_chunks}

    citations_list = [f"[doc p.{p}]" for p in sorted(unique_pages)]

    # If the reply made citations, but cited pages not present in retrieved chunks:
    if unique_pages and not unique_pages.issubset(retrieved_pages):
        audit_records.append(
            GuardrailAuditRecord(
                layer="output",
                rule="citation_validation",
                action="unverified_fallback",
            )
        )
        return OutputGuardResult(
            clean_reply=SAFE_VERIFY_FALLBACK,
            citations=[],
            is_grounded=False,
            audit_records=audit_records,
        )

    return OutputGuardResult(
        clean_reply=sanitized.strip(),
        citations=citations_list,
        is_grounded=True,
        audit_records=audit_records,
    )
