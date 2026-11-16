#!/usr/bin/env python3
"""Export TensorflowInputMusiCNN reference frames from an exact mono PCM16/16 kHz WAV.

Requires an Essentia build exposing TensorflowInputMusiCNN plus NumPy.
Audio is read locally and never uploaded.
"""
import argparse
import hashlib
import json
import sys
import wave
from pathlib import Path

import numpy as np
import essentia
import essentia.standard as es


CONFIG = {
    "sampleRateHz": 16000,
    "channels": 1,
    "frameSize": 512,
    "hopSize": 256,
    "melBands": 96,
    "startFromZero": False,
    "validFrameThresholdRatio": 0,
    "window": "hann",
    "windowNormalized": False,
    "spectrumType": "power",
    "melScale": "slaney",
    "melNormalization": "unit_tri",
    "melScaleFactor": 10000,
    "melShift": 1,
    "compression": "log10"
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Export 96-band Essentia TensorflowInputMusiCNN frames to JSON."
    )
    parser.add_argument("--audio", required=True, help="Mono PCM16 WAV at 16 kHz.")
    parser.add_argument("--output", required=True, help="New JSON output path (must not exist).")
    return parser.parse_args()


def main():
    args = parse_args()
    audio_path = Path(args.audio).expanduser().resolve(strict=True)
    output_path = Path(args.output).expanduser().resolve()
    if output_path == audio_path:
        raise ValueError("Output cannot overwrite the input WAV.")
    if output_path.exists():
        raise FileExistsError("Output already exists; choose a new path.")

    raw_audio = audio_path.read_bytes()
    with wave.open(str(audio_path), "rb") as wav:
        if wav.getcomptype() != "NONE" or wav.getsampwidth() != 2:
            raise ValueError("Input must be uncompressed PCM16 WAV.")
        if wav.getnchannels() != 1 or wav.getframerate() != CONFIG["sampleRateHz"]:
            raise ValueError("Input must be mono at exactly 16000 Hz.")
        frame_count = wav.getnframes()
        if frame_count <= 0:
            raise ValueError("Input WAV is empty.")
        pcm_bytes = wav.readframes(frame_count)
        if len(pcm_bytes) != frame_count * 2:
            raise ValueError("WAV data chunk is truncated.")

    samples = np.frombuffer(pcm_bytes, dtype="<i2").astype(np.float32) / 32768.0
    extractor = es.TensorflowInputMusiCNN()
    features = []
    frame_generator = es.FrameGenerator(
        samples,
        frameSize=CONFIG["frameSize"],
        hopSize=CONFIG["hopSize"],
        startFromZero=CONFIG["startFromZero"],
        validFrameThresholdRatio=CONFIG["validFrameThresholdRatio"],
        lastFrameToEndOfFile=False
    )
    for frame in frame_generator:
        bands = np.asarray(extractor(frame).bands, dtype=np.float32)
        if bands.shape != (CONFIG["melBands"],):
            raise ValueError("Essentia returned an unexpected mel-band shape: " + str(bands.shape))
        if not np.isfinite(bands).all():
            raise ValueError("Essentia returned NaN or infinite mel values.")
        features.append(bands.astype(float).tolist())

    if not features:
        raise ValueError("Essentia did not produce any feature frames.")

    document = {
        "schemaVersion": 1,
        "source": {
            "engine": "Essentia",
            "algorithm": "TensorflowInputMusiCNN",
            "version": str(getattr(essentia, "__version__", "unknown"))
        },
        "audio": {
            "sha256": hashlib.sha256(raw_audio).hexdigest(),
            "sampleRateHz": CONFIG["sampleRateHz"],
            "channels": CONFIG["channels"],
            "sampleFormat": "PCM16"
        },
        "config": CONFIG,
        "frames": features
    }
    with output_path.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(document, output, ensure_ascii=False, indent=2, allow_nan=False)
        output.write("\n")

    print("Exported {} frames × {} bands.".format(len(features), CONFIG["melBands"]))
    print("Essentia version: {}".format(document["source"]["version"]))
    print("Audio SHA-256: {}".format(document["audio"]["sha256"]))
    print("Reference: {}".format(output_path))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Essentia reference export failed: {}".format(error), file=sys.stderr)
        sys.exit(1)
