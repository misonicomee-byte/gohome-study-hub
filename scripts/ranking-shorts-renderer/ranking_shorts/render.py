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
from .frames import (
    display_title,
    fit_asset,
    pixel_lines,
    render_rank_frame,
    render_transition_frame,
)
from .layout import load_font, safe_area


TIMELINE = (
    ("hook", 0, 4),
    ("rank3", 4, 13),
    ("rank2", 13, 22),
    ("rank1", 22, 32),
    ("outro", 32, 42),
)
TOTAL_SECONDS = TIMELINE[-1][2]
VIDEO_SUFFIXES = frozenset({".mp4", ".mov", ".m4v", ".webm"})
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})
MAX_ASSET_SECONDS = TOTAL_SECONDS
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


def _spoken_title(text):
    compact = display_title(text, 36)
    compact = re.sub(r"^【[^】]{1,24}】", "", compact).strip()
    return compact[:20].rstrip("、。・:： ")


def build_script(manifest):
    ordered = tuple(sorted(manifest.items, key=lambda item: item.rank, reverse=True))
    is_podcast = manifest.channel == "podcast"
    hook = (
        f"{int(manifest.month.split('-', 1)[1])}月、ポッドキャストトップ3。"
        if is_podcast
        else f"{int(manifest.month.split('-', 1)[1])}月、人気トップ3。"
    )
    captions = [hook]
    captions.extend(
        (
            f"第{item.rank}位。{_naturalize_months(_spoken_title(item.title))}。"
            f"前月は、{_metric_text(item.metric_value)}回増えました。"
            if is_podcast
            else f"第{item.rank}位。{_naturalize_months(_spoken_title(item.title))}。"
            f"{_metric_text(item.metric_value)}回でした。"
        )
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
        return (0, 4, 13, 22)
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


def _seedance_asset(project_dir):
    candidates = [
        path
        for path in Path(project_dir).glob("seedance.*")
        if path.suffix.lower() in VIDEO_SUFFIXES
    ]
    if len(candidates) > 1:
        raise ValueError("project allows at most one Seedance motion clip")
    return candidates[0] if candidates else None


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
        title_width = config.width - margin - round(16 * scale) - text_left
        title = "\n".join(
            pixel_lines(
                draw,
                display_title(items[rank].title, 36),
                body_font,
                title_width,
                3,
            )
        )
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


def render_hook_frame(manifest, config, seedance_frame=None):
    canvas = (config.width, config.height)
    frame = (
        fit_asset(seedance_frame, canvas)
        if seedance_frame is not None
        else Image.new("RGB", canvas, "#111827")
    )
    if seedance_frame is not None:
        shade = Image.new("RGBA", canvas, (7, 15, 29, 150))
        frame = Image.alpha_composite(frame.convert("RGBA"), shade).convert("RGB")
    draw = ImageDraw.Draw(frame)
    scale = config.width / 1080
    month = _spoken_month(manifest.month)
    channel = {
        "youtube": "YouTube Shorts",
        "blog": "BLOG",
        "instagram": "Instagram",
        "podcast": "PODCAST",
    }.get(manifest.channel, "MONTHLY NEWS")
    eyebrow = load_font(round(34 * scale))
    headline = load_font(round(82 * scale))
    number = load_font(round(210 * scale))
    center_x = config.width // 2
    draw.text((center_x, round(420 * scale)), channel, font=eyebrow, fill="#94a3b8", anchor="mm")
    draw.text((center_x, round(535 * scale)), month, font=headline, fill="white", anchor="mm")
    draw.text((center_x, round(810 * scale)), "TOP", font=headline, fill="white", anchor="mm")
    draw.text((center_x, round(1110 * scale)), "3", font=number, fill="#facc15", anchor="mm")
    draw.text((center_x, round(1390 * scale)), "人気コンテンツランキング", font=eyebrow, fill="#cbd5e1", anchor="mm")
    return frame


def render_cta_frame(manifest, config):
    canvas = (config.width, config.height)
    frame = Image.new("RGB", canvas, "#111827")
    draw = ImageDraw.Draw(frame)
    scale = config.width / 1080
    center_x = config.width // 2
    eyebrow = load_font(round(34 * scale))
    headline = load_font(round(72 * scale))
    body = load_font(round(38 * scale))
    noun = "エピソード" if manifest.channel == "podcast" else "内容"
    draw.text((center_x, round(560 * scale)), "続きは概要欄から", font=headline, fill="white", anchor="mm")
    draw.text((center_x, round(720 * scale)), f"気になる{noun}をチェック", font=body, fill="#cbd5e1", anchor="mm")
    draw.rounded_rectangle(
        (
            round(150 * scale),
            round(930 * scale),
            config.width - round(150 * scale),
            round(1090 * scale),
        ),
        radius=round(36 * scale),
        fill="#facc15",
    )
    draw.text((center_x, round(1010 * scale)), "ごうホームクリニック", font=body, fill="#111827", anchor="mm")
    draw.text((center_x, round(1280 * scale)), "gohome-clinic.com", font=eyebrow, fill="#94a3b8", anchor="mm")
    return frame


def render_frames(project_dir, manifest, config, directory, *, runner=subprocess.run):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
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
    seedance_asset = _seedance_asset(project_dir)
    seedance_frames = (
        materialize_asset_frames(
            seedance_asset,
            directory.parent / "asset-seedance",
            config,
            runner=runner,
        )
        if seedance_asset is not None
        else ()
    )
    background = Image.new("RGB", (config.width, config.height), "#111827")
    starts = set(special_transition_starts(config))
    total_frames = TIMELINE[-1][2] * config.fps

    for frame_index in range(total_frames):
        seconds = frame_index / config.fps
        _, name = _timeline_entry(seconds)
        transition_start = next(
            (start for start in starts if start <= seconds < start + 0.8),
            None,
        )
        seedance_frame = (
            _asset_image(seedance_frames, frame_index)
            if seedance_frames
            else None
        )
        if name == "hook":
            hook = render_hook_frame(manifest, config, seedance_frame)
            if transition_start is not None:
                frame = render_transition_frame(
                    f"{_spoken_month(manifest.month)} TOP3",
                    hook,
                    background,
                    (seconds - transition_start) / 0.8,
                    config,
                )
            else:
                frame = hook
            frame.save(directory / f"frame-{frame_index + 1:06d}.png")
            continue
        if name == "outro":
            frame = (
                render_outro_frame(manifest, materialized, config)
                if seconds < 38
                else render_cta_frame(manifest, config)
            )
            frame.save(directory / f"frame-{frame_index + 1:06d}.png")
            continue

        rank = 3 if name == "rank3" else 2 if name == "rank2" else 1
        item = items[rank]
        local_frame = scene_frame_number(name, frame_index, config.fps)
        asset = _asset_image(materialized[rank], local_frame)

        if transition_start is not None:
            next_frame = fit_asset(asset, (config.width, config.height))
            frame = render_transition_frame(
                f"第{rank}位",
                next_frame,
                seedance_frame if seedance_frame is not None else background,
                (seconds - transition_start) / 0.8,
                config,
            )
        else:
            frame = render_rank_frame(manifest, item, asset, seconds, config)
        frame.save(directory / f"frame-{frame_index + 1:06d}.png")
    return directory / "frame-%06d.png"


def build_ffmpeg_command(frames, narration, bgm, output, config):
    filter_complex = (
        f"[1:a]apad,atrim=duration={TOTAL_SECONDS}[narration];"
        f"[2:a]volume=0.18,apad,atrim=duration={TOTAL_SECONDS}[bgm];"
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
        str(TOTAL_SECONDS),
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
        raise RuntimeError(f"prebuilt narration must be exactly {TOTAL_SECONDS} seconds")
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
        + f"atrim=duration={TOTAL_SECONDS}[mixed]"
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
