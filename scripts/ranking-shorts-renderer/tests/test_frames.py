import unittest
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image, ImageChops, ImageDraw

from ranking_shorts.frames import (
    _grapheme_clusters,
    _scaled_center_mask,
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

    def assert_bounds_inside_safe_area(self, bounds, canvas):
        self.assertIsNotNone(bounds)
        left, top, right, bottom = bounds
        safe_left, safe_top, safe_right, safe_bottom = safe_area(canvas)
        self.assertGreaterEqual(left, safe_left)
        self.assertGreaterEqual(top, safe_top)
        self.assertLessEqual(right, safe_right)
        self.assertLessEqual(bottom, safe_bottom)

    def test_portrait_fit_preserves_canvas(self):
        result = fit_asset(self.asset, self.canvas)
        self.assertEqual(result.size, self.canvas)

    def test_semantic_lines_preserve_text(self):
        text = "訪問診療クリニックの看護師の仕事"
        self.assertEqual("".join(semantic_lines(text, 12)), text)

    def test_grapheme_clusters_keep_combining_marks_and_variation_selectors(self):
        text = "は\u3099A\ufe0f木\U000e0100"
        self.assertEqual(
            _grapheme_clusters(text),
            ("は\u3099", "A\ufe0f", "木\U000e0100"),
        )
        self.assertEqual(_grapheme_clusters("👩\u200d⚕\ufe0f"), ("👩\u200d⚕\ufe0f",))

    def test_oversized_transition_text_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "transition text"):
            _grapheme_clusters("A" * 513)

    def test_rank_frame_keeps_text_inside_safe_area(self):
        for canvas in ((1080, 1920), (720, 1280)):
            with self.subTest(canvas=canvas):
                config = RenderConfig(width=canvas[0], height=canvas[1])
                rendered = render_rank_frame(
                    self.manifest, self.item, self.asset, 0, config
                )
                blank_manifest = SimpleNamespace(ranking_label="")
                blank_item = SimpleNamespace(rank=1, title="", metric_value=12345)
                baseline = render_rank_frame(
                    blank_manifest, blank_item, self.asset, 0, config
                )
                text_bounds = ImageChops.difference(rendered, baseline).getbbox()

                self.assertEqual(rendered.size, canvas)
                self.assertEqual(rendered.mode, "RGB")
                self.assert_bounds_inside_safe_area(text_bounds, canvas)

    def test_long_fallback_label_keeps_every_glyph_inside_safe_area(self):
        long_label = (
            "2026-06公開投稿の現在views TOP3"
            "（初回限定・月内増加数ではありません）"
        )
        manifest = SimpleNamespace(ranking_label=long_label)
        item = SimpleNamespace(rank=1, title="", metric_value=12345)
        for canvas in ((1080, 1920), (720, 1280)):
            with self.subTest(canvas=canvas):
                config = RenderConfig(width=canvas[0], height=canvas[1])
                rendered = render_rank_frame(manifest, item, self.asset, 0, config)
                baseline = render_rank_frame(
                    SimpleNamespace(ranking_label=""), item, self.asset, 0, config
                )
                label_bounds = ImageChops.difference(rendered, baseline).getbbox()

                self.assert_bounds_inside_safe_area(label_bounds, canvas)

    def test_unrenderable_long_text_fails_closed_at_both_resolutions(self):
        cases = (
            (SimpleNamespace(ranking_label="指標ラベル" * 60), "", "ranking label"),
            (SimpleNamespace(ranking_label=""), "訪問診療" * 200, "title"),
        )
        for canvas in ((1080, 1920), (720, 1280)):
            config = RenderConfig(width=canvas[0], height=canvas[1])
            for manifest, title, expected in cases:
                with self.subTest(canvas=canvas, field=expected):
                    item = SimpleNamespace(rank=1, title=title, metric_value=12345)
                    with self.assertRaisesRegex(ValueError, expected):
                        render_rank_frame(manifest, item, self.asset, 0, config)

    def test_huge_finite_metric_is_width_fitted_at_both_resolutions(self):
        manifest = SimpleNamespace(ranking_label="")
        for canvas in ((1080, 1920), (720, 1280)):
            with self.subTest(canvas=canvas):
                config = RenderConfig(width=canvas[0], height=canvas[1])
                huge_item = SimpleNamespace(rank=1, title="", metric_value=10**300)
                baseline_item = SimpleNamespace(rank=1, title="", metric_value=0)
                rendered = render_rank_frame(
                    manifest, huge_item, self.asset, 0, config
                )
                baseline = render_rank_frame(
                    manifest, baseline_item, self.asset, 0, config
                )
                metric_bounds = ImageChops.difference(rendered, baseline).getbbox()

                self.assert_bounds_inside_safe_area(metric_bounds, canvas)

    def test_rank_badge_text_is_inside_safe_area_at_both_resolutions(self):
        manifest = SimpleNamespace(ranking_label="")
        for canvas in ((1080, 1920), (720, 1280)):
            with self.subTest(canvas=canvas):
                config = RenderConfig(width=canvas[0], height=canvas[1])
                item = SimpleNamespace(rank=1, title="", metric_value=0)
                blank_rank = SimpleNamespace(rank="", title="", metric_value=0)
                rendered = render_rank_frame(manifest, item, self.asset, 0, config)
                baseline = render_rank_frame(
                    manifest, blank_rank, self.asset, 0, config
                )
                rank_bounds = ImageChops.difference(rendered, baseline).getbbox()

                self.assert_bounds_inside_safe_area(rank_bounds, canvas)

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
            self.assertEqual(first.mode, "RGB")
            self.assertEqual(first.tobytes(), second.tobytes())

    def test_all_transitions_finish_on_the_exact_next_frame(self):
        for canvas in ((1080, 1920), (720, 1280)):
            next_frame = Image.new("RGB", canvas, "#e56b6f")
            next_draw = ImageDraw.Draw(next_frame)
            next_draw.rectangle(
                (0, 0, canvas[0] // 3, canvas[1] // 4), fill="#81b29a"
            )
            next_draw.line(
                (0, canvas[1] - 1, canvas[0] - 1, 0), fill="#f4f1de", width=7
            )
            background = Image.new("RGB", canvas, "#1f2430")
            for motion in ("cutout-zoom", "split-reveal", "letter-scatter"):
                with self.subTest(canvas=canvas, motion=motion):
                    config = RenderConfig(
                        width=canvas[0], height=canvas[1], motion=motion
                    )
                    rendered = render_transition_frame(
                        "人気記事TOP3", next_frame, background, 1, config
                    )
                    self.assertEqual(rendered.tobytes(), next_frame.tobytes())

    def test_cutout_zoom_never_resizes_a_mask_beyond_the_canvas(self):
        requested_sizes = []
        transformed_sizes = []
        original_resize = Image.Image.resize
        original_transform = Image.Image.transform

        def recording_resize(image, size, *args, **kwargs):
            requested_sizes.append(size)
            return original_resize(image, size, *args, **kwargs)

        def recording_transform(image, size, *args, **kwargs):
            transformed_sizes.append(size)
            return original_transform(image, size, *args, **kwargs)

        with (
            patch.object(Image.Image, "resize", new=recording_resize),
            patch.object(Image.Image, "transform", new=recording_transform),
        ):
            render_transition_frame(
                "人気記事TOP3",
                self.next_frame,
                self.background,
                0.99,
                RenderConfig(motion="cutout-zoom"),
            )

        self.assertTrue(requested_sizes)
        self.assertTrue(
            all(
                width <= self.canvas[0] and height <= self.canvas[1]
                for width, height in requested_sizes
            ),
            requested_sizes,
        )
        self.assertEqual(transformed_sizes, [self.canvas])

    def test_cutout_zoom_affine_scale_remains_centered(self):
        mask = Image.new("L", (100, 100), 0)
        ImageDraw.Draw(mask).rectangle((55, 45, 64, 54), fill=255)

        bounds = _scaled_center_mask(mask, 2).getbbox()

        self.assertIsNotNone(bounds)
        left, top, right, bottom = bounds
        self.assertAlmostEqual((left + right - 1) / 2, 70, delta=2)
        self.assertAlmostEqual((top + bottom - 1) / 2, 50, delta=2)

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
