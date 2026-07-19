import unittest

from ranking_shorts.easing import ease_in, ease_in_out
from ranking_shorts.motions import motion_state


class MotionTests(unittest.TestCase):
    def test_easing_endpoints_and_clamps(self):
        self.assertEqual(ease_in_out(0), 0)
        self.assertEqual(ease_in_out(1), 1)
        self.assertEqual(ease_in_out(-1), 0)
        self.assertEqual(ease_in_out(2), 1)
        self.assertEqual(ease_in(-1), 0)
        self.assertEqual(ease_in(2), 1)
        self.assertLess(ease_in(0.25), 0.25)

    def test_cutout_zoom_finishes_beyond_canvas(self):
        self.assertGreaterEqual(motion_state("cutout-zoom", 1, 4)["scale"], 8)

    def test_motion_progress_is_clamped(self):
        for name in ("cutout-zoom", "split-reveal", "letter-scatter"):
            self.assertEqual(motion_state(name, -1, 4), motion_state(name, 0, 4))
            self.assertEqual(motion_state(name, 2, 4), motion_state(name, 1, 4))

    def test_letter_scatter_is_deterministic(self):
        first = motion_state("letter-scatter", 0.5, 4)
        second = motion_state("letter-scatter", 0.5, 4)
        self.assertEqual(first, second)
        self.assertEqual(len(first["glyphs"]), 4)

    def test_split_reveal_opens_both_panels(self):
        state = motion_state("split-reveal", 1, 3)
        self.assertEqual(state["top_y"], -1)
        self.assertEqual(state["bottom_y"], 1)

    def test_unknown_motion_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unknown motion"):
            motion_state("spin-everything", 0.5, 4)


if __name__ == "__main__":
    unittest.main()
