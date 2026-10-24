"""Tests for Hugging Face LLM adapter in LLMGateway and RAG sources formatting."""

import pytest
from pydantic import BaseModel, Field

from app.ai.guardrails.output_guard import check_output_guardrails
from app.ai.harness.gateway import LLMGateway
from app.ai.harness.models import ChatMessage
from app.ai.harness.structured import StructuredCall, clean_json_text
from app.core.config import settings
from app.retrieval.search import SearchResult


class SampleTopicHierarchy(BaseModel):
    title: str = Field(description="Hierarchy title")
    topics: list[str] = Field(description="Extracted topic list")


def test_hf_gateway_endpoint_and_key_resolution():
    """Verify Hugging Face endpoint resolution and token configuration."""
    original_token = settings.HF_TOKEN
    original_chain = settings.LLM_CHAIN
    original_provider = settings.LLM_PROVIDER
    try:
        settings.HF_TOKEN = "hf_test_secret_token_123"
        settings.LLM_PROVIDER = "huggingface"
        settings.LLM_CHAIN = "huggingface,groq"

        gw = LLMGateway()
        assert gw.chain[0] == "huggingface"
        assert gw.get_api_key("huggingface") == "hf_test_secret_token_123"
        assert "huggingface" in gw._provider_base_urls
        assert "huggingface.co" in gw._provider_base_urls["huggingface"]

        slug = gw.resolve_model_slug("huggingface", "smart")
        assert "Llama" in slug or "llama" in slug
    finally:
        settings.HF_TOKEN = original_token
        settings.LLM_CHAIN = original_chain
        settings.LLM_PROVIDER = original_provider


def test_clean_json_text_with_thinking_and_markdown():
    """Verify clean_json_text strips thinking tags and extracts JSON objects."""
    raw_hf_output = (
        "<think>Analyzing chunks for topics...</think>\n"
        "Here is the requested JSON:\n"
        "```json\n"
        '{"title": "Operating Systems", "topics": ["Processes", "Memory Management"]}\n'
        "```\n"
        "Let me know if you need changes!"
    )
    cleaned = clean_json_text(raw_hf_output)
    assert cleaned.startswith("{")
    assert cleaned.endswith("}")
    assert "<think>" not in cleaned


@pytest.mark.asyncio
async def test_hf_structured_call_validation():
    """Verify StructuredCall validates JSON models with custom mock caller."""
    raw_response_text = (
        '{"title": "Linear Algebra", "topics": ["Matrices", "Eigenvalues"]}'
    )

    async def mock_caller(req, provider, model):
        from app.ai.harness.models import LLMResponse
        return LLMResponse(
            content=raw_response_text,
            provider="huggingface",
            model="meta-llama/Llama-3.2-3B-Instruct",
            role="fast",
            tokens_in=25,
            tokens_out=20,
            latency_ms=15.0,
        )

    gw = LLMGateway(caller=mock_caller)
    structured_call = StructuredCall(gateway=gw)

    messages = [ChatMessage(role="user", content="Extract syllabus hierarchy")]
    result = await structured_call.execute(
        schema=SampleTopicHierarchy,
        messages=messages,
    )

    assert isinstance(result, SampleTopicHierarchy)
    assert result.title == "Linear Algebra"
    assert "Eigenvalues" in result.topics


def test_rag_tutor_sources_section_formatting():
    """Verify check_output_guardrails appends a separate Sources section at the end."""
    mock_chunks = [
        SearchResult(chunk_id=1, document_id=1, course_id=1, user_id=1, page=2, text="Pipelining hazard", score=0.9),
        SearchResult(chunk_id=2, document_id=1, course_id=1, user_id=1, page=4, text="Branch prediction", score=0.85),
    ]

    raw_tutor_answer = (
        "Structural hazards happen when resources are busy [doc p.2]. "
        "Branch predictors mitigate control hazards [doc p.4]."
    )

    guard_res = check_output_guardrails(raw_tutor_answer, mock_chunks)
    assert guard_res.is_grounded is True
    assert "[doc p.2]" in guard_res.citations
    assert "[doc p.4]" in guard_res.citations

    # Verify dedicated Sources section
    assert "**Sources:**" in guard_res.clean_reply
    assert "- [doc p.2]" in guard_res.clean_reply
    assert "- [doc p.4]" in guard_res.clean_reply
