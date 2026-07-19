from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import wave
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

from .audio import synthesize_narration
from .frames import fit_asset, render_rank_frame, render_transition_frame, semantic_lines
from .layout import load_font, safe_area


TIMELINE = (
    ("hook", 0, 3),
    ("rank3", 3, 15),
    ("rank2", 15, 29),
    ("rank1", 29, 46),
    ("outro", 46, 54),
)
VIDEO_SUFFIXES = frozenset({".mp4", ".mov", ".m4v", ".webm"})
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})
MAX_ASSET_SECONDS = 54
MAX_SAFE_TEMPO = 1.25
ISO_MONTH = re.compile(r"(?<!\d)(\d{4})-(0[1-9]|1[0-2])(?!\d)")


@dataclass(frozen=True, slots=True)
class Script:
    items: tuple
    captions: tuple[str, ...]


def _metric_text(value):
    if isinstance(value, int) or float(value).is_integer():
        return f"{int(value):,}"
    return f"{float(value):,.2f}".rstrip("0").rstrip(".")


def _spoken_month(month):
    year, number = month.split("-", 1)
    return f"{int(year)}年{int(number)}月"


def _naturalize_months(text):
    return ISO_MONTH.sub(
        lambda match: f"{int(match.group(1))}年{int(match.group(2))}月",
        text,
    )


def build_script(manifest):
    ordered = tuple(sorted(manifest.items, key=lambda item: item.rank, reverse=True))
    is_podcast = manifest.channel == "podcast"
    ranking_label = (
        "前月増加再生数"
        if is_podcast
        else _naturalize_months(manifest.ranking_label)
    )
    hook = (
        f"{_spoken_month(manifest.month)}のポッドキャスト、前月増加再生数トップ3。"
        if is_podcast
        else f"{_spoken_month(manifest.month)}の人気コンテンツ、トップ3。"
    )
    captions = [hook]
    captions.extend(
        f"第{item.rank}位。{_naturalize_months(item.title)}。"
        f"{ranking_label}は、"
        f"{_metric_text(item.metric_value)}回でした。"
        for item in ordered
    )
    captions.append(
        (
            "気になるエピソードは、"
            if is_podcast
            else "気になる内容は、"
        )
        + "ごうホームクリニック公式チャンネルとサイトでご覧ください。"
    )
    return Script(ordered, tuple(captions))


def special_transition_starts(config):
    if config.placement == "hook":
        return (0,)
    if config.placement == "chapter":
        return (15, 29)
    return ()


