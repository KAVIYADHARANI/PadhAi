"""Exceptions for the AI Agent Harness.

All harness error types inherit from HarnessError.
"""


class HarnessError(Exception):
    """Base exception for all agent harness errors."""

    def __init__(self, message: str, error_code: str = "HARNESS_ERROR"):
        super().__init__(message)
        self.message = message
        self.error_code = error_code


class ProviderUnavailableError(HarnessError):
    """Raised when an LLM provider fails or all providers in the failover chain are exhausted."""

    def __init__(self, message: str = "All LLM providers in the failover chain are unavailable"):
        super().__init__(message, error_code="PROVIDER_UNAVAILABLE")


class RateLimitExceededError(HarnessError):
    """Raised when a provider's rate limit (RPM/TPM) is exceeded."""

    def __init__(self, message: str = "Rate limit exceeded for LLM provider"):
        super().__init__(message, error_code="RATE_LIMIT_EXCEEDED")


class CircuitBreakerOpenError(HarnessError):
    """Raised when attempting to call a provider whose circuit breaker is in OPEN state."""

    def __init__(self, message: str = "Circuit breaker is open for LLM provider"):
        super().__init__(message, error_code="CIRCUIT_BREAKER_OPEN")


class TimeoutError(HarnessError):
    """Raised when an LLM request exceeds the configured timeout."""

    def __init__(self, message: str = "LLM request timed out"):
        super().__init__(message, error_code="REQUEST_TIMEOUT")


class StructuredOutputError(HarnessError):
    """Raised when the model fails to produce valid structured JSON output matching schema after max retries."""

    def __init__(self, message: str = "Failed to produce valid structured output"):
        super().__init__(message, error_code="STRUCTURED_OUTPUT_INVALID")


class BudgetExhaustedError(HarnessError):
    """Raised when a request cap or daily user quota is exhausted."""

    def __init__(self, message: str = "LLM usage budget or quota has been exhausted"):
        super().__init__(message, error_code="BUDGET_EXHAUSTED")


class DailyQuotaExhaustedError(BudgetExhaustedError):
    """Raised specifically when a user's daily quota of LLM calls is exhausted."""

    def __init__(self, message: str = "Daily LLM call quota has been exhausted"):
        super().__init__(message)
        self.error_code = "DAILY_QUOTA_EXHAUSTED"


class GuardrailViolationError(HarnessError):
    """Raised when a pre-call or post-call guardrail hook blocks a request/response."""

    def __init__(
        self,
        message: str = "Guardrail violation detected",
        layer: str = "unknown",
        rule: str = "unknown",
        action: str = "block",
    ):
        super().__init__(message, error_code="GUARDRAIL_VIOLATION")
        self.layer = layer
        self.rule = rule
        self.action = action


class AuthenticationError(HarnessError):
    """Raised when an API key is missing or invalid for an LLM provider."""

    def __init__(self, message: str = "Invalid or missing LLM provider API credentials"):
        super().__init__(message, error_code="AUTHENTICATION_ERROR")

