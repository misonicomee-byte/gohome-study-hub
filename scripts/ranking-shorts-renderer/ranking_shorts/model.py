"""Immutable renderer inputs and strict ranking-manifest validation."""

from __future__ import annotations

import calendar
import json
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

MOTIONS = frozenset({"cutout-zoom", "split-reveal", "letter-scatter"})
PLACEMENTS = frozenset({"hook", "chapter", "none"})
CHANNELS = frozenset({"youtube", "blog", "instagram"})

_MONTH = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_TIMESTAMP = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)"
    r"(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$"
)


def _required(mapping: Mapping[str, Any], key: str) -> Any:
    if key not in mapping:
        raise ValueError(f"manifest is missing {key}")
    return mapping[key]


def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")
    return value


def _calendar_date(value: Any, name: str) -> str:
    if not isinstance(value, str) or _DATE.fullmatch(value) is None:
        raise ValueError(f"{name} must be a real YYYY-MM-DD calendar date")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{name} must be a real YYYY-MM-DD calendar date") from None
    return value


def _timestamp(value: Any) -> str:
    if not isinstance(value, str) or _TIMESTAMP.fullmatch(value) is None:
        raise ValueError("generatedAt must be an ISO timestamp with a timezone")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("generatedAt must be a real ISO timestamp") from None
    if parsed.tzinfo is None:
        raise ValueError("generatedAt must include a timezone")
    return value


def _url(value: Any) -> str:
    value = _string(value, "item url")
    if any(character.isspace() for character in value):
        raise ValueError("item url must be a valid HTTP(S) URL")
    try:
        parsed = urlsplit(value)
        _ = parsed.port
    except ValueError:
        raise ValueError("item url must be a valid HTTP(S) URL") from None
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.netloc
        or not parsed.hostname
    ):
        raise ValueError("item url must be a valid HTTP(S) URL")
    return value


def _metric(value: Any, name: str) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise ValueError(f"{name} must be a finite number")
    return value


def _ranked_items(value: Any) -> list[Mapping[str, Any]]:
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError("manifest must contain exactly ranks 1, 2, 3")
    items: list[Mapping[str, Any]] = []
    ranks: list[int] = []
    for raw_item in value:
        if not isinstance(raw_item, Mapping):
            raise ValueError("manifest must contain exactly ranks 1, 2, 3")
        rank = raw_item.get("rank")
        if isinstance(rank, bool) or not isinstance(rank, int):
            raise ValueError("manifest must contain exactly ranks 1, 2, 3")
        items.append(raw_item)
        ranks.append(rank)
    if ranks != [1, 2, 3]:
        raise ValueError("manifest must contain exactly ranks 1, 2, 3")
    return items


@dataclass(frozen=True, slots=True)
class RankingItem:
    rank: int
    content_id: str
    title: str
    url: str
    published_at: str
    metric_value: int | float
    secondary_metric_value: int | float


@dataclass(frozen=True, slots=True)
class RankingManifest:
    schema_version: int
    channel: str
    month: str
    start_date: str
    end_date: str
    timezone: str
    ranking_metric: str
    ranking_label: str
    generated_at: str
    items: tuple[RankingItem, ...]
    ranking_mode: str | None = None

    @classmethod
    def from_path(cls, path: Path) -> RankingManifest:
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            raise ValueError("manifest must contain valid UTF-8 JSON") from None

        manifest = _mapping(raw, "manifest")
        raw_items = _ranked_items(manifest.get("items"))

        schema_version = _required(manifest, "schemaVersion")
        if isinstance(schema_version, bool) or not isinstance(schema_version, int) or schema_version != 1:
            raise ValueError("schemaVersion must be 1")

        channel = _required(manifest, "channel")
        if not isinstance(channel, str) or channel not in CHANNELS:
            raise ValueError("channel must be youtube, blog, or instagram")

        period = _mapping(_required(manifest, "period"), "period")
        month = _required(period, "month")
        month_match = _MONTH.fullmatch(month) if isinstance(month, str) else None
        if month_match is None or month_match.group(1) == "0000":
            raise ValueError("period.month must be a real YYYY-MM calendar month")
        year = int(month_match.group(1))
        month_number = int(month_match.group(2))
        start_date = _calendar_date(_required(period, "startDate"), "period.startDate")
        end_date = _calendar_date(_required(period, "endDate"), "period.endDate")
        expected_start = f"{month}-01"
        expected_end = f"{month}-{calendar.monthrange(year, month_number)[1]:02d}"
        if start_date != expected_start or end_date != expected_end:
            raise ValueError("period must cover the complete calendar month")
        timezone = _required(period, "timezone")
        if timezone != "Asia/Tokyo":
            raise ValueError("period.timezone must be Asia/Tokyo")

        ranking_metric = _string(_required(manifest, "rankingMetric"), "rankingMetric")
        ranking_label = _string(_required(manifest, "rankingLabel"), "rankingLabel")
        generated_at = _timestamp(_required(manifest, "generatedAt"))
        ranking_mode = manifest.get("rankingMode")
        if ranking_mode is not None:
            ranking_mode = _string(ranking_mode, "rankingMode")

        items = tuple(
            RankingItem(
                rank=raw_item["rank"],
                content_id=_string(_required(raw_item, "contentId"), "item contentId"),
                title=_string(_required(raw_item, "title"), "item title"),
                url=_url(_required(raw_item, "url")),
                published_at=_calendar_date(
                    _required(raw_item, "publishedAt"), "item publishedAt"
                ),
                metric_value=_metric(_required(raw_item, "metricValue"), "item metricValue"),
                secondary_metric_value=_metric(
                    _required(raw_item, "secondaryMetricValue"),
                    "item secondaryMetricValue",
                ),
            )
            for raw_item in raw_items
        )
        return cls(
            schema_version=schema_version,
            channel=channel,
            month=month,
            start_date=start_date,
            end_date=end_date,
            timezone=timezone,
            ranking_metric=ranking_metric,
            ranking_label=ranking_label,
            generated_at=generated_at,
            items=items,
            ranking_mode=ranking_mode,
        )


@dataclass(frozen=True, slots=True)
class RenderConfig:
    width: int = 1080
    height: int = 1920
    fps: int = 30
    placement: str = "hook"
    motion: str = "cutout-zoom"

    def __post_init__(self) -> None:
        if self.motion not in MOTIONS:
            raise ValueError(f"unknown motion: {self.motion}")
        if self.placement not in PLACEMENTS:
            raise ValueError(f"unknown placement: {self.placement}")
        if type(self.width) is not int or type(self.height) is not int:
            raise ValueError("canvas dimensions must be integers")
        if (self.width, self.height) not in {(1080, 1920), (720, 1280)}:
            raise ValueError("unsupported canvas")
        if type(self.fps) is not int or self.fps != 30:
            raise ValueError("fps must be 30")
