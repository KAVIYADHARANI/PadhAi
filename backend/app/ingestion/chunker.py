"""Heading-aware document chunker module.

Preserves page numbers and heading paths hierarchy.
Target chunk size: ~400 to 800 tokens (~1600 to 3200 characters).
"""

import re
from dataclasses import dataclass

from app.ingestion.loader import LoadedPage


@dataclass
class ChunkData:
    """Represents an extracted and bounded text chunk ready for indexing."""

    page: int
    heading_path: str | None
    text: str
    low_conf: bool = False
    injection_flag: bool = False


HEADING_REGEX = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)


def estimate_tokens(text: str) -> int:
    """Fast rule-of-thumb token estimator (~4 chars per token)."""
    return max(1, len(text) // 4)


def split_large_text(text: str, max_tokens: int = 800) -> list[str]:
    """Splits an oversized block of text into chunks below max_tokens."""
    paragraphs = text.split("\n\n")
    chunks: list[str] = []
    current_parts: list[str] = []
    current_len = 0

    for para in paragraphs:
        para_tokens = estimate_tokens(para)
        if current_len + para_tokens > max_tokens and current_parts:
            chunks.append("\n\n".join(current_parts).strip())
            current_parts = [para]
            current_len = para_tokens
        else:
            current_parts.append(para)
            current_len += para_tokens

    if current_parts:
        chunks.append("\n\n".join(current_parts).strip())

    return chunks


def chunk_document(
    pages: list[LoadedPage],
    target_min_tokens: int = 400,
    target_max_tokens: int = 800,
) -> list[ChunkData]:
    """Chunks loaded document pages using heading awareness.

    Preserves page numbers and hierarchical heading paths (e.g. 'Intro > Chapter 1').
    Ensures chunks fall roughly within [target_min_tokens, target_max_tokens].
    """
    chunks: list[ChunkData] = []
    heading_stack: list[str] = []

    current_page: int = 1
    current_buffer: list[str] = []
    current_tokens: int = 0
    buffer_low_conf: bool = False

    def get_current_heading_path() -> str | None:
        return " > ".join(heading_stack) if heading_stack else None

    def flush_buffer() -> None:
        nonlocal current_buffer, current_tokens, buffer_low_conf
        if not current_buffer:
            return
        combined_text = "\n\n".join(current_buffer).strip()
        if not combined_text:
            current_buffer = []
            current_tokens = 0
            buffer_low_conf = False
            return

        # Check if oversized
        if current_tokens > target_max_tokens:
            split_parts = split_large_text(combined_text, max_tokens=target_max_tokens)
            for part in split_parts:
                if part.strip():
                    chunks.append(
                        ChunkData(
                            page=current_page,
                            heading_path=get_current_heading_path(),
                            text=part.strip(),
                            low_conf=buffer_low_conf,
                        )
                    )
        else:
            chunks.append(
                ChunkData(
                    page=current_page,
                    heading_path=get_current_heading_path(),
                    text=combined_text,
                    low_conf=buffer_low_conf,
                )
            )

        current_buffer = []
        current_tokens = 0
        buffer_low_conf = False

    for page in pages:
        current_page = page.page_number
        if page.has_low_conf:
            buffer_low_conf = True

        # Split page into lines / paragraphs
        lines = page.text.splitlines()
        for line in lines:
            trimmed = line.strip()
            if not trimmed:
                continue

            # Check if this line is a Markdown heading
            heading_match = HEADING_REGEX.match(trimmed)
            if heading_match:
                level = len(heading_match.group(1))
                title = heading_match.group(2).strip()

                # If we have accumulated enough tokens, flush before changing section
                if current_tokens >= target_min_tokens:
                    flush_buffer()

                # Adjust heading stack to current level
                if level <= len(heading_stack):
                    heading_stack = heading_stack[: level - 1]
                heading_stack.append(title)
                current_buffer.append(trimmed)
                current_tokens += estimate_tokens(trimmed)
            else:
                line_tokens = estimate_tokens(trimmed)
                if (
                    current_tokens + line_tokens > target_max_tokens
                    and current_tokens >= target_min_tokens
                ):
                    flush_buffer()
                    current_page = page.page_number

                current_buffer.append(trimmed)
                current_tokens += line_tokens

        # Check if buffer has reached minimum tokens at end of page
        if current_tokens >= target_min_tokens:
            flush_buffer()

    # Final flush
    flush_buffer()

    return chunks
