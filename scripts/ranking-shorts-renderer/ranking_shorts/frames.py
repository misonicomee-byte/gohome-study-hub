import re
import unicodedata

from PIL import Image, ImageDraw, ImageFilter

from .layout import load_font, safe_area
from .motions import motion_state

MAX_TRANSITION_CODEPOINTS = 512
DISPLAY_TITLE_CODEPOINTS = 28


def fit_asset(image, canvas):
    source = image.convert("RGB")
    background = source.resize(canvas, Image.Resampling.LANCZOS).filter(
        ImageFilter.GaussianBlur(round(28 * canvas[0] / 1080))
    )
    scale = min(canvas[0] / source.width, canvas[1] / source.height)
    foreground = source.resize(
        (round(source.width * scale), round(source.height * scale)),
        Image.Resampling.LANCZOS,
    )
    background.paste(
        foreground,
        ((canvas[0] - foreground.width) // 2, (canvas[1] - foreground.height) // 2),
    )
    return background


def semantic_lines(text, limit):
    if limit < 1:
        raise ValueError("line limit must be positive")
    if len(text) <= limit:
        return [text]
    result = []
    remaining = text
    while len(remaining) > limit:
        candidates = [remaining.rfind(mark, 0, limit + 1) + 1 for mark in "、。！？・ "]
        cut = max(candidates)
        if cut <= 0:
            cut = limit
        result.append(remaining[:cut])
        remaining = remaining[cut:]
    if remaining:
        result.append(remaining)
    if "".join(result) != text:
        raise AssertionError("line wrapping must preserve the exact text")
    return result


def display_title(text, max_codepoints=DISPLAY_TITLE_CODEPOINTS):
    """Return a compact on-screen title while preserving source copy elsewhere."""
    normalized = " ".join(str(text).split()).strip()
    if not normalized:
        return normalized
    sections = [section.strip() for section in normalized.replace(" | ", "｜").split("｜")]
    compact = next((section for section in sections if section), normalized)
    if len(compact) > max_codepoints:
        compact = compact[:max_codepoints].rstrip("、。・:： ") + "…"
    return compact


def pixel_lines(draw, text, font, max_width, max_lines):
    """Wrap using the actual font metrics and ellipsize at a hard line count."""
    if max_width <= 0 or max_lines < 1:
        raise ValueError("pixel width and line-count limits must be positive")
    clusters = list(_grapheme_clusters(" ".join(str(text).split())))
    if not clusters:
        return []

    lines = []
    cursor = 0
    while cursor < len(clusters) and len(lines) < max_lines:
        start = cursor
        end = cursor
        last_break = None
        while end < len(clusters):
            candidate = "".join(clusters[start : end + 1])
            if draw.textlength(candidate, font=font) > max_width:
                break
            if clusters[end] in "、。！？・ ":
                last_break = end + 1
            end += 1
        if end == start:
            end = start + 1
        elif end < len(clusters) and last_break and last_break > start:
            end = last_break
        lines.append("".join(clusters[start:end]).strip())
        cursor = end

    if cursor < len(clusters):
        ellipsis = "…"
        final = list(_grapheme_clusters(lines[-1]))
        while final and draw.textlength("".join(final) + ellipsis, font=font) > max_width:
            final.pop()
        lines[-1] = "".join(final).rstrip("、。！？・ ") + ellipsis
    return lines


def _scaled(value, canvas):
    return round(value * min(canvas[0] / 1080, canvas[1] / 1920))


def _multiline(
    draw,
    text,
    max_width,
    max_height,
    canvas,
    start_size,
    minimum_size=18,
    field_name="text",
):
    def layout_at(size):
        font = load_font(size)
        limit = max(1, int(max_width / max(size, 1)))
        rendered = "\n".join(semantic_lines(text, limit))
        spacing = max(1, round(size * 0.18))
        bounds = draw.multiline_textbbox((0, 0), rendered, font=font, spacing=spacing)
        return rendered, font, spacing, bounds

    def fits(bounds):
        return (
            bounds[2] - bounds[0] <= max_width
            and bounds[3] - bounds[1] <= max_height
        )

    size = _scaled(start_size, canvas)
    minimum = _scaled(minimum_size, canvas)
    minimum_layout = layout_at(minimum)
    if not fits(minimum_layout[3]):
        raise ValueError(f"{field_name} does not fit inside its safe-area box")
    while size > minimum:
        rendered, font, spacing, bounds = layout_at(size)
        if fits(bounds):
            return rendered, font, spacing
        size -= 2
    return minimum_layout[:3]


def _fit_single_line_font(draw, text, max_width, canvas, start_size):
    low = 1
    high = _scaled(start_size, canvas)
    best = None
    while low <= high:
        size = (low + high) // 2
        font = load_font(size)
        bounds = draw.textbbox((0, 0), text, font=font)
        if bounds[2] - bounds[0] <= max_width:
            best = font
            low = size + 1
        else:
            high = size - 1
    if best is None:
        raise ValueError("metric does not fit inside its safe-area box")
    return best


def _metric_text(value):
    if isinstance(value, int) or float(value).is_integer():
        return f"{int(value):,}"
    return f"{float(value):,.2f}".rstrip("0").rstrip(".")


def _display_metric_label(text):
    compact = " ".join(str(text).split())
    compact = re.sub(
        r"(?<!\d)\d{4}-(0[1-9]|1[0-2])(?!\d)",
        lambda match: f"{int(match.group(1))}月",
        compact,
    )
    compact = compact.replace("ページビュー", "PV").replace("page views", "PV")
    compact = compact.replace("views", "閲覧数")
    if len(compact) > 24:
        compact = compact[:23].rstrip("、。・:： ") + "…"
    return compact


def render_rank_frame(manifest, item, asset, time, config):
    del time
    canvas = (config.width, config.height)
    frame = fit_asset(asset, canvas).convert("RGBA")
    left, _, right, bottom = safe_area(canvas)
    panel_top = _scaled(1180, canvas)

    overlay = Image.new("RGBA", canvas, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rounded_rectangle(
        (left, panel_top, right, bottom),
        radius=_scaled(42, canvas),
        fill=(8, 18, 35, 220),
        outline=(255, 255, 255, 46),
        width=max(1, _scaled(2, canvas)),
    )
    frame = Image.alpha_composite(frame, overlay)
    draw = ImageDraw.Draw(frame)

    badge_left = left + _scaled(28, canvas)
    badge_top = panel_top + _scaled(34, canvas)
    badge_size = _scaled(116, canvas)
    draw.ellipse(
        (badge_left, badge_top, badge_left + badge_size, badge_top + badge_size),
        fill=(238, 80, 72, 255),
    )
    rank_font = load_font(_scaled(56, canvas))
    draw.text(
        (badge_left + badge_size / 2, badge_top + badge_size / 2),
        str(item.rank),
        font=rank_font,
        fill="white",
        anchor="mm",
    )

    text_left = badge_left + badge_size + _scaled(26, canvas)
    text_right = right - _scaled(28, canvas)
    title_top = badge_top
    title_height = _scaled(190, canvas)
    if item.title:
        rendered_title, title_font, spacing = _multiline(
            draw,
            display_title(item.title),
            text_right - text_left,
            title_height,
            canvas,
            62,
            field_name="title",
        )
        draw.multiline_text(
            (text_left, title_top),
            rendered_title,
            font=title_font,
            fill=(255, 255, 255, 255),
            spacing=spacing,
        )

    label_y = bottom - _scaled(94, canvas)
    if manifest.ranking_label:
        label_left = left + _scaled(34, canvas)
        label_right = right - _scaled(34, canvas)
        rendered_label, label_font, label_spacing = _multiline(
            draw,
            _display_metric_label(manifest.ranking_label),
            label_right - label_left,
            _scaled(90, canvas),
            canvas,
            36,
            22,
            field_name="ranking label",
        )
        draw.multiline_text(
            (label_left, label_y),
            rendered_label,
            font=label_font,
            fill=(207, 220, 238, 255),
            spacing=label_spacing,
        )

    metric_text = _metric_text(item.metric_value)
    metric_font = _fit_single_line_font(
        draw,
        metric_text,
        right - left - _scaled(68, canvas),
        canvas,
        92,
    )
    draw.text(
        (right - _scaled(34, canvas), bottom - _scaled(42, canvas)),
        metric_text,
        font=metric_font,
        fill=(255, 215, 100, 255),
        anchor="rs",
    )
    return frame.convert("RGB")


def _text_mask(text, canvas, font_size=190):
    mask = Image.new("L", canvas, 0)
    if not text:
        return mask
    draw = ImageDraw.Draw(mask)
    max_width = canvas[0] - _scaled(144, canvas)
    rendered, font, spacing = _multiline(
        draw,
        text,
        max_width,
        canvas[1] // 2,
        canvas,
        font_size,
        32,
        field_name="transition text",
    )
    bounds = draw.multiline_textbbox((0, 0), rendered, font=font, spacing=spacing)
    x = (canvas[0] - (bounds[2] - bounds[0])) // 2 - bounds[0]
    y = (canvas[1] - (bounds[3] - bounds[1])) // 2 - bounds[1]
    draw.multiline_text((x, y), rendered, font=font, fill=255, spacing=spacing)
    return mask


def _scaled_center_mask(mask, scale):
    if scale <= 0:
        raise ValueError("mask scale must be positive")
    canvas = mask.size
    inverse_scale = 1 / scale
    center_x = canvas[0] / 2
    center_y = canvas[1] / 2
    return mask.transform(
        canvas,
        Image.Transform.AFFINE,
        (
            inverse_scale,
            0,
            center_x * (1 - inverse_scale),
            0,
            inverse_scale,
            center_y * (1 - inverse_scale),
        ),
        resample=Image.Resampling.BICUBIC,
    )


def _background_with_title(background, text):
    titled = background.convert("RGBA")
    mask = _text_mask(text, background.size, 150)
    ink = Image.new("RGBA", background.size, (255, 255, 255, 235))
    titled.alpha_composite(Image.composite(ink, Image.new("RGBA", background.size), mask))
    return titled.convert("RGB")


def _single_line_font(text, canvas):
    size = _scaled(120, canvas)
    minimum = _scaled(32, canvas)
    scratch = ImageDraw.Draw(Image.new("L", canvas))
    while size > minimum:
        font = load_font(size)
        if scratch.textlength(text, font=font) <= canvas[0] - _scaled(144, canvas):
            return font
        size -= 2
    return load_font(minimum)


def _grapheme_clusters(text):
    if len(text) > MAX_TRANSITION_CODEPOINTS:
        raise ValueError(
            f"transition text exceeds {MAX_TRANSITION_CODEPOINTS} code points"
        )
    clusters = []
    for character in text:
        codepoint = ord(character)
        extends_previous = (
            unicodedata.category(character) in {"Mn", "Mc", "Me"}
            or 0xFE00 <= codepoint <= 0xFE0F
            or 0xE0100 <= codepoint <= 0xE01EF
            or 0x1F3FB <= codepoint <= 0x1F3FF
            or character == "\u200d"
            or bool(clusters and clusters[-1][-1] == "\u200d")
        )
        if clusters and extends_previous:
            clusters[-1].append(character)
        else:
            clusters.append([character])
    result = tuple("".join(cluster) for cluster in clusters)
    if "".join(result) != text:
        raise AssertionError("grapheme grouping must preserve the exact text")
    return result


def _letter_scatter(text, next_frame, background, progress, canvas):
    graphemes = _grapheme_clusters(text)
    state = motion_state("letter-scatter", progress, len(graphemes))
    reveal = 1 - state["opacity"]
    result = Image.blend(background, next_frame, reveal).convert("RGBA")
    if not text or state["opacity"] <= 0:
        return result.convert("RGB")

    font = _single_line_font(text, canvas)
    scratch = ImageDraw.Draw(Image.new("L", canvas))
    widths = [scratch.textlength(glyph, font=font) for glyph in graphemes]
    cursor = (canvas[0] - sum(widths)) / 2
    center_y = canvas[1] / 2
    for glyph, width, transform in zip(graphemes, widths, state["glyphs"]):
        bounds = scratch.textbbox((0, 0), glyph or " ", font=font)
        glyph_width = max(1, bounds[2] - bounds[0] + _scaled(24, canvas))
        glyph_height = max(1, bounds[3] - bounds[1] + _scaled(24, canvas))
        layer = Image.new("RGBA", (glyph_width, glyph_height), (0, 0, 0, 0))
        layer_draw = ImageDraw.Draw(layer)
        alpha = round(255 * state["opacity"])
        layer_draw.text(
            (_scaled(12, canvas) - bounds[0], _scaled(12, canvas) - bounds[1]),
            glyph,
            font=font,
            fill=(255, 255, 255, alpha),
        )
        scale = transform["scale"]
        layer = layer.resize(
            (max(1, round(layer.width * scale)), max(1, round(layer.height * scale))),
            Image.Resampling.LANCZOS,
        ).rotate(transform["rotation"], resample=Image.Resampling.BICUBIC, expand=True)
        x = cursor + width / 2 + transform["x"] * canvas[0] * 0.28 - layer.width / 2
        y = center_y + transform["y"] * canvas[1] * 0.12 - layer.height / 2
        result.alpha_composite(layer, (round(x), round(y)))
        cursor += width
    return result.convert("RGB")


def render_transition_frame(text, next_frame, background, progress, config):
    canvas = (config.width, config.height)
    next_image = next_frame.convert("RGB").resize(canvas, Image.Resampling.LANCZOS)
    background_image = background.convert("RGB").resize(canvas, Image.Resampling.LANCZOS)
    if float(progress) >= 1:
        return next_image

    if config.motion == "cutout-zoom":
        state = motion_state(config.motion, progress, len(text))
        mask = _scaled_center_mask(_text_mask(text, canvas), state["scale"])
        return Image.composite(next_image, background_image, mask)

    if config.motion == "split-reveal":
        state = motion_state(config.motion, progress, len(text))
        titled = _background_with_title(background_image, text)
        half = canvas[1] // 2
        result = next_image.copy()
        result.paste(titled.crop((0, 0, canvas[0], half)), (0, round(state["top_y"] * half)))
        result.paste(
            titled.crop((0, half, canvas[0], canvas[1])),
            (0, half + round(state["bottom_y"] * (canvas[1] - half))),
        )
        return result

    if config.motion == "letter-scatter":
        return _letter_scatter(text, next_image, background_image, progress, canvas)

    raise ValueError(f"unknown motion: {config.motion}")
