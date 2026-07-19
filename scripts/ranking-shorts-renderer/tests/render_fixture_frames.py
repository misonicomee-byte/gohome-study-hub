import argparse
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageDraw

from ranking_shorts.frames import render_rank_frame, render_transition_frame
from ranking_shorts.model import RenderConfig


def synthetic_asset(size=(900, 1200)):
    image = Image.new("RGB", size, "#355070")
    draw = ImageDraw.Draw(image)
    for y in range(size[1]):
        ratio = y / max(1, size[1] - 1)
        color = (
            round(53 + 115 * ratio),
            round(80 + 46 * ratio),
            round(112 + 20 * ratio),
        )
        draw.line((0, y, size[0], y), fill=color)
    draw.rounded_rectangle((100, 190, 800, 1010), radius=70, fill="#f4f1de")
    draw.ellipse((310, 320, 590, 600), fill="#e07a5f")
    draw.rectangle((260, 650, 640, 900), fill="#81b29a")
    return image


def generate_fixtures(output):
    output.mkdir(parents=True, exist_ok=True)
    canvas = (1080, 1920)
    asset = synthetic_asset()
    next_frame = Image.new("RGB", canvas, "#e56b6f")
    background = Image.new("RGB", canvas, "#1f2430")
    manifest = SimpleNamespace(ranking_label="2026年6月のページビュー")
    item = SimpleNamespace(
        rank=1,
        title="訪問診療クリニックの看護師の仕事",
        metric_value=12345,
    )

    rank = render_rank_frame(manifest, item, asset, 0, RenderConfig())
    rank.save(output / "rank-card.png")

    fallback_manifest = SimpleNamespace(
        ranking_label=(
            "2026-06公開投稿の現在views TOP3"
            "（初回限定・月内増加数ではありません）"
        )
    )
    fallback_rank = render_rank_frame(
        fallback_manifest, item, asset, 0, RenderConfig()
    )
    fallback_rank.save(output / "rank-card-instagram-fallback.png")

    for motion in ("cutout-zoom", "split-reveal", "letter-scatter"):
        frame = render_transition_frame(
            "人気コンテンツTOP3",
            next_frame,
            background,
            0.5,
            RenderConfig(motion=motion),
        )
        frame.save(output / f"transition-{motion}.png")


def main():
    parser = argparse.ArgumentParser(description="Generate deterministic ranking frame fixtures")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    generate_fixtures(args.out)


if __name__ == "__main__":
    main()
