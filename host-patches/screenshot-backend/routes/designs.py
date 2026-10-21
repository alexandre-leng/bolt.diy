"""Design-mockup generation over the ChatGPT/Codex OAuth session.

Why this lives in the backend and not in the Bolt Worker: a Cloudflare Worker has
NO filesystem, so `node:fs` inside workerd answers `existsSync() === false` and
`readFileSync()` throws "no such file or directory" even when the file is mounted
into the container. Measured on this host: the same path reads fine with Node and
fails inside workerd. The service, which runs on Node, owns `auth.json`, refreshes
the rotating token under a lock, and exposes the images to the Worker over HTTP.

The endpoint is internal only: it is served on 127.0.0.1 and must be reached
through the host gateway, never from the internet. It also requires the internal
token, so a stray request from another local process cannot spend subscription
credits.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, model_validator

from image_generation.codex_oauth import (
    CodexImageError,
    generate_image_data_url_sync,
    is_available,
)
from oauth.chatgpt import OAuthUnavailableError, access_token

router = APIRouter()

#: Shared secret with the Bolt Worker. Without it, any local process could
#: spend the account's image credits by hitting this loopback port.
INTERNAL_TOKEN = os.environ.get("DESIGN_API_INTERNAL_TOKEN", "")

MAX_COUNT = 4

BASE_INSTRUCTION = (
    "A flat UI mockup of a web page, straight-on view, no perspective, no device frame, "
    "crisp vector shapes, readable placeholder text, white background, web design wireframe style."
)

DIRECTIONS = (
    "a clean, minimal, modern SaaS layout with generous whitespace and a single accent colour",
    "a bold, high-contrast editorial layout with strong typography and large imagery",
    "a warm, friendly product layout with rounded cards, soft shadows and an illustration",
    "a dense, data-oriented dashboard layout with cards, charts and a sidebar",
)


class DesignRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=1500)
    count: int = Field(default=3, ge=1, le=MAX_COUNT)
    directionIndex: int = Field(default=0, strict=True, ge=0, le=MAX_COUNT - 1)

    @model_validator(mode="after")
    def validate_direction_range(self) -> DesignRequest:
        if self.directionIndex + self.count > MAX_COUNT:
            raise ValueError("count + directionIndex must be <= 4")
        return self


class DesignResponse(BaseModel):
    images: List[str]
    model: str


def _require_token(token: Optional[str]) -> None:
    if not INTERNAL_TOKEN:
        raise HTTPException(
            status_code=503,
            detail="DESIGN_API_INTERNAL_TOKEN is not configured on the service.",
        )
    if token != INTERNAL_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid internal token.")


@router.post("/api/internal/designs", response_model=DesignResponse)
def generate_designs(
    body: DesignRequest,
    x_internal_token: Optional[str] = Header(default=None),
) -> DesignResponse:
    _require_token(x_internal_token)

    if not is_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "No ChatGPT OAuth session on the service: run "
                "`codex login --device-auth` and copy auth.json."
            ),
        )

    try:
        token = access_token()
    except OAuthUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    images: List[str] = []
    for index in range(body.count):
        direction = DIRECTIONS[(body.directionIndex + index) % len(DIRECTIONS)]
        prompt = f"{BASE_INSTRUCTION} Content: {body.prompt.strip()} Style direction: {direction}."
        try:
            images.append(generate_image_data_url_sync(prompt, token=token))
        except (CodexImageError, OAuthUnavailableError) as exc:
            raise HTTPException(status_code=502, detail=f"Image generation failed: {exc}") from exc

    return DesignResponse(images=images, model="gpt-image-1")


@router.get("/api/internal/designs/health")
def designs_health() -> Dict[str, Any]:
    """Non-secret status, so the Worker can say WHY mockups are unavailable."""
    return {
        "oauth_available": is_available(),
        "token_configured": bool(INTERNAL_TOKEN),
    }
