import unittest
from types import SimpleNamespace

from PIL import Image, ImageChops

from ranking_shorts.frames import (
    fit_asset,
    render_rank_frame,
    render_transition_frame,
    semantic_lines,
)
from ranking_shorts.layout import safe_area
from ranking_shorts.model import RenderConfig


class FrameTests(unittest.TestCase):
    def setUp(self):
        self.canvas = (1080, 1920)
        self.asset = Image.new("RGB", (640, 480), "#355070")
        self.next_frame = Image.new("RGB", self.canvas, "#e56b6f")
        self.background = Image.new("RGB", self.canvas, "#1f2430")
        self.item = SimpleNamespace(
            rank=1,
            title="訪問診療クリニックの看護師の仕事",
            metric_value=12345,
        )
        self.manifest = SimpleNamespace(ranking_label="2026年6月のページビュー")

    def test_portrait_fit_preserves_canvas(self):
        result = fit_asset(self.asset, self.canvas)
        self.assertEqual(result.size, self.canvas)

    def test_semantic_lines_preserve_text(self):
        text = "訪問診療クリニックの看護師の仕事"
        self.assertEqual("".join(semantic_lines(text, 12)), text)

    def test_rank_frame_keeps_text_inside_safe_area(self):
        config = RenderConfig()
        rendered = render_rank_frame(self.manifest, self.item, self.asset, 0, config)
        blank_manifest = SimpleNamespace(ranking_label="")
        blank_item = SimpleNamespace(rank=1, title="", metric_value=12345)
        baseline = render_rank_frame(blank_manifest, blank_item, self.asset, 0, config)
        text_bounds = ImageChops.difference(rendered, baseline).getbbox()

        self.assertEqual(rendered.size, self.canvas)
        self.assertIsNotNone(text_bounds)
        left, top, right, bottom = text_bounds
        safe_left, safe_top, safe_right, safe_bottom = safe_area(self.canvas)
        self.assertGreaterEqual(left, safe_left)
        self.assertGreaterEqual(top, safe_top)
        self.assertLessEqual(right, safe_right)
        self.assertLessEqual(bottom, safe_bottom)

    def test_long_fallback_label_keeps_every_glyph_inside_safe_area(self):
        config = RenderConfig()
        long_label = (
            "2026-06公開投稿の現在views TOP3"
            "（初回限定・月内増加数ではありません）"
        )
        manifest = SimpleNamespace(ranking_label=long_label)
        item = SimpleNamespace(rank=1, title="", metric_value=12345)
        rendered = render_rank_frame(manifest, item, self.asset, 0, config)
        baseline = render_rank_frame(
            SimpleNamespace(ranking_label=""), item, self.asset, 0, config
        )
        label_bounds = ImageChops.difference(rendered, baseline).getbbox()

        self.assertIsNotNone(label_bounds)
        safe_left, safe_top, safe_right, safe_bottom = safe_area(self.canvas)
        left, top, right, bottom = label_bounds
        self.assertGreaterEqual(left, safe_left)
        self.assertGreaterEqual(top, safe_top)
        self.assertLessEqual(right, safe_right)
        self.assertLessEqual(bottom, safe_bottom)

    def test_transitions_are_deterministic_and_preserve_canvas(self):
        for motion in ("cutout-zoom", "split-reveal", "letter-scatter"):
            config = RenderConfig(motion=motion)
            first = render_transition_frame(
                "人気記事TOP3", self.next_frame, self.background, 0.5, config
            )
            second = render_transition_frame(
                "人気記事TOP3", self.next_frame, self.background, 0.5, config
            )
            self.assertEqual(first.size, self.canvas)
            self.assertEqual(first.tobytes(), second.tobytes())

    def test_each_transition_depends_on_exact_title_text(self):
        for motion in ("cutout-zoom", "split-reveal", "letter-scatter"):
            config = RenderConfig(motion=motion)
            first = render_transition_frame(
                "人気記事TOP3", self.next_frame, self.background, 0.5, config
            )
            second = render_transition_frame(
                "人気投稿TOP3", self.next_frame, self.background, 0.5, config
            )
            self.assertIsNotNone(ImageChops.difference(first, second).getbbox())


if __name__ == "__main__":
    unittest.main()
