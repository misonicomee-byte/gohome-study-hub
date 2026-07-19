#!/usr/bin/env python3
"""Strict CLI for rendering and promoting ranking Shorts."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from dataclasses import replace
from pathlib import Path

from ranking_shorts.model import (
    INITIAL_MONTH_RANKING_MODE,
    MOTIONS,
    PLACEMENTS,
    RankingManifest,
    RenderConfig,
)
from ranking_shorts.qa import run_qa
from ranking_shorts.render import IMAGE_SUFFIXES, TIMELINE, VIDEO_SUFFIXES, build_script, render_video


BGM_SUFFIXES = frozenset({".wav", ".mp3", ".m4a", ".aac"})
CLINIC_URL = "https://gohome-clinic.com/"
CHANNEL_LABELS = {
    "youtube": "YouTube Shorts",
    "blog": "ブログ",
    "instagram": "Instagram",
    "podcast": "Podcast",
}
CHANNEL_DESCRIPTION_LABELS = {
    "youtube": "YouTube Shorts",
    "blog": "ブログ",
    "instagram": "Instagram",
    "podcast": "ポッドキャスト",
}
CHANNEL_TAGS = {
    "youtube": "#YouTubeShorts",
    "blog": "#クリニックブログ",
    "instagram": "#Instagram",
    "podcast": "#ポッドキャスト",
}


@dataclass(frozen=True, slots=True)
class Context:
    manifest: RankingManifest
    config: RenderConfig
    assets: dict[int, Path]
    bgm: Path
    output: Path
    draft: Path
    report: Path
    sheet: Path
    draft_report: Path
    draft_sheet: Path
    post_caption: Path
    captions_json: Path
    draft_parent: Path
    lock: Path
    api_key: str
    narration: Path | None
    seedance: Path | None


def build_parser():
    parser = argparse.ArgumentParser(description="Render a QA-gated monthly ranking Short")
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--assets", required=True, type=Path)
    parser.add_argument("--placement", required=True, choices=sorted(PLACEMENTS))
    parser.add_argument("--motion", required=True, choices=sorted(MOTIONS))
    parser.add_argument("--resolution", required=True, choices=("1080x1920", "720x1280"))
    parser.add_argument("--bgm", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--narration", type=Path, help="prebuilt WAV for offline/test rendering")
    parser.add_argument("--seedance", type=Path, help="optional Seedance motion clip for hook and chapter backgrounds")
    return parser


def discover_rank_assets(directory):
    directory = Path(directory)
    if not directory.is_dir():
        raise ValueError("assets directory is missing")
    result = {}
    for rank in (1, 2, 3):
        matches = [
            path.resolve()
            for path in directory.glob(f"rank-{rank}.*")
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES | VIDEO_SUFFIXES
        ]
        if len(matches) != 1:
            raise ValueError(f"rank-{rank} requires exactly one image or video asset")
        result[rank] = matches[0]
    return result


def _absent(path):
    if os.path.lexists(path):
        raise ValueError(f"output already exists: {Path(path).name}")


def _reject_symlinked_output_parent(output, manifest):
    output = Path(output)
    manifest_parent = Path(manifest).parent
    shared_parent = Path(os.path.commonpath((output, manifest_parent)))
    current = shared_parent
    for component in output.parent.relative_to(shared_parent).parts:
        current /= component
        if current.is_symlink():
            raise ValueError("output parent must not contain a symlink")


@contextmanager
def exclusive_reservation(lock):
    lock = Path(lock)
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise ValueError("render is already running for this output") from None
    except OSError:
        raise RuntimeError("could not reserve output") from None
    try:
        yield
    finally:
        os.close(descriptor)
        lock.unlink(missing_ok=True)


def _candidate_targets(context):
    return (
        context.output,
        context.report,
        context.sheet,
        context.post_caption,
        context.captions_json,
    )


def preflight(args, environ=os.environ, which=shutil.which):
    manifest_path = args.manifest.expanduser().resolve()
    if not manifest_path.is_file():
        raise ValueError("manifest is missing")
    manifest = RankingManifest.from_path(manifest_path)
    width, height = (int(value) for value in args.resolution.split("x", 1))
    config = RenderConfig(width, height, placement=args.placement, motion=args.motion)
    assets = discover_rank_assets(args.assets.expanduser().resolve())
    bgm = args.bgm.expanduser().resolve()
    if not bgm.is_file() or bgm.suffix.lower() not in BGM_SUFFIXES:
        raise ValueError("BGM must be an existing supported audio file")
    for tool in ("ffmpeg", "ffprobe"):
        if which(tool) is None:
            raise ValueError(f"required tool is missing: {tool}")
    narration = args.narration.expanduser().resolve() if args.narration else None
    if narration is not None and not narration.is_file():
        raise ValueError("prebuilt narration is missing")
    api_key = environ.get("GEMINI_API_KEY", "").strip()
    if narration is None and not api_key:
        raise ValueError("GEMINI_API_KEY is required without --narration")
    seedance = args.seedance.expanduser().resolve() if args.seedance else None
    if seedance is not None and (
        not seedance.is_file() or seedance.suffix.lower() not in VIDEO_SUFFIXES
    ):
        raise ValueError("Seedance clip must be an existing supported video file")

    lexical_output = Path(os.path.abspath(args.out.expanduser()))
    if lexical_output.suffix.lower() != ".mp4":
        raise ValueError("output must use the .mp4 extension")
    _reject_symlinked_output_parent(lexical_output, args.manifest.expanduser().absolute())
    lexical_targets = (
        lexical_output,
        lexical_output.with_suffix(".qa.json"),
        lexical_output.with_name(lexical_output.stem + "-qa-sheet.jpg"),
        lexical_output.parent / "post_caption.txt",
        lexical_output.parent / "captions.json",
    )
    for target in lexical_targets:
        _absent(target)

    output = lexical_output.resolve()
    draft_parent = output.parent.parent / "draft" if output.parent.name == "candidate" else output.parent / "draft"
    draft = draft_parent / output.name
    report = output.with_suffix(".qa.json")
    sheet = output.with_name(output.stem + "-qa-sheet.jpg")
    draft_report = draft.with_suffix(".qa.json")
    draft_sheet = draft.with_name(draft.stem + "-qa-sheet.jpg")
    post_caption = output.parent / "post_caption.txt"
    captions_json = output.parent / "captions.json"
    lock = output.parent / f".{output.name}.lock"
    for target in (output, report, sheet, post_caption, captions_json):
        _absent(target)
    return Context(
        manifest=manifest,
        config=config,
        assets=assets,
        bgm=bgm,
        output=output,
        draft=draft,
        report=report,
        sheet=sheet,
        draft_report=draft_report,
        draft_sheet=draft_sheet,
        post_caption=post_caption,
        captions_json=captions_json,
        draft_parent=draft_parent,
        lock=lock,
        api_key=api_key,
        narration=narration,
        seedance=seedance,
    )


def _japanese_month(month):
    year, number = month.split("-", 1)
    return f"{int(year)}年{int(number)}月"


def _post_caption(manifest):
    month = _japanese_month(manifest.month)
    channel_label = CHANNEL_LABELS[manifest.channel]
    description_label = CHANNEL_DESCRIPTION_LABELS[manifest.channel]
    if manifest.ranking_mode == INITIAL_MONTH_RANKING_MODE:
        lead = (
            f"{month}に公開された{description_label}投稿を、現在の閲覧数で集計したTOP3です。"
            f"初回限定の集計で、{month}中の増加数ではありません。"
        )
        ranking_label = (
            f"{month}公開投稿の現在の閲覧数（初回限定・月内の増加数ではありません）"
        )
    elif manifest.channel == "podcast":
        lead = f"{month}のポッドキャスト前月増加再生数TOP3をご紹介します。"
        ranking_label = "前月増加再生数"
    else:
        lead = f"{month}に多く見られた{description_label}コンテンツTOP3をご紹介します。"
        ranking_label = manifest.ranking_label.replace(manifest.month, month)
    ranking_lines = "\n\n".join(
        f"{item.rank}位 {item.title}\n{item.url}" for item in manifest.items
    )
    title_suffix = (
        "前月増加再生数TOP3"
        if manifest.channel == "podcast"
        else "人気コンテンツTOP3"
    )
    title = f"【{month}】{channel_label} {title_suffix}"
    description = "\n\n".join(
        (
            lead,
            f"集計指標：{ranking_label}",
            ranking_lines,
            f"ごうホームクリニック\n{CLINIC_URL}",
            "※本動画はAIを活用して制作しています。掲載情報は公式情報をご確認ください。",
            "#ごうホームクリニック #訪問診療 #在宅医療 #人気コンテンツ "
            f"{CHANNEL_TAGS[manifest.channel]}",
        )
    )
    return f"■タイトル\n{title}\n\n■説明文\n{description}\n"


def _publication_files(manifest, post_caption, captions_json):
    script = build_script(manifest)
    post_caption.write_text(_post_caption(manifest), encoding="utf-8")
    captions = [
        {"start": start, "end": end, "text": script.captions[index]}
        for index, (_, start, end) in enumerate(TIMELINE)
    ]
    captions_json.write_text(json.dumps(captions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _promote(context):
    context.output.parent.mkdir(parents=True, exist_ok=True)
    staged_post = context.draft.parent / "post_caption.txt"
    staged_captions = context.draft.parent / "captions.json"
    _publication_files(context.manifest, staged_post, staged_captions)
    pairs = (
        (context.draft_report, context.report),
        (context.draft_sheet, context.sheet),
        (staged_post, context.post_caption),
        (staged_captions, context.captions_json),
        (context.draft, context.output),
    )
    created = []
    try:
        for source, destination in pairs:
            os.link(source, destination)
            created.append(destination)
    except OSError:
        for destination in reversed(created):
            destination.unlink(missing_ok=True)
        raise RuntimeError("candidate promotion failed; draft retained") from None
    for source, _ in pairs:
        source.unlink()


def run_cli(argv=None, *, environ=os.environ, which=shutil.which, render_func=render_video, qa_func=run_qa):
    context = preflight(build_parser().parse_args(argv), environ=environ, which=which)
    with exclusive_reservation(context.lock):
        for target in _candidate_targets(context):
            _absent(target)
        context.draft_parent.mkdir(parents=True, exist_ok=True)
        run_directory = Path(
            tempfile.mkdtemp(prefix=f"{context.output.stem}-", dir=context.draft_parent)
        )
        runtime = replace(
            context,
            draft=run_directory / context.output.name,
            draft_report=(run_directory / context.output.name).with_suffix(".qa.json"),
            draft_sheet=(run_directory / context.output.name).with_name(
                context.output.stem + "-qa-sheet.jpg"
            ),
        )
        with tempfile.TemporaryDirectory(prefix="ranking-shorts-input-") as temporary:
            project = Path(temporary)
            for rank, asset in runtime.assets.items():
                (project / f"rank-{rank}{asset.suffix.lower()}").symlink_to(asset)
            (project / f"bgm{runtime.bgm.suffix.lower()}").symlink_to(runtime.bgm)
            if runtime.seedance is not None:
                (project / f"seedance{runtime.seedance.suffix.lower()}").symlink_to(runtime.seedance)
            render_func(
                project,
                runtime.manifest,
                runtime.config,
                runtime.api_key,
                runtime.draft,
                prebuilt_narration=runtime.narration,
            )
        qa_func(runtime.draft, runtime.config, runtime.draft_report, runtime.draft_sheet)
        _promote(runtime)
        run_directory.rmdir()
        return runtime.output


def main():
    try:
        result = run_cli()
    except (ValueError, RuntimeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
