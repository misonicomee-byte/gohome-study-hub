from .easing import ease_in, ease_in_out


def motion_state(name, progress, glyph_count):
    t = max(0.0, min(1.0, float(progress)))

    if name == "cutout-zoom":
        return {"scale": 1 + 8 * ease_in(t), "opacity": 1}

    if name == "split-reveal":
        value = ease_in_out(t)
        return {"top_y": -value, "bottom_y": value, "gap": value}

    if name == "letter-scatter":
        value = ease_in_out(t)
        glyphs = tuple(
            {
                "x": ((index % 2) * 2 - 1) * value,
                "y": (index - (glyph_count - 1) / 2) * 0.35 * value,
                "rotation": ((index * 37) % 90 - 45) * value,
                "scale": 1 - 0.25 * value,
            }
            for index in range(glyph_count)
        )
        return {"glyphs": glyphs, "opacity": 1 - value}

    raise ValueError(f"unknown motion: {name}")
