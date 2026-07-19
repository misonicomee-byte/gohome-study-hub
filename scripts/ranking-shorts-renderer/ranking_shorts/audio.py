from __future__ import annotations

import base64
import binascii
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path


DEFAULT_MODEL = "gemini-2.5-flash-preview-tts"
DEFAULT_STYLE = (
    "落ち着いた、温かく丁寧なトーンで、"
    "ゆったりしすぎず自然な速さで読み上げてください"
)
VOICE = "Kore"
SILENCE_FILTER = (
    "silenceremove=start_periods=1:start_threshold=-45dB,"
    "areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse"
)
_MODEL = re.compile(r"^[A-Za-z0-9._-]+$")
_RATE = re.compile(r"(?:^|;)rate=(\d+)(?:;|$)")


@dataclass(frozen=True, slots=True)
class PcmAudio:
    data: bytes
    sample_rate: int


def _resolved_model(model, environ):
    value = model if model is not None else environ.get("GEMINI_TTS_MODEL", DEFAULT_MODEL)
    if not isinstance(value, str) or not value.strip() or _MODEL.fullmatch(value.strip()) is None:
        raise ValueError("invalid Gemini TTS model")
    return value.strip()


def request_gemini_tts(
    text,
    api_key,
    *,
    model=None,
    style=DEFAULT_STYLE,
    environ=None,
    urlopen=urllib.request.urlopen,
):
    if not isinstance(api_key, str) or not api_key.strip():
        raise ValueError("Gemini API key is required")
    if not isinstance(text, str) or not text:
        raise ValueError("TTS text is required")
    environment = os.environ if environ is None else environ
    selected_model = _resolved_model(model, environment)
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{selected_model}:generateContent"
    )
    payload = {
        "contents": [{"parts": [{"text": f"{style}: {text}"}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": VOICE}}
            },
        },
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key.strip(),
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=120) as response:
            raw_body = response.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError):
        raise RuntimeError("Gemini TTS request failed") from None

    try:
        body = json.loads(raw_body)
        inline = body["candidates"][0]["content"]["parts"][0]["inlineData"]
        mime_type = inline["mimeType"]
        encoded = inline["data"]
        if not isinstance(mime_type, str) or not isinstance(encoded, str):
            raise TypeError
        rate_match = _RATE.search(mime_type)
        sample_rate = int(rate_match.group(1)) if rate_match else 24000
        if sample_rate < 8000 or sample_rate > 192000:
            raise ValueError
        pcm = base64.b64decode(encoded, validate=True)
        if not pcm or len(pcm) % 2:
            raise ValueError
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError, binascii.Error):
        raise RuntimeError("invalid Gemini TTS response") from None
    return PcmAudio(pcm, sample_rate)


def write_trimmed_wav(audio, output, *, runner=subprocess.run):
    if not isinstance(audio, PcmAudio) or not audio.data:
        raise ValueError("PCM audio is required")
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".pcm") as raw_pcm:
        raw_pcm.write(audio.data)
        raw_pcm.flush()
        command = [
            "ffmpeg",
            "-n",
            "-v",
            "error",
            "-f",
            "s16le",
            "-ar",
            str(audio.sample_rate),
            "-ac",
            "1",
            "-i",
            raw_pcm.name,
            "-af",
            SILENCE_FILTER,
            "-ar",
            "44100",
            "-ac",
            "2",
            str(output),
        ]
        try:
            result = runner(
                command,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except (subprocess.CalledProcessError, OSError):
            raise RuntimeError("ffmpeg audio conversion failed") from None
        if getattr(result, "returncode", 0) != 0:
            raise RuntimeError("ffmpeg audio conversion failed")
    if not output.is_file():
        raise RuntimeError("ffmpeg audio conversion did not create output")
    return output


def synthesize_narration(
    text,
    api_key,
    output,
    *,
    model=None,
    environ=None,
    urlopen=urllib.request.urlopen,
    runner=subprocess.run,
):
    audio = request_gemini_tts(
        text,
        api_key,
        model=model,
        environ=environ,
        urlopen=urlopen,
    )
    return write_trimmed_wav(audio, output, runner=runner)
