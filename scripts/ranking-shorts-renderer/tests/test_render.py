import base64
import json
import math
import struct
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from ranking_shorts.audio import (
    PcmAudio,
    request_gemini_tts,
    write_trimmed_wav,
)
from ranking_shorts.model import RenderConfig
from ranking_shorts.render import (
    TIMELINE,
    build_ffmpeg_command,
    build_script,
    materialize_asset_frames,
    render_outro_frame,
    render_video,
    run_ffmpeg,
    scene_frame_number,
    special_transition_starts,
    validate_prebuilt_narration,
)


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return self.body


def fake_manifest():
    items = tuple(
        SimpleNamespace(rank=rank, title=f"タイトル{rank}", metric_value=rank * 1000)
        for rank in (1, 2, 3)
    )
    return SimpleNamespace(
        month="2026-06",
        ranking_label="6月の再生回数",
        items=items,
    )


class RenderTests(unittest.TestCase):
    def test_prebuilt_narration_requires_render_ready_pcm_wav_with_exact_duration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            valid = root / "valid.wav"
            with wave.open(str(valid), "wb") as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(44100)
                output.writeframes(b"\0" * (54 * 44100 * 2 * 2))
            self.assertEqual(validate_prebuilt_narration(valid), valid)

            invalid = root / "invalid.wav"
            invalid.write_bytes(b"not-a-wave-file")
            with self.assertRaisesRegex(RuntimeError, "prebuilt narration.*PCM WAV"):
                validate_prebuilt_narration(invalid)

            overlong = root / "overlong.wav"
            with wave.open(str(overlong), "wb") as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(44100)
                output.writeframes(b"\0" * (55 * 44100 * 2 * 2))
            with self.assertRaisesRegex(RuntimeError, "prebuilt narration.*54 seconds"):
                validate_prebuilt_narration(overlong)

    def test_timeline_is_54_seconds_without_gaps(self):
        self.assertEqual(
            TIMELINE,
            (
                ("hook", 0, 3),
                ("rank3", 3, 15),
                ("rank2", 15, 29),
                ("rank1", 29, 46),
                ("outro", 46, 54),
            ),
        )
        self.assertTrue(
            all(TIMELINE[index][2] == TIMELINE[index + 1][1] for index in range(4))
        )

    def test_script_preserves_exact_captions_in_reveal_order(self):
        script = build_script(fake_manifest())

        self.assertEqual([item.rank for item in script.items], [3, 2, 1])
        self.assertEqual(
            script.captions,
            (
                "2026年6月の人気コンテンツ、トップ3。",
                "第3位。タイトル3。6月の再生回数は、3,000回でした。",
                "第2位。タイトル2。6月の再生回数は、2,000回でした。",
                "第1位。タイトル1。6月の再生回数は、1,000回でした。",
                "気になる内容は、ごうホームクリニック公式チャンネルとサイトでご覧ください。",
            ),
        )

    def test_script_naturalizes_iso_months_everywhere_tts_reads(self):
        manifest = fake_manifest()
        manifest.ranking_label = "2026-06公開投稿の現在views"
        manifest.items[0].title = "2026-06のお知らせ"

        script = build_script(manifest)

        self.assertNotIn("2026-06", "\n".join(script.captions))
        self.assertIn("2026年6月公開投稿", script.captions[1])
        self.assertIn("2026年6月のお知らせ", script.captions[3])

    def test_special_transitions_follow_placement_and_never_exceed_two(self):
        expected = {"hook": (0,), "chapter": (15, 29), "none": ()}
        for placement, starts in expected.items():
            config = RenderConfig(placement=placement)
            self.assertEqual(special_transition_starts(config), starts)
            self.assertLessEqual(len(starts), 2)

    def test_gemini_tts_uses_header_key_kore_and_environment_model(self):
        secret = "test-api-key-must-not-leak"
        captured = {}
        response = {
            "candidates": [{
                "content": {"parts": [{
                    "inlineData": {
                        "mimeType": "audio/L16;codec=pcm;rate=24000",
                        "data": base64.b64encode(b"\x00\x00").decode("ascii"),
                    }
                }]}
            }]
        }

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse(json.dumps(response).encode("utf-8"))

        audio = request_gemini_tts(
            "こんにちは",
            secret,
            environ={"GEMINI_TTS_MODEL": "gemini-test-tts"},
            urlopen=fake_urlopen,
        )

        request = captured["request"]
        payload = json.loads(request.data)
        headers = {name.lower(): value for name, value in request.header_items()}
        self.assertEqual(audio, PcmAudio(b"\x00\x00", 24000))
        self.assertIn("gemini-test-tts:generateContent", request.full_url)
        self.assertNotIn(secret, request.full_url)
        self.assertEqual(headers["x-goog-api-key"], secret)
        self.assertEqual(
            payload["generationConfig"]["speechConfig"]["voiceConfig"]
            ["prebuiltVoiceConfig"]["voiceName"],
            "Kore",
        )

    def test_gemini_tts_errors_never_include_key_or_full_response(self):
        secret = "test-api-key-must-not-leak"
        response_secret = "response-body-must-not-leak"

        def malformed_response(request, timeout):
            del request, timeout
            return FakeResponse(json.dumps({"error": response_secret}).encode("utf-8"))

        with self.assertRaisesRegex(RuntimeError, "invalid Gemini TTS response") as caught:
            request_gemini_tts("こんにちは", secret, urlopen=malformed_response)
        self.assertNotIn(secret, str(caught.exception))
        self.assertNotIn(response_secret, str(caught.exception))

        with self.assertRaisesRegex(ValueError, "API key"):
            request_gemini_tts("こんにちは", "   ", urlopen=malformed_response)

    def test_pcm_conversion_matches_pipeline_format_and_trims_silence(self):
        sample_rate = 24000
        samples = []
        for index in range(int(sample_rate * 0.4)):
            seconds = index / sample_rate
            amplitude = 0 if seconds < 0.1 or seconds >= 0.3 else 12000
            samples.append(round(amplitude * math.sin(2 * math.pi * 440 * seconds)))
        pcm = b"".join(struct.pack("<h", sample) for sample in samples)

        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "narration.wav"
            write_trimmed_wav(PcmAudio(pcm, sample_rate), output)
            with wave.open(str(output), "rb") as result:
                self.assertEqual(result.getframerate(), 44100)
                self.assertEqual(result.getnchannels(), 2)
                self.assertEqual(result.getsampwidth(), 2)
                self.assertGreater(result.getnframes(), 0)
                self.assertLess(result.getnframes(), round(0.4 * 44100))

    def test_image_and_video_assets_materialize_without_network(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            image_path = root / "rank-1.png"
            Image.new("RGB", (32, 24), "red").save(image_path)
            self.assertEqual(
                materialize_asset_frames(image_path, root / "image", RenderConfig()),
                (image_path,),
            )

            video_path = root / "rank-2.mp4"
            video_path.write_bytes(b"synthetic-video-placeholder")
            calls = []

            def fake_runner(command, **kwargs):
                calls.append((command, kwargs))
                pattern = Path(command[-1])
                pattern.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (32, 24), "blue").save(
                    pattern.parent / "frame-000001.png"
                )
                return subprocess.CompletedProcess(command, 0, b"", b"")

            frames = materialize_asset_frames(
                video_path, root / "video", RenderConfig(), runner=fake_runner
            )
            self.assertEqual(len(frames), 1)
            self.assertEqual(frames[0].name, "frame-000001.png")
            self.assertIn("fps=30", calls[0][0])
            self.assertIn("-n", calls[0][0])
            self.assertNotIn("-y", calls[0][0])
            self.assertEqual(calls[0][0][calls[0][0].index("-t") + 1], "54")
            self.assertEqual(
                calls[0][0][calls[0][0].index("-frames:v") + 1], "1620"
            )

    def test_rank_assets_restart_at_local_frame_zero_for_each_scene(self):
        self.assertEqual(scene_frame_number("hook", 0, 30), 0)
        self.assertEqual(scene_frame_number("hook", 89, 30), 89)
        self.assertEqual(scene_frame_number("rank3", 90, 30), 0)
        self.assertEqual(scene_frame_number("rank2", 450, 30), 0)
        self.assertEqual(scene_frame_number("rank1", 870, 30), 0)

    def test_outro_uses_all_three_rank_assets(self):
        manifest = fake_manifest()
        materialized = {
            rank: (Path(f"rank-{rank}.png"),) for rank in (1, 2, 3)
        }
        seen = []

        def fake_asset_image(paths, frame_number):
            seen.append((paths[0].name, frame_number))
            rank = int(paths[0].stem[-1])
            return Image.new("RGB", (80, 80), (rank * 60, 20, 20))

        with patch("ranking_shorts.render._asset_image", side_effect=fake_asset_image):
            result = render_outro_frame(manifest, materialized, RenderConfig(720, 1280))

        self.assertEqual(result.size, (720, 1280))
        self.assertEqual(seen, [("rank-1.png", 0), ("rank-2.png", 0), ("rank-3.png", 0)])

    def test_ffmpeg_errors_are_structural_and_do_not_expose_stderr(self):
        secret = "stderr-secret-must-not-leak"

        def failing_runner(command, **kwargs):
            del kwargs
            raise subprocess.CalledProcessError(1, command, stderr=secret.encode())

        with self.assertRaisesRegex(RuntimeError, "ffmpeg render failed") as caught:
            run_ffmpeg(["ffmpeg", "-i", "input"], runner=failing_runner, stage="render")
        self.assertNotIn(secret, str(caught.exception))

    def test_final_ffmpeg_maps_one_video_and_one_mixed_audio_stream(self):
        command = build_ffmpeg_command(
            Path("frames/frame-%06d.png"),
            Path("narration.wav"),
            Path("bgm.wav"),
            Path("output.mp4"),
            RenderConfig(),
        )
        maps = [command[index + 1] for index, value in enumerate(command) if value == "-map"]
        self.assertEqual(maps, ["0:v:0", "[mixed]"])
        self.assertIn("amix=inputs=2", " ".join(command))
        self.assertIn("volume=0.18", " ".join(command))
        self.assertEqual(command.count("libx264"), 1)
        self.assertEqual(command.count("aac"), 1)
        self.assertIn("-n", command)
        self.assertNotIn("-y", command)

    def test_render_video_supports_injected_synthetic_audio_without_network(self):
        secret = "render-api-key-must-not-leak"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for rank in (1, 2, 3):
                Image.new("RGB", (32, 24), (rank * 50, 20, 20)).save(
                    root / f"rank-{rank}.png"
                )
            bgm = root / "bgm.wav"
            with wave.open(str(bgm), "wb") as target:
                target.setnchannels(2)
                target.setsampwidth(2)
                target.setframerate(44100)
                target.writeframes(b"\x00\x00\x00\x00" * 100)
            output = root / "draft.mp4"
            received = {}

            tts_calls = []

            def fake_tts(text, api_key, narration, **kwargs):
                tts_calls.append((text, api_key))
                with wave.open(str(narration), "wb") as target:
                    target.setnchannels(2)
                    target.setsampwidth(2)
                    target.setframerate(44100)
                    target.writeframes(b"\x00\x00\x00\x00" * 4410)

            def fake_frames(project, manifest, config, directory, **kwargs):
                del project, manifest, config, kwargs
                Image.new("RGB", (16, 16), "black").save(directory / "frame-000001.png")

            def fake_runner(command, **kwargs):
                del kwargs
                received.setdefault("commands", []).append(command)
                target = Path(command[-1])
                if target.suffix == ".wav":
                    with wave.open(str(target), "wb") as output_wav:
                        output_wav.setnchannels(2)
                        output_wav.setsampwidth(2)
                        output_wav.setframerate(44100)
                        output_wav.writeframes(b"\x00\x00\x00\x00" * 44100 * 54)
                else:
                    target.write_bytes(b"synthetic-mp4")
                return subprocess.CompletedProcess(command, 0, b"", b"")

            result = render_video(
                root,
                fake_manifest(),
                RenderConfig(),
                secret,
                output,
                tts_func=fake_tts,
                frames_func=fake_frames,
                runner=fake_runner,
            )

            self.assertEqual(result, output)
            self.assertTrue(output.exists())
            self.assertEqual(
                [text for text, _ in tts_calls], list(build_script(fake_manifest()).captions)
            )
            self.assertEqual([key for _, key in tts_calls], [secret] * len(TIMELINE))
            self.assertNotIn(
                secret,
                " ".join(str(part) for command in received["commands"] for part in command),
            )


if __name__ == "__main__":
    unittest.main()
