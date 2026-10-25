"""YouTube video tutorial discovery adapter.

Strict requirements:
1. Replaceable discovery adapter: Official YouTube Data API v3, direct search fallback, mock.
2. Verified genuine metadata: video ID, title, channel name, thumbnail, duration.
3. Official embeddable URL uses privacy-enhanced youtube-nocookie.com.
4. If no YouTube API key is configured, provide a genuine direct search link and configuration guide;
   NEVER invent fake video IDs or channels.
"""

from __future__ import annotations

import logging
import re
from abc import ABC, abstractmethod

import httpx
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)


class YouTubeResource(BaseModel):
    """YouTube educational tutorial video metadata."""

    video_id: str = Field(..., description="YouTube video ID (11 characters)")
    title: str = Field(..., description="Video title")
    channel_name: str = Field(..., description="Channel name / creator")
    thumbnail_url: str = Field(..., description="URL to video thumbnail")
    duration: str = Field(default="Tutorial", description="Formatted duration or label")
    video_url: str = Field(..., description="Direct YouTube link")
    embed_url: str = Field(..., description="Privacy-enhanced embed link")
    relevance_reason: str = Field(..., description="Why this video is relevant to the lesson")


class YouTubeDiscoveryProvider(ABC):
    """Abstract base class for YouTube discovery."""

    @abstractmethod
    async def discover_tutorials(
        self,
        topic: str,
        learning_objectives: list[str],
        limit: int = 3,
    ) -> list[YouTubeResource]:
        """Discover genuine video tutorials for the topic."""
        pass


class MockYouTubeProvider(YouTubeDiscoveryProvider):
    """Deterministic mock YouTube discovery provider for unit tests."""

    async def discover_tutorials(
        self,
        topic: str,
        learning_objectives: list[str],
        limit: int = 3,
    ) -> list[YouTubeResource]:
        # Realistic fixtures for well-known verified educational videos
        return [
            YouTubeResource(
                video_id="kqtD5dpn9C8",
                title=f"{topic} Explained for Beginners",
                channel_name="FreeCodeCamp",
                thumbnail_url="https://img.youtube.com/vi/kqtD5dpn9C8/hqdefault.jpg",
                duration="15 mins",
                video_url="https://www.youtube.com/watch?v=kqtD5dpn9C8",
                embed_url="https://www.youtube-nocookie.com/embed/kqtD5dpn9C8",
                relevance_reason=f"Step-by-step beginner tutorial breaking down foundational concepts of {topic}.",
            ),
            YouTubeResource(
                video_id="rfscVS0vtbw",
                title=f"{topic} Full Course & Practical Walkthrough",
                channel_name="CS Dojo",
                thumbnail_url="https://img.youtube.com/vi/rfscVS0vtbw/hqdefault.jpg",
                duration="22 mins",
                video_url="https://www.youtube.com/watch?v=rfscVS0vtbw",
                embed_url="https://www.youtube-nocookie.com/embed/rfscVS0vtbw",
                relevance_reason="Covers practical implementations and code examples aligned with lesson objectives.",
            ),
        ][:limit]


class OfficialYouTubeAPIProvider(YouTubeDiscoveryProvider):
    """Queries official Google YouTube Data API v3."""

    def __init__(self, api_key: str):
        self.api_key = api_key

    def _parse_iso_duration(self, iso_duration: str) -> str:
        """Converts ISO 8601 duration (e.g., PT15M33S) into human readable '15m 33s'."""
        match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso_duration)
        if not match:
            return "Tutorial"
        hours, minutes, seconds = match.groups()
        parts = []
        if hours:
            parts.append(f"{hours}h")
        if minutes:
            parts.append(f"{minutes}m")
        if seconds and not hours:
            parts.append(f"{seconds}s")
        return " ".join(parts) if parts else "Tutorial"

    async def discover_tutorials(
        self,
        topic: str,
        learning_objectives: list[str],
        limit: int = 3,
    ) -> list[YouTubeResource]:
        if not self.api_key:
            return []

        search_query = f"{topic} tutorial explanation lesson"
        obj = learning_objectives[0] if learning_objectives else topic

        try:
            headers = {"X-Goog-Api-Key": self.api_key}
            async with httpx.AsyncClient(timeout=8.0) as client:
                # 1. Search videos (API key passed securely in header, not in query string URL)
                res = await client.get(
                    "https://www.googleapis.com/youtube/v3/search",
                    headers=headers,
                    params={
                        "q": search_query,
                        "part": "snippet",
                        "type": "video",
                        "maxResults": limit,
                        "videoEmbeddable": "true",
                        "relevanceLanguage": "en",
                        "safeSearch": "strict",
                    },
                )
                if res.status_code != 200:
                    logger.warning("YouTube search API failed with status %d", res.status_code)
                    return []

                search_data = res.json()
                items = search_data.get("items", [])
                if not items:
                    return []

                video_ids = [
                    item["id"]["videoId"]
                    for item in items
                    if "id" in item and "videoId" in item["id"]
                ]
                if not video_ids:
                    return []

                # 2. Get video details (duration)
                details_res = await client.get(
                    "https://www.googleapis.com/youtube/v3/videos",
                    headers=headers,
                    params={
                        "id": ",".join(video_ids),
                        "part": "snippet,contentDetails",
                    },
                )
                durations: dict[str, str] = {}
                if details_res.status_code == 200:
                    details_data = details_res.json()
                    for v in details_data.get("items", []):
                        vid = v.get("id")
                        content_details = v.get("contentDetails", {})
                        raw_duration = content_details.get("duration", "")
                        durations[vid] = self._parse_iso_duration(raw_duration)

                resources: list[YouTubeResource] = []
                for item in items:
                    vid = item["id"]["videoId"]
                    snippet = item.get("snippet", {})
                    title = snippet.get("title", f"{topic} Tutorial")
                    channel = snippet.get("channelTitle", "YouTube Educational")
                    thumbnails = snippet.get("thumbnails", {})
                    thumb_url = (
                        thumbnails.get("high", {}).get("url")
                        or thumbnails.get("medium", {}).get("url")
                        or f"https://img.youtube.com/vi/{vid}/hqdefault.jpg"
                    )
                    duration_str = durations.get(vid, "Tutorial")

                    resources.append(
                        YouTubeResource(
                            video_id=vid,
                            title=title,
                            channel_name=channel,
                            thumbnail_url=thumb_url,
                            duration=duration_str,
                            video_url=f"https://www.youtube.com/watch?v={vid}",
                            embed_url=f"https://www.youtube-nocookie.com/embed/{vid}",
                            relevance_reason=f"Curated tutorial directly covering '{obj}'.",
                        )
                    )

                return resources
        except Exception as e:
            logger.warning("YouTube discovery failed: %s", e)
            return []


class DirectSearchFallbackProvider(YouTubeDiscoveryProvider):
    """When no API key is provided, provides structured direct search access without inventing fake IDs."""

    async def discover_tutorials(
        self,
        topic: str,
        learning_objectives: list[str],
        limit: int = 3,
    ) -> list[YouTubeResource]:
        # Return empty list so the frontend displays the authentic direct YouTube search CTA and configuration guide
        return []


def get_youtube_provider() -> YouTubeDiscoveryProvider:
    """Factory creating configured YouTubeDiscoveryProvider."""
    if settings.YOUTUBE_API_KEY:
        return OfficialYouTubeAPIProvider(api_key=settings.YOUTUBE_API_KEY)
    return DirectSearchFallbackProvider()
