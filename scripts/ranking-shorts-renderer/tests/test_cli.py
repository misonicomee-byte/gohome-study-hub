import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from ranking_shorts.model import RenderConfig
from ranking_shorts.qa import QaError, run_qa


REPO = Path(__file__).resolve().parents[3]
CLI_PATH = REPO / "scripts/ranking-shorts-renderer/main.py"
DOC_PATH = REPO / "docs/fal-seedance-ranking-shorts.md"


def load_cli():
    spec = importlib.util.spec_from_file_location("ranking_shorts_cli", CLI_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def valid_manifest():
    return {
        "schemaVersion": 1,
        "channel": "youtube",
        "period": {
            "month": "2026-06",
            "startDate": "2026-06-01",
            "endDate": "2026-06-30",
            "timezone": "Asia/Tokyo",
        },
        "rankingMetric": "views",
        "rankingLabel": "6月の再生回数",
        "generatedAt": "2026-07-05T09:00:00+09:00",
        "items": [
            {
                "rank": rank,
                "contentId": f"video-{rank}",
                "title": f"タイトル{rank}",
                "url": f"https://example.test/{rank}",
                "publishedAt": "2026-05-20",
                "metricValue": 4000 - rank,
                "secondaryMetricValue": 100,
            }
            for rank in (1, 2, 3)
        ],
    }


def probe_payload(width=720, height=1280, fps="30/1", duration="54.0"):
    return {
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "h264",
                "width": width,
                "height": height,
                "avg_frame_rate": fps,
            },
            {"codec_type": "audio", "codec_name": "aac"},
        ],
        "format": {"duration": duration},
    }


