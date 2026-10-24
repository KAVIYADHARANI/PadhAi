"""Guardrail hook registry and interfaces for AI Agent Harness.

Provides explicit pre-call and post-call hooks that every LLM call passes through.
SECURITY RULE: Guardrail events written to DB carry layer, rule, action only;
never raw message text or document text.
"""

import logging
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.ai.harness.exceptions import GuardrailViolationError
from app.ai.harness.models import LLMRequest, LLMResponse
from app.db.models import GuardrailEvent

logger = logging.getLogger("app.guardrails")

PreCallHook = Callable[[LLMRequest], LLMRequest]
PostCallHook = Callable[[LLMResponse, LLMRequest], LLMResponse]


class GuardrailHooks:
    """Registry of pre-call and post-call guardrail hooks."""

    def __init__(self):
        self._pre_hooks: list[tuple[str, PreCallHook]] = []
        self._post_hooks: list[tuple[str, PostCallHook]] = []

    def register_pre_call_hook(self, name: str, hook: PreCallHook) -> None:
        """Register a hook that runs before sending the request to the LLM."""
        self._pre_hooks.append((name, hook))

    def register_post_call_hook(self, name: str, hook: PostCallHook) -> None:
        """Register a hook that runs on the LLM response before returning to caller."""
        self._post_hooks.append((name, hook))

    def clear(self) -> None:
        """Clear all registered hooks."""
        self._pre_hooks.clear()
        self._post_hooks.clear()

    def run_pre_call(
        self,
        request: LLMRequest,
        db: Session | None = None,
    ) -> LLMRequest:
        """Execute all registered pre-call hooks sequentially.

        Fails safely by recording guardrail event and raising GuardrailViolationError.
        """
        current_request = request
        for name, hook in self._pre_hooks:
            try:
                current_request = hook(current_request)
            except GuardrailViolationError as exc:
                self._record_violation(
                    db=db,
                    user_id=request.user_id,
                    layer=exc.layer or "pre_call",
                    rule=exc.rule or name,
                    action=exc.action or "block",
                )
                raise
            except Exception as e:
                # Any unhandled hook failure fails safe/closed
                self._record_violation(
                    db=db,
                    user_id=request.user_id,
                    layer="pre_call",
                    rule=name,
                    action="error_block",
                )
                raise GuardrailViolationError(
                    message=f"Pre-call guardrail hook '{name}' failed: {e!s}",
                    layer="pre_call",
                    rule=name,
                    action="block",
                ) from e

        return current_request

    def run_post_call(
        self,
        response: LLMResponse,
        request: LLMRequest,
        db: Session | None = None,
    ) -> LLMResponse:
        """Execute all registered post-call hooks sequentially.

        Fails safely by recording guardrail event and raising GuardrailViolationError.
        """
        current_response = response
        for name, hook in self._post_hooks:
            try:
                current_response = hook(current_response, request)
            except GuardrailViolationError as exc:
                self._record_violation(
                    db=db,
                    user_id=request.user_id,
                    layer=exc.layer or "post_call",
                    rule=exc.rule or name,
                    action=exc.action or "block",
                )
                raise
            except Exception as e:
                self._record_violation(
                    db=db,
                    user_id=request.user_id,
                    layer="post_call",
                    rule=name,
                    action="error_block",
                )
                raise GuardrailViolationError(
                    message=f"Post-call guardrail hook '{name}' failed: {e!s}",
                    layer="post_call",
                    rule=name,
                    action="block",
                ) from e

        return current_response

    @staticmethod
    def _record_violation(
        db: Session | None,
        user_id: int | None,
        layer: str,
        rule: str,
        action: str,
    ) -> None:
        """Log event and persist to guardrail_events table without text."""
        logger.warning(
            "Guardrail event: user_id=%s layer=%s rule=%s action=%s",
            user_id,
            layer,
            rule,
            action,
        )
        if db is not None and user_id is not None:
            try:
                event = GuardrailEvent(
                    user_id=user_id,
                    layer=layer[:100],
                    rule=rule[:100],
                    action=action[:100],
                )
                db.add(event)
                db.commit()
            except Exception as db_err:
                logger.error("Failed to persist guardrail event to DB: %s", db_err)
