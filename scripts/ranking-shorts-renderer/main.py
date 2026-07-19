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

from ranking_shorts.model import MOTIONS, PLACEMENTS, RankingManifest, RenderConfig
from ranking_shorts.qa import run_qa
from ranking_shorts.render import IMAGE_SUFFIXES, TIMELINE, VIDEO_SUFFIXES, build_script, render_video


BGM_SUFFIXES = frozenset({".wav", ".mp3", ".m4a", ".aac"})
CLINIC_URL = "https://gohome-clinic.com/"


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

    lexical_output = Path(os.path.abspath(args.out.expanduser()))
    if lexical_output.suffix.lower() != ".mp4":
        raise ValueError("output must use the .mp4 extension")
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
    )


def _publication_files(manifest, post_caption, captions_json):
    script = build_script(manifest)
    title = f"{manifest.month} 人気コンテンツTOP3"
    description = (
        f"{manifest.month}の人気コンテンツTOP3を、"
        f"{manifest.ranking_label}にもとづいてご紹介します。"
        "詳細は公式チャンネルとサイトでご覧ください。"
    )
    copy = (
        f"■タイトル\n{title}\n\n■説明文\n{description}\n\n"
        f"ごうホームクリニック\n{CLINIC_URL}\n\n"
        "※本動画はAIを活用して制作しています。掲載情報は公式情報をご確認ください。\n\n"
        "#ごうホームクリニック #訪問診療 #在宅医療 #人気コンテンツ\n"
    )
    post_caption.write_text(copy, encoding="utf-8")
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
