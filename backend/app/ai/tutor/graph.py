"""LangGraph pipeline for the grounded RAG tutor with layered guardrails.

Architecture:
START -> guard_in -> [conditional: blocked/distress -> END]
                  -> tutor -> guard_out -> END

Security & Grounding Guarantees:
1. Fixed deterministic pipeline (no autonomous tool selection or write tools).
2. Uploaded documents wrapped in untrusted data delimiters.
3. Chunks with injection_flag are explicitly labelled untrusted="true".
4. If retrieval is insufficient, returns fixed refusal with 0 MODEL_SMART calls.
5. All [doc p.N] citations must map to retrieved source chunks; ungrounded answers
   fall back to a safe "could not verify" message.
6. Guardrail events recorded to DB with layer, rule, action — NO message/document text.
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph
from sqlalchemy.orm import Session

from app.ai.embedding.embedder import get_embedder
from app.ai.guardrails.input_guard import (
    GuardrailAuditRecord,
    check_input_guardrails,
)
from app.ai.guardrails.output_guard import check_output_guardrails
from app.ai.harness.gateway import LLMGateway
from app.buddy.tone import ToneContext, select_tone
from app.db.models import GuardrailEvent
from app.persona.prompt_builder import build_tutor_system_prompt
from app.retrieval.search import SearchResult, hybrid_search
from app.retrieval.sufficiency import check_sufficiency

logger = logging.getLogger(__name__)

INSUFFICIENT_REFUSAL = (
    "The uploaded materials do not cover this topic. "
    "Would you like me to search other documents or answer from general knowledge?"
)


class TutorState(TypedDict, total=False):
    """Execution state flowing through the tutor graph."""

    db: Session
    gateway: LLMGateway
    user_id: int
    course_id: int
    message: str
    tone_context: ToneContext

    # Intermediate / Output fields
    is_blocked: bool
    is_sufficient: bool
    tone: str
    retrieved_chunks: list[SearchResult]
    raw_response: str
    final_reply: str
    citations: list[str]
    audit_records: list[GuardrailAuditRecord]


def guard_in_node(state: TutorState) -> dict[str, Any]:
    """Execute input guardrails: length check, wellbeing distress, injection scan."""
    message = state.get("message", "")
    guard_result = check_input_guardrails(message)

    records: list[GuardrailAuditRecord] = list(state.get("audit_records", []))
    records.extend(guard_result.audit_records)

    if guard_result.is_blocked:
        return {
            "is_blocked": True,
            "final_reply": guard_result.response_override or "",
            "citations": [],
            "is_sufficient": False,
            "audit_records": records,
        }

    return {
        "is_blocked": False,
        "audit_records": records,
    }


def should_continue_to_tutor(state: TutorState) -> str:
    """Routing condition after guard_in."""
    if state.get("is_blocked", False):
        return END
    return "tutor"


async def tutor_node(state: TutorState) -> dict[str, Any]:
    """Retrieval, sufficiency gating, and grounded answer generation."""
    db: Session = state["db"]
    gateway: LLMGateway = state.get("gateway") or LLMGateway()
    user_id = state["user_id"]
    course_id = state["course_id"]
    message = state["message"]
    records: list[GuardrailAuditRecord] = list(state.get("audit_records", []))

    # 1. Scoped hybrid retrieval
    embedder = get_embedder()
    vectors = await embedder.embed_texts([message])
    q_vec = vectors[0] if vectors else [0.0] * 1024

    results = hybrid_search(
        query_text=message,
        query_vector=q_vec,
        course_id=course_id,
        user_id=user_id,
        db=db,
        limit=5,
    )
    sufficiency = check_sufficiency(results)

    # 2. If insufficient, attempt 1 query rewrite with fast model
    if not sufficiency.is_sufficient:
        try:
            rewrite_prompt = (
                f"Rewrite this student question into 2-4 keywords for textbook index search. "
                f"Question: {message}\nKeywords:"
            )
            rewrite_res = await gateway.chat_completion(
                messages=[{"role": "user", "content": rewrite_prompt}],
                role="fast",
                temperature=0.0,
                max_tokens=20,
            )
            rewritten_query = rewrite_res.text.strip()
            if rewritten_query:
                vectors_r2 = await embedder.embed_texts([rewritten_query])
                q_vec_r2 = vectors_r2[0] if vectors_r2 else q_vec
                results_round2 = hybrid_search(
                    query_text=rewritten_query,
                    query_vector=q_vec_r2,
                    course_id=course_id,
                    user_id=user_id,
                    db=db,
                    limit=5,
                )
                sufficiency_round2 = check_sufficiency(results_round2)
                if sufficiency_round2.is_sufficient:
                    results = results_round2
                    sufficiency = sufficiency_round2
        except Exception as e:
            logger.debug("Query rewrite fallback skipped: %s", e)

    # 3. Gating check: fail closed without generating hallucinations
    if not sufficiency.is_sufficient:
        records.append(
            GuardrailAuditRecord(layer="retrieval", rule="sufficiency_gate", action="refusal")
        )
        return {
            "is_sufficient": False,
            "final_reply": INSUFFICIENT_REFUSAL,
            "citations": [],
            "retrieved_chunks": results,
            "audit_records": records,
        }

    # 4. Format chunks with untrusted data delimiters
    formatted_chunks: list[str] = ["<study_material>"]
    for chunk in results:
        untrusted_str = "true" if chunk.injection_flag else "false"
        formatted_chunks.append(
            f'<document_chunk id="{chunk.chunk_id}" page="{chunk.page}" '
            f'heading="{chunk.heading_path or ""}" untrusted="{untrusted_str}">\n'
            f"{chunk.text}\n"
            f"</document_chunk>"
        )
    formatted_chunks.append("</study_material>")
    context_block = "\n".join(formatted_chunks)

    # 5. Tone selection and prompt building
    tone_ctx = state.get("tone_context") or ToneContext()
    chosen_tone = select_tone(tone_ctx)
    system_prompt = build_tutor_system_prompt(
        tone=chosen_tone,
        english_only=(tone_ctx.user_tone_setting == "english_only"),
    )

    user_prompt = (
        f"{context_block}\n\n"
        f"Student question: {message}\n\n"
        f"Answer the question thoroughly and concisely using ONLY the study materials above. "
        f"Cite every factual claim using [doc p.N]."
    )

    # 6. Call smart model
    llm_res = await gateway.chat_completion(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        role="smart",
        temperature=0.2,
    )

    return {
        "is_sufficient": True,
        "tone": chosen_tone,
        "retrieved_chunks": results,
        "raw_response": llm_res.text,
        "audit_records": records,
    }


def guard_out_node(state: TutorState) -> dict[str, Any]:
    """Validate citations and sanitize model output."""
    records: list[GuardrailAuditRecord] = list(state.get("audit_records", []))
    db: Session = state["db"]
    user_id = state["user_id"]

    # If already set (refusal or blocked), keep final_reply
    if "final_reply" in state:
        final_reply = state["final_reply"]
        citations = state.get("citations", [])
    else:
        raw_reply = state.get("raw_response", "")
        chunks = state.get("retrieved_chunks", [])
        guard_res = check_output_guardrails(raw_reply, chunks)
        final_reply = guard_res.clean_reply
        citations = guard_res.citations
        records.extend(guard_res.audit_records)

    # Persist all audit events without text
    for r in records:
        event = GuardrailEvent(
            user_id=user_id,
            layer=r.layer,
            rule=r.rule,
            action=r.action,
        )
        db.add(event)
    try:
        db.commit()
    except Exception as e:
        logger.warning("Failed to record guardrail event: %s", e)
        db.rollback()

    return {
        "final_reply": final_reply,
        "citations": citations,
        "audit_records": records,
    }


def build_tutor_graph():
    """Build and compile the LangGraph workflow."""
    workflow = StateGraph(TutorState)

    workflow.add_node("guard_in", guard_in_node)
    workflow.add_node("tutor", tutor_node)
    workflow.add_node("guard_out", guard_out_node)

    workflow.add_edge(START, "guard_in")
    workflow.add_conditional_edges(
        "guard_in",
        should_continue_to_tutor,
        {"tutor": "tutor", END: END},
    )
    workflow.add_edge("tutor", "guard_out")
    workflow.add_edge("guard_out", END)

    return workflow.compile()


# Precompiled application
tutor_app = build_tutor_graph()