class CliTests(unittest.TestCase):
    def setUp(self):
        self.cli = load_cli()

    def make_project(self, root, *, video_rank=None):
        manifest = root / "ranking.json"
        manifest.write_text(json.dumps(valid_manifest()), encoding="utf-8")
        assets = root / "assets"
        assets.mkdir()
        for rank in (1, 2, 3):
            if rank == video_rank:
                (assets / f"rank-{rank}.mp4").write_bytes(b"synthetic-video")
            else:
                Image.new("RGB", (32, 24), (rank * 50, 20, 20)).save(
                    assets / f"rank-{rank}.png"
                )
        bgm = root / "licensed-bgm.wav"
        bgm.write_bytes(b"synthetic-bgm")
        narration = root / "narration.wav"
        narration.write_bytes(b"synthetic-narration")
        return manifest, assets, bgm, narration

    def argv(self, manifest, assets, bgm, output, narration=None):
        values = [
            "--manifest", str(manifest),
            "--assets", str(assets),
            "--placement", "chapter",
            "--motion", "split-reveal",
            "--resolution", "720x1280",
            "--bgm", str(bgm),
            "--out", str(output),
        ]
        if narration is not None:
            values.extend(["--narration", str(narration)])
        return values

    def test_parser_rejects_unknown_options(self):
        with self.assertRaises(SystemExit):
            self.cli.build_parser().parse_args(["--unknown", "x"])

    def test_preflight_requires_tools_key_bgm_and_absent_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, assets, bgm, _ = self.make_project(root)
            output = root / "candidate" / "video.mp4"
            args = self.cli.build_parser().parse_args(
                self.argv(manifest, assets, bgm, output)
            )

            with self.assertRaisesRegex(ValueError, "GEMINI_API_KEY"):
                self.cli.preflight(args, environ={}, which=lambda name: f"/bin/{name}")
            with self.assertRaisesRegex(ValueError, "ffprobe"):
                self.cli.preflight(
                    args,
                    environ={"GEMINI_API_KEY": "test-key"},
                    which=lambda name: None if name == "ffprobe" else f"/bin/{name}",
                )
            bgm.unlink()
            with self.assertRaisesRegex(ValueError, "BGM"):
                self.cli.preflight(
                    args,
                    environ={"GEMINI_API_KEY": "test-key"},
                    which=lambda name: f"/bin/{name}",
                )
            bgm.write_bytes(b"synthetic-bgm")
            output.parent.mkdir()
            output.write_bytes(b"existing")
            with self.assertRaisesRegex(ValueError, "already exists"):
                self.cli.preflight(
                    args,
                    environ={"GEMINI_API_KEY": "test-key"},
                    which=lambda name: f"/bin/{name}",
                )

    def test_preflight_rejects_existing_broken_output_symlink_before_resolve(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, assets, bgm, narration = self.make_project(root)
            output = root / "candidate" / "video.mp4"
            output.parent.mkdir()
            output.symlink_to(root / "missing-target.mp4")
            args = self.cli.build_parser().parse_args(
                self.argv(manifest, assets, bgm, output, narration)
            )

            with self.assertRaisesRegex(ValueError, "already exists"):
                self.cli.preflight(args, environ={}, which=lambda name: f"/bin/{name}")

    def test_exclusive_reservation_rejects_a_concurrent_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            lock = Path(temporary) / ".video.mp4.lock"
            with self.cli.exclusive_reservation(lock):
                with self.assertRaisesRegex(ValueError, "already running"):
                    with self.cli.exclusive_reservation(lock):
                        self.fail("concurrent reservation unexpectedly succeeded")
            self.assertFalse(lock.exists())

    def test_rank_asset_discovery_accepts_images_and_videos_but_rejects_duplicates(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            _, assets, _, _ = self.make_project(root, video_rank=2)
            discovered = self.cli.discover_rank_assets(assets)
            self.assertEqual(discovered[2].suffix, ".mp4")

            (assets / "rank-2.png").write_bytes(b"duplicate")
            with self.assertRaisesRegex(ValueError, "rank-2.*exactly one"):
                self.cli.discover_rank_assets(assets)

    def test_prebuilt_narration_allows_network_free_preflight(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, assets, bgm, narration = self.make_project(root)
            output = root / "candidate" / "video.mp4"
            args = self.cli.build_parser().parse_args(
                self.argv(manifest, assets, bgm, output, narration)
            )
            context = self.cli.preflight(
                args, environ={}, which=lambda name: f"/bin/{name}"
            )
            self.assertEqual(context.narration, narration.resolve())

    def test_success_promotes_only_after_qa_and_removes_draft(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, assets, bgm, narration = self.make_project(root)
            output = root / "candidate" / "video.mp4"
            events = []

            def fake_render(project, parsed_manifest, config, key, draft, **kwargs):
                del project, parsed_manifest, config, key
                events.append("render")
                events.append(("prebuilt", kwargs.get("prebuilt_narration")))
                events.append(("draft", draft))
                draft.parent.mkdir(parents=True, exist_ok=True)
                draft.write_bytes(b"synthetic-mp4")
                return draft

            def fake_qa(video, config, report_path, sheet_path, **kwargs):
                del config, kwargs
                events.append("qa")
                self.assertTrue(video.is_file())
                report_path.write_text('{"passed":true}', encoding="utf-8")
                Image.new("RGB", (32, 24), "white").save(sheet_path)
                return SimpleQa(report_path, sheet_path)

            result = self.cli.run_cli(
                self.argv(manifest, assets, bgm, output, narration),
                environ={},
                which=lambda name: f"/bin/{name}",
                render_func=fake_render,
                qa_func=fake_qa,
            )

            draft_event = next(
                event[1]
                for event in events
                if isinstance(event, tuple) and event[0] == "draft"
            )
            self.assertEqual(events[0], "render")
            self.assertEqual(events[1], ("prebuilt", narration.resolve()))
            self.assertEqual(events[-1], "qa")
            self.assertEqual(draft_event.parent.parent, root.resolve() / "draft")
            self.assertNotEqual(draft_event.parent, root.resolve() / "draft")
            self.assertFalse(draft_event.parent.exists())
            self.assertEqual(result, output.resolve())
            self.assertTrue(output.is_file())
            self.assertTrue(output.with_suffix(".qa.json").is_file())
            self.assertTrue(output.with_name("video-qa-sheet.jpg").is_file())
            post_caption = output.parent / "post_caption.txt"
            captions_json = output.parent / "captions.json"
            self.assertTrue(post_caption.is_file())
            self.assertTrue(captions_json.is_file())
            copy = post_caption.read_text(encoding="utf-8")
            self.assertRegex(
                copy,
                r"\A■タイトル\n.+\n\n■説明文\n.+\n\n"
                r"ごうホームクリニック\nhttps://gohome-clinic\.com/\n\n"
                r"※.+AI.+\n\n#.+\n\Z",
            )
            self.assertNotIn("治ります", copy)
            captions = json.loads(captions_json.read_text(encoding="utf-8"))
            self.assertEqual(captions[0]["start"], 0)
            self.assertEqual(captions[-1]["end"], 54)
            self.assertFalse((root / "draft" / "video.mp4").exists())

    def test_qa_failure_keeps_draft_and_never_creates_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest, assets, bgm, narration = self.make_project(root)
            output = root / "candidate" / "video.mp4"

            def fake_render(project, parsed_manifest, config, key, draft, **kwargs):
                del project, parsed_manifest, config, key, kwargs
                draft.parent.mkdir(parents=True, exist_ok=True)
                draft.write_bytes(b"synthetic-mp4")
                return draft

            def failing_qa(video, config, report_path, sheet_path, **kwargs):
                del video, config, report_path, sheet_path, kwargs
                raise QaError("QA validation failed")

            with self.assertRaisesRegex(QaError, "QA validation failed"):
                self.cli.run_cli(
                    self.argv(manifest, assets, bgm, output, narration),
                    environ={},
                    which=lambda name: f"/bin/{name}",
                    render_func=fake_render,
                    qa_func=failing_qa,
                )
            retained = list((root / "draft").glob("*/video.mp4"))
            self.assertEqual(len(retained), 1)
            self.assertTrue(retained[0].is_file())
            self.assertFalse(output.exists())
            self.assertFalse((output.parent / "post_caption.txt").exists())
            self.assertFalse((output.parent / "captions.json").exists())

    def test_documentation_covers_seedance_placements_and_bgm_license_boundary(self):
        text = DOC_PATH.read_text(encoding="utf-8")
        for required in (
            "rank-1.mp4",
            "Seedance",
            "fal-seedance",
            "hook",
            "chapter",
            "none",
            "日本語",
            "ライセンス",
            "procedural BGM generation is outside this workflow",
            "post_caption.txt",
            "captions.json",
        ):
            self.assertIn(required, text)


class QaTests(unittest.TestCase):
    def fake_runner(
        self,
        payload,
        *,
        black=False,
        decode_failure=False,
        contact_frames=27,
        calls=None,
    ):
        def runner(command, **kwargs):
            del kwargs
            if calls is not None:
                calls.append(command)
            if command[0] == "ffprobe":
                return subprocess.CompletedProcess(
                    command, 0, json.dumps(payload).encode("utf-8"), b""
                )
            joined = " ".join(map(str, command))
            if "blackdetect" in joined:
                stderr = b"black_start:0 black_end:2 black_duration:2" if black else b""
                return subprocess.CompletedProcess(command, 0, b"", stderr)
            if "fps=1/2" in joined:
                pattern = Path(command[-1])
                pattern.parent.mkdir(parents=True, exist_ok=True)
                for index in range(1, contact_frames + 1):
                    Image.new("RGB", (72, 128), (index * 40, 20, 20)).save(
                        pattern.parent / f"frame-{index:03d}.jpg"
                    )
                return subprocess.CompletedProcess(command, 0, b"", b"")
            if decode_failure:
                raise subprocess.CalledProcessError(1, command, stderr=b"private stderr")
            return subprocess.CompletedProcess(command, 0, b"", b"")

        return runner

    def test_qa_writes_sha_report_and_contact_sheet_after_all_checks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "draft.mp4"
            video.write_bytes(b"synthetic-mp4")
            report = root / "draft.qa.json"
            sheet = root / "draft-qa-sheet.jpg"
            calls = []
            result = run_qa(
                video,
                RenderConfig(720, 1280),
                report,
                sheet,
                runner=self.fake_runner(probe_payload(), calls=calls),
            )
            body = json.loads(report.read_text(encoding="utf-8"))
            self.assertTrue(body["passed"])
            self.assertEqual(len(body["sha256"]), 64)
            self.assertEqual(body["duration"], 54.0)
            self.assertEqual(body["blackSegments"], [])
            self.assertTrue(sheet.is_file())
            self.assertEqual(result.report_path, report)
            decode = next(
                command
                for command in calls
                if command[0] == "ffmpeg" and "-map" in command
            )
            self.assertIn("-xerror", decode)

    def test_qa_rejects_incomplete_contact_sheet(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "draft.mp4"
            video.write_bytes(b"synthetic-mp4")
            with self.assertRaisesRegex(QaError, "27"):
                run_qa(
                    video,
                    RenderConfig(720, 1280),
                    root / "report.json",
                    root / "sheet.jpg",
                    runner=self.fake_runner(probe_payload(), contact_frames=26),
                )

    def test_qa_rejects_stream_fps_dimension_duration_and_black_failures(self):
        invalid = [
            ({**probe_payload(), "streams": []}, "stream"),
            (probe_payload(fps="30000/1001"), "30fps"),
            (probe_payload(width=1080), "dimensions"),
            (probe_payload(duration="55.0"), "duration"),
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "draft.mp4"
            video.write_bytes(b"synthetic-mp4")
            for index, (payload, message) in enumerate(invalid):
                with self.subTest(message=message):
                    with self.assertRaisesRegex(QaError, message):
                        run_qa(
                            video,
                            RenderConfig(720, 1280),
                            root / f"report-{index}.json",
                            root / f"sheet-{index}.jpg",
                            runner=self.fake_runner(payload),
                        )
            with self.assertRaisesRegex(QaError, "black"):
                run_qa(
                    video,
                    RenderConfig(720, 1280),
                    root / "black.json",
                    root / "black.jpg",
                    runner=self.fake_runner(probe_payload(), black=True),
                )

    def test_full_decode_failure_is_sanitized(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            video = root / "draft.mp4"
            video.write_bytes(b"synthetic-mp4")
            with self.assertRaisesRegex(QaError, "full decode") as caught:
                run_qa(
                    video,
                    RenderConfig(720, 1280),
                    root / "report.json",
                    root / "sheet.jpg",
                    runner=self.fake_runner(probe_payload(), decode_failure=True),
                )
            self.assertNotIn("private stderr", str(caught.exception))


class SimpleQa:
    def __init__(self, report_path, sheet_path):
        self.report_path = report_path
        self.sheet_path = sheet_path


if __name__ == "__main__":
    unittest.main()
