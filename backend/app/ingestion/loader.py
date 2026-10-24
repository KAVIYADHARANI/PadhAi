"""Document loader module supporting native PDF text extraction and Indra OCR fallback.

Follows README Section 6:
- Pages with a text layer are used directly (skips OCR).
- Scanned pages are processed via Indra OCR.
- Captures per-line confidences; flags lines under OCR_MIN_LINE_CONF as low_conf.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from pypdf import PdfReader

from app.core.config import settings


class PageLimitExceededError(ValueError):
    """Raised when a document exceeds the maximum allowable page count."""


class DocumentLoadError(RuntimeError):
    """Raised when a document cannot be read or processed."""


@dataclass
class PageLine:
    """A single line of text extracted from a document page."""

    text: str
    box: list[float] | None = None
    confidence: float = 1.0
    is_low_conf: bool = False


@dataclass
class LoadedPage:
    """Extracted text and structural confidence metadata for a single document page."""

    page_number: int  # 1-indexed
    text: str
    lines: list[PageLine] = field(default_factory=list)
    source: str = "text"  # "text" | "ocr" | "both"
    is_ocr: bool = False
    avg_confidence: float = 1.0
    has_low_conf: bool = False


class OCREngine(Protocol):
    """Protocol for OCR converters to facilitate testing and alternate engines."""

    def convert_page(self, file_path: str, page_number: int) -> tuple[str, list[PageLine]]:
        """Extracts markdown text and line-level confidences for a given page."""
        ...


class DefaultIndraOCREngine:
    """Default implementation wrapping the official Indra OCR library."""

    def __init__(self, model_dir: str | None = None, threads: int = 2) -> None:
        self.model_dir = model_dir or settings.INDRA_OCR_MODEL_DIR
        self.threads = threads
        self._converter: Any = None

    def _get_converter(self) -> Any:
        if self._converter is None:
            try:
                import indra_ocr

                self._converter = indra_ocr.load(
                    threads=self.threads,
                    mode="ocr",
                    model_dir=self.model_dir,
                )
            except ImportError as err:
                raise DocumentLoadError(
                    "indra-ocr is not installed. Install it with `pip install indra-ocr` or use mock engine in tests."
                ) from err
        return self._converter

    def convert_page(self, file_path: str, page_number: int) -> tuple[str, list[PageLine]]:
        conv = self._get_converter()
        # Convert pages and find the requested 1-indexed page
        for idx, page in enumerate(conv.convert(file_path), start=1):
            if idx == page_number:
                extracted_lines: list[PageLine] = []
                for ln in getattr(page, "lines", []):
                    conf = getattr(ln, "conf", 1.0)
                    extracted_lines.append(
                        PageLine(
                            text=getattr(ln, "text", ""),
                            box=getattr(ln, "box", None),
                            confidence=conf,
                            is_low_conf=conf < settings.OCR_MIN_LINE_CONF,
                        )
                    )
                text = getattr(page, "markdown", None) or getattr(page, "text", "")
                return text, extracted_lines
        raise DocumentLoadError(f"Page {page_number} not found in {file_path}")


def load_document_pages(
    file_path: str | Path,
    ocr_mode: str = "auto",
    min_line_conf: float = 0.80,
    max_pages: int | None = None,
    ocr_engine: OCREngine | None = None,
) -> list[LoadedPage]:
    """Loads and extracts text from a PDF document, using native text or OCR per page.

    Args:
        file_path: Path to the PDF file.
        ocr_mode: "auto" (use text layer if present, else OCR), "ocr" (force OCR), "text" (only text layer).
        min_line_conf: Threshold below which lines are marked as low_conf.
        max_pages: Maximum allowed pages before raising PageLimitExceededError.
        ocr_engine: Optional OCR engine implementation (useful for tests and dependency injection).

    Returns:
        List of LoadedPage objects with text, line details, and confidence flags.
    """
    path_obj = Path(file_path)
    if not path_obj.exists():
        raise DocumentLoadError(f"File not found: {file_path}")

    max_pages_limit = max_pages or settings.MAX_PAGES_PER_DOC

    try:
        reader = PdfReader(str(path_obj))
    except Exception as err:
        raise DocumentLoadError(f"Failed to parse PDF file: {err}") from err

    total_pages = len(reader.pages)
    if total_pages > max_pages_limit:
        raise PageLimitExceededError(
            f"Document has {total_pages} pages, which exceeds the limit of {max_pages_limit}."
        )

    results: list[LoadedPage] = []

    for page_idx, page in enumerate(reader.pages, start=1):
        native_text = ""
        try:
            native_text = (page.extract_text() or "").strip()
        except Exception:
            native_text = ""

        # Determine whether to use native text layer or trigger OCR
        has_text_layer = len(native_text) >= 20
        use_ocr = (ocr_mode == "ocr") or (ocr_mode == "auto" and not has_text_layer)

        if not use_ocr and has_text_layer:
            # Native text layer present
            raw_lines = [line.strip() for line in native_text.splitlines() if line.strip()]
            page_lines = [
                PageLine(text=line, confidence=1.0, is_low_conf=False)
                for line in raw_lines
            ]
            results.append(
                LoadedPage(
                    page_number=page_idx,
                    text=native_text,
                    lines=page_lines,
                    source="text",
                    is_ocr=False,
                    avg_confidence=1.0,
                    has_low_conf=False,
                )
            )
        else:
            # Scanned page: OCR pathway
            if ocr_mode == "text" and not has_text_layer:
                # Text-only mode requested on scanned page: empty text
                results.append(
                    LoadedPage(
                        page_number=page_idx,
                        text="",
                        lines=[],
                        source="text",
                        is_ocr=False,
                        avg_confidence=1.0,
                        has_low_conf=False,
                    )
                )
                continue

            engine = ocr_engine or DefaultIndraOCREngine()
            ocr_text, ocr_lines = engine.convert_page(str(path_obj), page_idx)

            # Evaluate per-line confidence
            for ln in ocr_lines:
                if ln.confidence < min_line_conf:
                    ln.is_low_conf = True

            has_low_conf = any(ln.is_low_conf for ln in ocr_lines)
            if ocr_lines:
                avg_conf = sum(ln.confidence for ln in ocr_lines) / len(ocr_lines)
            else:
                avg_conf = 1.0 if not has_low_conf else min_line_conf

            results.append(
                LoadedPage(
                    page_number=page_idx,
                    text=ocr_text,
                    lines=ocr_lines,
                    source="ocr",
                    is_ocr=True,
                    avg_confidence=avg_conf,
                    has_low_conf=has_low_conf,
                )
            )

    return results
