import json
import math
import tempfile
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path

from ranking_shorts.model import RankingManifest, RenderConfig


def valid_manifest():
    return {
        "schemaVersion": 1,
        "channel": "youtube",
        "period": {
            "month": "2026-06",
            "startDate": "2026-06-01",
            "endDate": "2026-06-30",
            "timezone": "Asia/Tokyo",
        },
        "rankingMetric": "views",
        "rankingLabel": "2026年6月の再生回数",
        "generatedAt": "2026-07-05T09:00:00+09:00",
        "items": [
            {
                "rank": rank,
                "contentId": f"id-{rank}",
                "title": f"title-{rank}",
                "url": f"https://example.test/{rank}",
                "publishedAt": "2026-01-01",
                "metricValue": 4 - rank,
                "secondaryMetricValue": rank - 1,
            }
            for rank in (1, 2, 3)
        ],
    }


class ModelTests(unittest.TestCase):
    def load(self, value):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ranking.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            return RankingManifest.from_path(path)

    def test_manifest_requires_exact_ranks(self):
        raw = valid_manifest()
        raw["items"] = raw["items"][:1]
        with self.assertRaisesRegex(ValueError, "exactly ranks 1, 2, 3"):
            self.load(raw)

        raw = valid_manifest()
        raw["items"][1]["rank"] = 1
        with self.assertRaisesRegex(ValueError, "exactly ranks 1, 2, 3"):
            self.load(raw)

    def test_valid_manifest_is_loaded_without_coercion(self):
        manifest = self.load(valid_manifest())

        self.assertEqual(manifest.schema_version, 1)
        self.assertEqual(manifest.channel, "youtube")
        self.assertEqual(manifest.month, "2026-06")
        self.assertEqual(manifest.start_date, "2026-06-01")
        self.assertEqual(manifest.end_date, "2026-06-30")
        self.assertEqual(manifest.timezone, "Asia/Tokyo")
        self.assertEqual(manifest.generated_at, "2026-07-05T09:00:00+09:00")
        self.assertEqual([item.rank for item in manifest.items], [1, 2, 3])
        self.assertEqual(manifest.items[0].published_at, "2026-01-01")
        with self.assertRaises(FrozenInstanceError):
            manifest.channel = "blog"

    def test_manifest_rejects_invalid_required_metadata(self):
        cases = {
            "schema version": ("schemaVersion", "1"),
            "channel": ("channel", "other"),
            "ranking metric": ("rankingMetric", "  "),
            "ranking label": ("rankingLabel", None),
            "generated timestamp": ("generatedAt", "2026-02-30T09:00:00+09:00"),
        }
        for label, (key, value) in cases.items():
            with self.subTest(label=label):
                raw = valid_manifest()
                raw[key] = value
                with self.assertRaises(ValueError):
                    self.load(raw)

    def test_manifest_rejects_invalid_or_partial_month_periods(self):
        invalid_periods = (
            {"month": "2026-13", "startDate": "2026-13-01", "endDate": "2026-13-31", "timezone": "Asia/Tokyo"},
            {"month": "2026-06", "startDate": "2026-06-02", "endDate": "2026-06-30", "timezone": "Asia/Tokyo"},
            {"month": "2026-06", "startDate": "2026-06-01", "endDate": "2026-06-29", "timezone": "Asia/Tokyo"},
            {"month": "2028-02", "startDate": "2028-02-01", "endDate": "2028-02-28", "timezone": "Asia/Tokyo"},
            {"month": "2026-06", "startDate": "2026-06-01", "endDate": "2026-06-30", "timezone": "UTC"},
        )
        for period in invalid_periods:
            with self.subTest(period=period):
                raw = valid_manifest()
                raw["period"] = period
                with self.assertRaises(ValueError):
                    self.load(raw)

    def test_manifest_rejects_invalid_required_item_fields(self):
        invalid_items = (
            {"contentId": ""},
            {"title": "   "},
            {"url": "not a URL"},
            {"publishedAt": "2026-02-30"},
            {"metricValue": "3"},
            {"metricValue": math.nan},
            {"metricValue": math.inf},
            {"metricValue": True},
            {"secondaryMetricValue": None},
        )
        for change in invalid_items:
            with self.subTest(change=change):
                raw = valid_manifest()
                raw["items"][0].update(change)
                with self.assertRaises(ValueError):
                    self.load(raw)

        raw = valid_manifest()
        del raw["items"][0]["secondaryMetricValue"]
        with self.assertRaises(ValueError):
            self.load(raw)

    def test_manifest_rejects_urls_outside_strict_http_schema(self):
        invalid_urls = (
            "https://exa mple.com/path",
            "https://example.test:bad/path",
            "https://example.test:65536/path",
            "https:///missing-host",
            "ftp://example.test/path",
        )
        for url in invalid_urls:
            with self.subTest(url=url):
                raw = valid_manifest()
                raw["items"][0]["url"] = url
                with self.assertRaisesRegex(ValueError, "valid HTTP.*URL"):
                    self.load(raw)

    def test_manifest_accepts_http_port_zero_like_the_javascript_schema(self):
        raw = valid_manifest()
        raw["items"][0]["url"] = "https://example.test:0/path"

        self.assertEqual(self.load(raw).items[0].url, "https://example.test:0/path")

    def test_manifest_rejects_huge_integer_metrics_as_validation_errors(self):
        raw = valid_manifest()
        raw["items"][0]["metricValue"] = 10**400

        with self.assertRaisesRegex(ValueError, "finite number"):
            self.load(raw)

    def test_manifest_rejects_non_object_or_invalid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "ranking.json"
            for contents in ("[]", "{broken"):
                with self.subTest(contents=contents):
                    path.write_text(contents, encoding="utf-8")
                    with self.assertRaises(ValueError):
                        RankingManifest.from_path(path)

    def test_config_rejects_unknown_motion(self):
        with self.assertRaisesRegex(ValueError, "motion"):
            RenderConfig(1080, 1920, 30, "hook", "spin-everything")

    def test_config_accepts_only_supported_immutable_values(self):
        config = RenderConfig(720, 1280, 30, "chapter", "split-reveal")
        self.assertEqual((config.width, config.height), (720, 1280))
        with self.assertRaises(FrozenInstanceError):
            config.fps = 24

        invalid = (
            (1080, 1920, 30, "somewhere", "cutout-zoom"),
            (1080, 1080, 30, "hook", "cutout-zoom"),
            (1080, 1920, 24, "hook", "cutout-zoom"),
            (1080.0, 1920, 30, "hook", "cutout-zoom"),
        )
        for args in invalid:
            with self.subTest(args=args), self.assertRaises(ValueError):
                RenderConfig(*args)


if __name__ == "__main__":
    unittest.main()