def run_ffmpeg(command, *, runner=subprocess.run, stage="render"):
    try:
        result = runner(
            command,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (subprocess.CalledProcessError, OSError):
        raise RuntimeError(f"ffmpeg {stage} failed") from None
    if getattr(result, "returncode", 0) != 0:
        raise RuntimeError(f"ffmpeg {stage} failed")
    return result


def materialize_asset_frames(asset, directory, config, *, runner=subprocess.run):
    asset = Path(asset)
    suffix = asset.suffix.lower()
    if suffix in IMAGE_SUFFIXES:
        return (asset,)
    if suffix not in VIDEO_SUFFIXES:
        raise ValueError(f"unsupported asset type: {suffix or 'none'}")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    pattern = directory / "frame-%06d.png"
    command = [
        "ffmpeg",
        "-n",
        "-v",
        "error",
        "-i",
        str(asset),
        "-t",
        str(MAX_ASSET_SECONDS),
        "-vf",
        f"fps={config.fps}",
        "-frames:v",
        str(MAX_ASSET_SECONDS * config.fps),
        str(pattern),
    ]
    run_ffmpeg(command, runner=runner, stage="asset decode")
    frames = tuple(sorted(directory.glob("frame-*.png")))
    if not frames:
        raise RuntimeError("ffmpeg asset decode produced no frames")
    return frames


def _rank_asset(project_dir, rank):
    candidates = [
        path
        for path in Path(project_dir).glob(f"rank-{rank}.*")
        if path.suffix.lower() in IMAGE_SUFFIXES | VIDEO_SUFFIXES
    ]
    if len(candidates) != 1:
        raise ValueError(f"rank-{rank} requires exactly one image or video asset")
    return candidates[0]


def _bgm_asset(project_dir):
    candidates = [
        Path(project_dir) / name
        for name in ("bgm.wav", "bgm.mp3", "bgm.m4a", "bgm.aac")
        if (Path(project_dir) / name).is_file()
    ]
    if len(candidates) != 1:
        raise ValueError("project requires exactly one bgm audio file")
    return candidates[0]


def _caption_frame(frame, caption, config):
    canvas = (config.width, config.height)
    result = frame.convert("RGBA")
    overlay = Image.new("RGBA", canvas, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    left, top, right, _ = safe_area(canvas)
    font_size = round(38 * config.width / 1080)
    font = load_font(font_size)
    limit = max(1, int((right - left - 40) / max(font_size, 1)))
    exact_caption = "\n".join(semantic_lines(caption, limit))
    spacing = max(1, round(font_size * 0.2))
    bounds = draw.multiline_textbbox((0, 0), exact_caption, font=font, spacing=spacing)
    box_bottom = top + (bounds[3] - bounds[1]) + round(44 * config.height / 1920)
    draw.rounded_rectangle(
        (left, top, right, box_bottom),
        radius=round(20 * config.width / 1080),
        fill=(0, 0, 0, 190),
    )
    draw.multiline_text(
        (left + round(20 * config.width / 1080), top + round(16 * config.height / 1920)),
        exact_caption,
        font=font,
        fill="white",
        spacing=spacing,
    )
    return Image.alpha_composite(result, overlay).convert("RGB")


def _timeline_entry(seconds):
    for index, (name, start, end) in enumerate(TIMELINE):
        if start <= seconds < end:
            return index, name
    return len(TIMELINE) - 1, "outro"


def _asset_image(paths, frame_number):
    path = paths[frame_number % len(paths)]
    with Image.open(path) as source:
        return source.convert("RGB").copy()


def scene_frame_number(name, frame_index, fps):
    starts = {entry_name: start for entry_name, start, _ in TIMELINE}
    if name not in starts:
        raise ValueError(f"unknown timeline scene: {name}")
    return max(0, frame_index - starts[name] * fps)


def render_outro_frame(manifest, materialized, config):
    canvas = (config.width, config.height)
    frame = Image.new("RGB", canvas, "#111827")
    draw = ImageDraw.Draw(frame)
    scale = config.width / 1080
    margin = round(72 * scale)
    title_font = load_font(round(64 * scale))
    body_font = load_font(round(34 * scale))
    rank_font = load_font(round(48 * scale))
    draw.text((margin, margin), "TOP3一覧", font=title_font, fill="white")

    top = margin + round(100 * scale)
    bottom = config.height - margin
    gap = round(24 * scale)
    card_height = (bottom - top - gap * 2) // 3
    items = {item.rank: item for item in manifest.items}
    for index, rank in enumerate((1, 2, 3)):
        card_top = top + index * (card_height + gap)
        card_bottom = card_top + card_height
        draw.rounded_rectangle(
            (margin, card_top, config.width - margin, card_bottom),
            radius=round(24 * scale),
            fill="#1f2937",
            outline="#475569",
            width=max(1, round(2 * scale)),
        )
        thumb_size = max(1, card_height - round(32 * scale))
        thumb = fit_asset(_asset_image(materialized[rank], 0), (thumb_size, thumb_size))
        thumb_left = margin + round(16 * scale)
        thumb_top = card_top + round(16 * scale)
        frame.paste(thumb, (thumb_left, thumb_top))
        text_left = thumb_left + thumb_size + round(24 * scale)
        draw.text(
            (text_left, card_top + round(28 * scale)),
            f"第{rank}位",
            font=rank_font,
            fill="#facc15",
        )
        title = "\n".join(semantic_lines(items[rank].title, 16))
        draw.multiline_text(
            (text_left, card_top + round(96 * scale)),
            title,
            font=body_font,
            fill="white",
            spacing=max(1, round(7 * scale)),
        )
        draw.text(
            (config.width - margin - round(24 * scale), card_bottom - round(28 * scale)),
            _metric_text(items[rank].metric_value),
            font=body_font,
            fill="#cbd5e1",
            anchor="rs",
        )
    return frame


def render_frames(project_dir, manifest, config, directory, *, runner=subprocess.run):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    script = build_script(manifest)
    items = {item.rank: item for item in manifest.items}
    materialized = {
        rank: materialize_asset_frames(
            _rank_asset(project_dir, rank),
            directory.parent / f"asset-{rank}",
            config,
            runner=runner,
        )
        for rank in (1, 2, 3)
    }
    background = Image.new("RGB", (config.width, config.height), "#111827")
    starts = set(special_transition_starts(config))
    total_frames = TIMELINE[-1][2] * config.fps

    for frame_index in range(total_frames):
        seconds = frame_index / config.fps
        caption_index, name = _timeline_entry(seconds)
        if name == "outro":
            frame = render_outro_frame(manifest, materialized, config)
            frame = _caption_frame(frame, script.captions[caption_index], config)
            frame.save(directory / f"frame-{frame_index + 1:06d}.png")
            continue

        rank = 3 if name in {"hook", "rank3"} else 2 if name == "rank2" else 1
        item = items[rank]
        local_frame = scene_frame_number(name, frame_index, config.fps)
        asset = _asset_image(materialized[rank], local_frame)

        transition_start = next(
            (start for start in starts if start <= seconds < start + 1),
            None,
        )
        if transition_start is not None:
            next_frame = fit_asset(asset, (config.width, config.height))
            frame = render_transition_frame(
                script.captions[caption_index],
                next_frame,
                background,
                seconds - transition_start,
                config,
            )
        else:
            frame = render_rank_frame(manifest, item, asset, seconds, config)
        frame = _caption_frame(frame, script.captions[caption_index], config)
        frame.save(directory / f"frame-{frame_index + 1:06d}.png")
    return directory / "frame-%06d.png"


def build_ffmpeg_command(frames, narration, bgm, output, config):
    filter_complex = (
        "[1:a]apad,atrim=duration=54[narration];"
        "[2:a]volume=0.18,apad,atrim=duration=54[bgm];"
        "[narration][bgm]amix=inputs=2:duration=longest:dropout_transition=0[mixed]"
    )
    return [
        "ffmpeg",
        "-n",
        "-v",
        "error",
        "-framerate",
        str(config.fps),
        "-i",
        str(frames),
        "-i",
        str(narration),
        "-stream_loop",
        "-1",
        "-i",
        str(bgm),
        "-filter_complex",
        filter_complex,
        "-map",
        "0:v:0",
        "-map",
        "[mixed]",
        "-t",
        "54",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(config.fps),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        str(output),
    ]


def _wav_duration(path):
    try:
        with wave.open(str(path), "rb") as source:
            rate = source.getframerate()
            frames = source.getnframes()
    except (OSError, EOFError, wave.Error):
        raise RuntimeError("TTS did not create valid PCM WAV audio") from None
    if rate <= 0 or frames <= 0:
        raise RuntimeError("TTS created empty audio")
    return frames / rate


def validate_prebuilt_narration(path):
    path = Path(path)
    try:
        with wave.open(str(path), "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            rate = source.getframerate()
            frames = source.getnframes()
            compression = source.getcomptype()
    except (OSError, EOFError, wave.Error):
        raise RuntimeError(
            "prebuilt narration must be a valid 44.1 kHz stereo 16-bit PCM WAV"
        ) from None
    if (channels, sample_width, rate, compression) != (2, 2, 44100, "NONE"):
        raise RuntimeError(
            "prebuilt narration must be a valid 44.1 kHz stereo 16-bit PCM WAV"
        )
    duration = frames / rate if rate else 0
    if abs(duration - TIMELINE[-1][2]) > (1 / rate):
        raise RuntimeError("prebuilt narration must be exactly 54 seconds")
    return path


def build_aligned_narration_command(segments, durations, output):
    if len(segments) != len(TIMELINE) or len(durations) != len(TIMELINE):
        raise ValueError("timeline narration requires one segment per caption")
    command = ["ffmpeg", "-n", "-v", "error"]
    for segment in segments:
        command.extend(("-i", str(segment)))

    filters = []
    labels = []
    for index, ((_, start, end), duration) in enumerate(zip(TIMELINE, durations)):
        slot = end - start
        if duration <= 0:
            raise RuntimeError("TTS created empty audio")
        tempo = duration / slot
        if tempo > MAX_SAFE_TEMPO:
            raise RuntimeError(f"TTS segment {index + 1} is too long for its timeline slot")
        chain = "aformat=sample_rates=44100:channel_layouts=stereo,"
        if tempo > 1:
            chain += f"atempo={tempo:.6f},"
        chain += f"apad,atrim=duration={slot},adelay={start * 1000}:all=1"
        label = f"segment{index}"
        filters.append(f"[{index}:a]{chain}[{label}]")
        labels.append(f"[{label}]")
    filters.append(
        "".join(labels)
        + f"amix=inputs={len(labels)}:duration=longest:dropout_transition=0:normalize=0,"
        + "atrim=duration=54[mixed]"
    )
    command.extend(
        (
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[mixed]",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(output),
        )
    )
    return command


def synthesize_timeline_narration(
    captions,
    api_key,
    workspace,
    output,
    *,
    tts_func=synthesize_narration,
    runner=subprocess.run,
):
    segments = []
    durations = []
    for index, caption in enumerate(captions):
        segment = workspace / f"narration-{index:02d}.wav"
        tts_func(
            caption,
            api_key.strip(),
            segment,
            model=os.environ.get("GEMINI_TTS_MODEL"),
            runner=runner,
        )
        segments.append(segment)
        durations.append(_wav_duration(segment))
    command = build_aligned_narration_command(segments, durations, output)
    run_ffmpeg(command, runner=runner, stage="narration alignment")
    return output


def render_video(
    project_dir,
    manifest,
    config,
    api_key,
    output,
    *,
    tts_func=synthesize_narration,
    frames_func=render_frames,
    runner=subprocess.run,
    prebuilt_narration=None,
):
    if prebuilt_narration is None and (not isinstance(api_key, str) or not api_key.strip()):
        raise ValueError("Gemini API key is required")
    project_dir = Path(project_dir)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    script = build_script(manifest)
    bgm = _bgm_asset(project_dir)

    with tempfile.TemporaryDirectory(prefix="ranking-shorts-") as temporary:
        workspace = Path(temporary)
        narration = workspace / "narration.wav"
        frames_dir = workspace / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        if prebuilt_narration is not None:
            source = Path(prebuilt_narration)
            if not source.is_file():
                raise ValueError("prebuilt narration is missing")
            validate_prebuilt_narration(source)
            shutil.copyfile(source, narration)
        else:
            synthesize_timeline_narration(
                script.captions,
                api_key,
                workspace,
                narration,
                tts_func=tts_func,
                runner=runner,
            )
        frames = frames_func(
            project_dir,
            manifest,
            config,
            frames_dir,
            runner=runner,
        )
        command = build_ffmpeg_command(frames, narration, bgm, output, config)
        run_ffmpeg(command, runner=runner, stage="render")
    if not output.is_file():
        raise RuntimeError("ffmpeg render did not create output")
    return output
