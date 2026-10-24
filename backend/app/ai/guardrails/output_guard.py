"""Output guardrails for checking, grounding, and sanitizing model replies.

SECURITY RULES:
1. Every cited page must map to a retrieved chunk's page.
2. If citations fail verification (e.g. hallucinated pages), return the safe fallback:
   "I could not verify this answer against the source documents."
3. Strip external URLs, images, and HTML.
4. Clean answer body: remove inline citation markers like [doc p.N] from paragraph text.
5. Provide structured sources metadata with document names, pages, and chunk IDs.
6. Append a formatted Sources section to the end of the clean reply.
7. Log guardrail events with NO text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.ai.guardrails.input_guard import GuardrailAuditRecord

if TYPE_CHECKING:
    from app.retrieval.search import SearchResult

CITATION_PATTERN = re.compile(r"\[(?:doc\s+)?p\.?\s*(\d+)\]", re.IGNORECASE)
MD_IMAGE_PATTERN = re.compile(r"!\[.*?\]\(.*?\)")
MD_LINK_PATTERN = re.compile(r"\[(.*?)\]\((https?://[^\s)]+)\)")
RAW_URL_PATTERN = re.compile(r"https?://[^\s<>\"'()]+")
HTML_TAG_PATTERN = re.compile(r"<[^>]+>")

SAFE_VERIFY_FALLBACK = "I could not verify this answer against the source documents."


@dataclass
class OutputGuardResult:
    """Result of running guard_out on a generated answer."""

    clean_reply: str
    clean_answer: str = ""
    sources: list[dict[str, Any]] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)
    is_grounded: bool = True
    audit_records: list[GuardrailAuditRecord] = field(default_factory=list)


def check_output_guardrails(
    reply: str,
    retrieved_chunks: list[SearchResult],
) -> OutputGuardResult:
    """Validate citations against retrieved chunks, sanitize links and HTML, and separate answer from sources."""
    audit_records: list[GuardrailAuditRecord] = []

    if not reply or not reply.strip():
        audit_records.append(
            GuardrailAuditRecord(
                layer="output",
                rule="empty_response",
                action="unverified_fallback",
            )
        )
        return OutputGuardResult(
            clean_reply=SAFE_VERIFY_FALLBACK,
            clean_answer=SAFE_VERIFY_FALLBACK,
            sources=[],
            citations=[],
            is_grounded=False,
            audit_records=audit_records,
        )

    # 1. Sanitize Markdown images, HTML, and external URLs
    original_text = reply
    sanitized = MD_IMAGE_PATTERN.sub("", original_text)
    sanitized = MD_LINK_PATTERN.sub(r"\1", sanitized)  # Keep anchor text, remove URL
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
    retrieved_pages = {chunk.page for chunk in retrieved_chunks if chunk.page is not None}

    valid_pages = unique_pages.intersection(retrieved_pages)
    invalid_pages = unique_pages - retrieved_pages

    # If the reply made explicit citations, but NONE of them exist in retrieved chunks:
    if unique_pages and not valid_pages:
        audit_records.append(
            GuardrailAuditRecord(
                layer="output",
                rule="citation_validation",
                action="unverified_fallback",
            )
        )
        return OutputGuardResult(
            clean_reply=SAFE_VERIFY_FALLBACK,
            clean_answer=SAFE_VERIFY_FALLBACK,
            sources=[],
            citations=[],
            is_grounded=False,
            audit_records=audit_records,
        )

    if invalid_pages:
        audit_records.append(
            GuardrailAuditRecord(
                layer="output",
                rule="citation_validation",
                action="partial_evidence_stripped_hallucinations",
            )
        )

    citations_list = [f"[doc p.{p}]" for p in sorted(valid_pages)] if valid_pages else []

    # 3. Separate answer body from citations: remove inline citation brackets
    # Remove any pre-existing Sources section in the raw LLM output to avoid duplicates
    clean_body = re.sub(
        r"(?:\n|\r\n)\s*\*{0,2}Sources?:?\*{0,2}[\s\S]*$", "", sanitized, flags=re.IGNORECASE
    ).strip()
    # Strip inline citation markers like [doc p.3] or [p. 3] from the body
    clean_body = CITATION_PATTERN.sub("", clean_body)
    # Clean up double spaces or spaces before punctuation created by stripping inline citations
    clean_body = re.sub(r"\s+([,\.\?\!])", r"\1", clean_body)
    clean_body = re.sub(r"[ \t]{2,}", " ", clean_body).strip()

    # 4. Build structured sources from retrieved chunks
    target_pages = (
        valid_pages if valid_pages else (unique_pages if unique_pages else retrieved_pages)
    )
    structured_sources: list[dict[str, Any]] = []
    seen_sources: set[tuple[int, int]] = set()

    for p in sorted(target_pages):
        matching = [c for c in retrieved_chunks if c.page == p]
        if matching:
            c = matching[0]
            key = (c.document_id, p)
            if key not in seen_sources:
                seen_sources.add(key)
                doc_name = c.document_name or f"document_{c.document_id}.pdf"
                structured_sources.append(
                    {
                        "document_id": c.document_id,
                        "document_name": doc_name,
                        "page": p,
                        "chunk_id": c.chunk_id,
                        "heading": c.heading_path,
                    }
                )

    # If no explicit citations were cited, also ensure citations_list has retrieved pages
    if not citations_list and structured_sources:
        citations_list = [f"[doc p.{s['page']}]" for s in structured_sources]

    # 5. Format standardized Sources section at the bottom of clean_reply
    if structured_sources:
        source_lines = [
            f"- [doc p.{s['page']}] `{s['document_name']}` — Page {s['page']}"
            for s in structured_sources
        ]
        sources_section = "\n\n**Sources:**\n" + "\n".join(source_lines)
        clean_reply = f"{clean_body}{sources_section}"
    elif citations_list:
        sources_section = "\n\n**Sources:**\n" + "\n".join(f"- {c}" for c in citations_list)
        clean_reply = f"{clean_body}{sources_section}"
    else:
        clean_reply = clean_body

    return OutputGuardResult(
        clean_reply=clean_reply,
        clean_answer=clean_body,
        sources=structured_sources,
        citations=citations_list,
        is_grounded=True,
        audit_records=audit_records,
    )
