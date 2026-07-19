import math


def clamp01(value):
    return max(0.0, min(1.0, float(value)))


def ease_in(value):
    t = clamp01(value)
    return t * t * t


def ease_in_out(value):
    t = clamp01(value)
    return 0.5 - math.cos(math.pi * t) / 2
