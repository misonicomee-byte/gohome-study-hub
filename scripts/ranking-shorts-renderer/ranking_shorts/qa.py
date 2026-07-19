"""Structural and visual quality gates for rendered ranking Shorts."""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import tempfile
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageOps


class QaError(RuntimeError):
    """Raised when a rendered candidate fails a non-negotiable QA gate."""


@dataclass(frozen=True, slots=True)
class QaResult:
    report_path: Path
    sheet_path: Path
    sha256: str


def _run(command, runner, stage):
    try:
        result = runner(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (OSError, subprocess.CalledProcessError):
        raise QaError(f"{stage} failed") from None
    if getattr(result, "returncode", 0) != 0:
        raise QaError(f"{stage} failed")
    return result


def _probe(video, runner):
    result = _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(video),
        ],
        runner,
        "ffprobe",
    )
    try:
        return json.loads(result.stdout.decode("utf-8"))
    except (AttributeError, UnicodeError, json.JSONDecodeError):
        raise QaError("ffprobe returned invalid metadata") from None


def _validate_probe(probe, config):
    streams = probe.get("streams")
    if not isinstance(streams, list):
        raise QaError("stream metadata is missing")
    videos = [stream for stream in streams if stream.get("codec_type") == "video"]
    audios = [stream for stream in streams if stream.get("codec_type") == "audio"]
    if len(videos) != 1 or len(audios) != 1:
        raise QaError("stream count must be exactly one video and one audio")
    video, audio = videos[0], audios[0]
    if video.get("codec_name") != "h264" or audio.get("codec_name") != "aac":
        raise QaError("stream codecs must be H.264 video and AAC audio")
    if (video.get("width"), video.get("height")) != (config.width, config.height):
        raise QaError("video dimensions do not match the requested canvas")
    try:
        fps = Fraction(video.get("avg_frame_rate"))
    except (TypeError, ValueError, ZeroDivisionError):
        raise QaError("video must be exactly 30fps") from None
    if fps != 30:
        raise QaError("video must be exactly 30fps")
    try:
        duration = float(probe["format"]["duration"])
    except (KeyError, TypeError, ValueError):
        raise QaError("video duration metadata is invalid") from None
    if not math.isfinite(duration) or not 53.5 <= duration <= 54.5:
        raise QaError("video duration must be between 53.5 and 54.5 seconds")
    return video, audio, duration


def _contact_sheet(frames, output):
    if not frames:
        raise QaError("contact sheet extraction produced no frames")
    thumb_size = (180, 320)
    columns = min(4, len(frames))
    rows = math.ceil(len(frames) / columns)
    sheet = Image.new("RGB", (columns * thumb_size[0], rows * thumb_size[1]), "black")
    for index, frame_path in enumerate(frames):
        try:
            with Image.open(frame_path) as source:
                thumb = ImageOps.fit(source.convert("RGB"), thumb_size)
        except (OSError, ValueError):
            raise QaError("contact sheet contains an unreadable frame") from None
        sheet.paste(thumb, ((index % columns) * thumb_size[0], (index // columns) * thumb_size[1]))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=90)


def run_qa(video, config, report_path, sheet_path, *, runner=subprocess.run):
    """Run all gates and write evidence only after every gate passes."""

    video = Path(video)
    report_path = Path(report_path)
    sheet_path = Path(sheet_path)
    if not video.is_file():
        raise QaError("rendered video is missing")
    probe = _probe(video, runner)
    video_stream, audio_stream, duration = _validate_probe(probe, config)

    _run(
        ["ffmpeg", "-v", "error", "-i", str(video), "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"],
        runner,
        "full decode",
    )
    black_result = _run(
        ["ffmpeg", "-v", "info", "-i", str(video), "-vf", "blackdetect=d=1:pix_th=0.10", "-an", "-f", "null", "-"],
        runner,
        "blackdetect",
    )
    black_text = getattr(black_result, "stderr", b"")
    if isinstance(black_text, bytes):
        black_text = black_text.decode("utf-8", errors="replace")
    if re.search(r"black_start\s*:", black_text or ""):
        raise QaError("black segment detected")

    with tempfile.TemporaryDirectory(prefix="ranking-shorts-qa-") as temporary:
        pattern = Path(temporary) / "frame-%03d.jpg"
        _run(
            ["ffmpeg", "-v", "error", "-i", str(video), "-vf", "fps=1/2", "-q:v", "2", str(pattern)],
            runner,
            "contact sheet extraction",
        )
        _contact_sheet(tuple(sorted(pattern.parent.glob("frame-*.jpg"))), sheet_path)

    digest = hashlib.sha256(video.read_bytes()).hexdigest()
    report = {
        "passed": True,
        "sha256": digest,
        "videoCodec": video_stream["codec_name"],
        "audioCodec": audio_stream["codec_name"],
        "width": video_stream["width"],
        "height": video_stream["height"],
        "fps": 30,
        "duration": duration,
        "fullDecode": True,
        "blackSegments": [],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return QaResult(report_path, sheet_path, digest)
