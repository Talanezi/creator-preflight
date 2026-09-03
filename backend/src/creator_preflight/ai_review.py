"""Optional Gemini video-review boundary and validated observation contracts."""

from __future__ import annotations

import os
import time
from enum import Enum
from pathlib import Path
from typing import Callable, Mapping, Protocol

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from creator_preflight.config import AIReviewConfig


class AIObservationType(str, Enum):
    """Objective observation kinds allowed across the provider trust boundary."""

    VISIBLE_TEXT = "visible_text"
    VISUAL_CHANGE = "visual_change"
    PERSON_APPEARS = "person_appears"
    AUDIBLE_SPEECH = "audible_speech"
    AUDIBLE_TONE = "audible_tone"


class AIObservation(BaseModel):
    """One bounded, evidence-oriented observation returned by an AI provider."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    observation_type: AIObservationType
    summary: str = Field(min_length=1, max_length=160)
    explanation: str = Field(min_length=1, max_length=1000)
    evidence: list[str] = Field(default_factory=list, max_length=5)
    start_seconds: float | None = Field(
        default=None, ge=0, allow_inf_nan=False
    )
    end_seconds: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)
    suggestion: str | None = Field(default=None, max_length=500)

    @field_validator("evidence")
    @classmethod
    def validate_evidence(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values]
        if any(not value or len(value) > 300 for value in cleaned):
            raise ValueError("evidence items must contain 1 to 300 characters")
        return cleaned

    @model_validator(mode="after")
    def validate_timestamp_range(self) -> "AIObservation":
        if self.end_seconds is not None and self.start_seconds is None:
            raise ValueError("end_seconds requires start_seconds")
        if (
            self.start_seconds is not None
            and self.end_seconds is not None
            and self.end_seconds < self.start_seconds
        ):
            raise ValueError("end_seconds cannot be earlier than start_seconds")
        return self


class AIObservationBatch(BaseModel):
    """Native structured-output envelope supplied to Gemini."""

    model_config = ConfigDict(extra="forbid")

    observations: list[AIObservation] = Field(default_factory=list, max_length=10)


class AIReviewResult(BaseModel):
    """Typed provider result plus non-secret lifecycle measurements."""

    model_config = ConfigDict(extra="forbid")

    provider: str
    model: str
    observations: list[AIObservation]
    upload_seconds: float = Field(ge=0, allow_inf_nan=False)
    processing_seconds: float = Field(ge=0, allow_inf_nan=False)
    generation_seconds: float = Field(ge=0, allow_inf_nan=False)
    total_seconds: float = Field(ge=0, allow_inf_nan=False)
    cleanup_succeeded: bool


class VideoReviewer(Protocol):
    def review(
        self,
        media_path: str | Path,
        media_duration_seconds: float | None,
        config: AIReviewConfig,
    ) -> AIReviewResult: ...


class AIReviewError(Exception):
    """Safe application-level failure from the optional provider boundary."""

    def __init__(self, code: str, message: str, *, unavailable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.unavailable = unavailable


ClientFactory = Callable[[str, int], object]


class GeminiVideoReviewer:
    """Upload once, request native structured output, validate, then delete."""

    def __init__(
        self,
        *,
        client_factory: ClientFactory | None = None,
        environ: Mapping[str, str] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self._client_factory = client_factory
        self._environ = environ if environ is not None else os.environ
        self._sleep = sleep
        self._clock = clock

    def review(
        self,
        media_path: str | Path,
        media_duration_seconds: float | None,
        config: AIReviewConfig,
    ) -> AIReviewResult:
        api_key = self._environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            raise AIReviewError(
                "ai_api_key_missing",
                "Gemini review is enabled, but GEMINI_API_KEY is not configured on the server.",
                unavailable=True,
            )

        client = self._create_client(api_key, config.timeout_seconds)
        started_at = self._clock()
        remote_file = None
        cleanup_succeeded = False
        stage = "upload"
        try:
            upload_started = self._clock()
            remote_file = client.files.upload(file=str(media_path))
            upload_seconds = self._clock() - upload_started

            stage = "processing"
            processing_started = self._clock()
            remote_file = self._wait_until_active(
                client, remote_file, config.timeout_seconds
            )
            processing_seconds = self._clock() - processing_started

            file_uri = getattr(remote_file, "uri", None)
            mime_type = getattr(remote_file, "mime_type", None)
            if not file_uri or not mime_type:
                raise AIReviewError(
                    "ai_provider_response_invalid",
                    "Gemini did not return a usable uploaded-video reference.",
                )

            stage = "generation"
            generation_started = self._clock()
            response = client.models.generate_content(
                model=config.model,
                contents=[
                    remote_file,
                    _smoke_prompt(config.maximum_observations),
                ],
                config={
                    "response_mime_type": "application/json",
                    "response_json_schema": AIObservationBatch.model_json_schema(),
                    "thinking_config": {"thinking_level": "LOW"},
                    "max_output_tokens": 2048,
                    "automatic_function_calling": {"disable": True},
                    "http_options": {
                        "timeout": max(1, round(config.timeout_seconds * 1000))
                    },
                },
            )
            generation_seconds = self._clock() - generation_started
            batch = _validate_provider_output(
                getattr(response, "text", None),
                media_duration_seconds=media_duration_seconds,
                config=config,
            )
        except AIReviewError:
            raise
        except Exception as exc:
            if _looks_like_timeout(exc):
                code = "ai_provider_timeout"
                message = f"Gemini {stage} timed out."
            else:
                code = f"ai_{stage}_failed"
                message = f"Gemini {stage} could not be completed."
            raise AIReviewError(code, message) from exc
        finally:
            if remote_file is not None and getattr(remote_file, "name", None):
                try:
                    client.files.delete(name=remote_file.name)
                    cleanup_succeeded = True
                except Exception:
                    cleanup_succeeded = False
            close = getattr(client, "close", None)
            if callable(close):
                try:
                    close()
                except Exception:
                    pass

        return AIReviewResult(
            provider=config.provider,
            model=config.model,
            observations=batch.observations,
            upload_seconds=upload_seconds,
            processing_seconds=processing_seconds,
            generation_seconds=generation_seconds,
            total_seconds=self._clock() - started_at,
            cleanup_succeeded=cleanup_succeeded,
        )

    def _create_client(self, api_key: str, timeout_seconds: float):
        factory = self._client_factory
        if factory is None:
            try:
                genai = _load_google_genai()
            except ImportError as exc:
                raise AIReviewError(
                    "ai_dependency_unavailable",
                    "Gemini review requires the optional google-genai dependency.",
                    unavailable=True,
                ) from exc

            factory = lambda key, timeout_ms: genai.Client(
                api_key=key, http_options={"timeout": timeout_ms}
            )
        try:
            return factory(api_key, max(1, round(timeout_seconds * 1000)))
        except AIReviewError:
            raise
        except Exception as exc:
            raise AIReviewError(
                "ai_client_initialization_failed",
                "Gemini review could not initialize the provider client.",
                unavailable=True,
            ) from exc

    def _wait_until_active(self, client, remote_file, timeout_seconds: float):
        deadline = self._clock() + timeout_seconds
        while True:
            state = getattr(getattr(remote_file, "state", None), "name", None)
            if state == "ACTIVE":
                return remote_file
            if state == "FAILED":
                raise AIReviewError(
                    "ai_file_processing_failed",
                    "Gemini could not process the uploaded video.",
                )
            remaining = deadline - self._clock()
            if remaining <= 0:
                raise AIReviewError(
                    "ai_file_processing_timeout",
                    "Gemini did not finish processing the uploaded video before the timeout.",
                )
            self._sleep(min(1.0, remaining))
            remote_file = client.files.get(name=remote_file.name)


def _smoke_prompt(maximum_observations: int) -> str:
    return (
        "Inspect the video itself and report at most "
        f"{maximum_observations} objective, directly observable events. Focus on visible "
        "on-screen text, clear visual state changes, a person appearing, clearly audible "
        "speech, or a clearly audible tone. Use seconds from the start of the video. "
        "Do not infer content from the filename and do not offer general editorial advice."
    )


def _validate_provider_output(
    output_text: object,
    *,
    media_duration_seconds: float | None,
    config: AIReviewConfig,
) -> AIObservationBatch:
    if not isinstance(output_text, str) or not output_text.strip():
        raise AIReviewError(
            "ai_provider_response_invalid",
            "Gemini returned no structured observations.",
        )
    try:
        batch = AIObservationBatch.model_validate_json(output_text)
    except ValidationError as exc:
        raise AIReviewError(
            "ai_provider_response_invalid",
            "Gemini returned observations that did not match the required schema.",
        ) from exc
    if len(batch.observations) > config.maximum_observations:
        raise AIReviewError(
            "ai_provider_response_invalid",
            "Gemini returned more observations than the configured limit.",
        )
    if media_duration_seconds is not None:
        maximum_timestamp = (
            media_duration_seconds + config.timestamp_tolerance_seconds
        )
        for observation in batch.observations:
            if (
                observation.start_seconds is not None
                and observation.start_seconds > maximum_timestamp
            ) or (
                observation.end_seconds is not None
                and observation.end_seconds > maximum_timestamp
            ):
                raise AIReviewError(
                    "ai_observation_timestamp_invalid",
                    "Gemini returned an observation outside the media duration.",
                )
    return batch


def _looks_like_timeout(exc: Exception) -> bool:
    return "timeout" in type(exc).__name__.lower()


def _load_google_genai():
    from google import genai

    return genai
