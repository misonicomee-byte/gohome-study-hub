from pathlib import Path

from PIL import ImageFont


FONT_PATH = Path(__file__).resolve().parents[3] / "public/fonts/IPAexGothic.ttf"


def safe_area(canvas):
    width, height = canvas
    return (
        round(72 * width / 1080),
        round(120 * height / 1920),
        round(1008 * width / 1080),
        round(1740 * height / 1920),
    )


def load_font(size):
    return ImageFont.truetype(str(FONT_PATH), max(1, round(size)))
