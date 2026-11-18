#!/usr/bin/env python3
"""Cut a phone recording of drum hits into one-shot samples for Tigtog.

Record ~10 hits of one stroke with about a second between them, then:

    .venv/bin/python tools/slice-hits.py dum.m4a --stroke dum --out public/samples/kebero
    .venv/bin/python tools/slice-hits.py ta.m4a  --stroke ta  --out public/samples/kebero

Each hit becomes <out>/<stroke>_NN.wav (44.1 kHz mono, 16-bit, starts 5 ms
before the hit, ends before the next hit or after 1.2 s, with a short fade
and the same peak level), and <out>/manifest.json lists them. Tigtog loads
that manifest and plays these real hits instead of its synthesized ከበሮ.

Hits that are much quieter than the rest (accidental taps, noise) are
skipped; the report says how many were kept.
"""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np
import librosa
import soundfile as sf

SR = 44100


def load(path):
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "in.wav")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", path, "-ac", "1", "-ar", str(SR), wav], check=True)
        y, _ = librosa.load(wav, sr=SR, mono=True)
    # A hit at the very start of the file can't be detected without silence
    # before it, so add a little.
    return np.concatenate([np.zeros(int(0.3 * SR), dtype=y.dtype), y])


def slice_hits(y, max_len=1.2, pre=0.005, min_gap=0.25, rel_threshold_db=-18):
    onsets = librosa.onset.onset_detect(y=y, sr=SR, units="samples", backtrack=True,
                                        pre_max=20, post_max=20, delta=0.2, wait=int(min_gap * SR / 512))
    peaks = [float(np.max(np.abs(y[o:o + int(0.05 * SR)])) if o < len(y) else 0) for o in onsets]
    if not peaks:
        return []
    loud = max(peaks)
    hits = []
    for i, o in enumerate(onsets):
        if peaks[i] < loud * 10 ** (rel_threshold_db / 20):
            continue  # accidental tap or noise
        start = max(0, o - int(pre * SR))
        nxt = onsets[i + 1] - int(pre * SR) if i + 1 < len(onsets) else len(y)
        end = min(nxt, start + int(max_len * SR), len(y))
        seg = y[start:end].copy()
        if len(seg) < int(0.1 * SR):
            continue
        fade = min(len(seg) // 4, int(0.08 * SR))
        seg[-fade:] *= np.linspace(1, 0, fade) ** 2
        seg *= 0.89 / (np.max(np.abs(seg)) + 1e-9)  # peak -1 dB
        hits.append(seg)
    return hits


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("recording")
    ap.add_argument("--stroke", required=True, choices=["dum", "ta"],
                    help="dum = deep open stroke on the big head; ta = edge / small-head stroke")
    ap.add_argument("--out", default="public/samples/kebero")
    a = ap.parse_args()
    hits = slice_hits(load(a.recording))
    if not hits:
        sys.exit("no hits found — record louder, with about a second between hits")
    os.makedirs(a.out, exist_ok=True)
    names = []
    for i, h in enumerate(hits, 1):
        name = f"{a.stroke}_{i:02d}.wav"
        sf.write(os.path.join(a.out, name), h, SR, subtype="PCM_16")
        names.append(name)
    mpath = os.path.join(a.out, "manifest.json")
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {}
    manifest[a.stroke] = names
    json.dump(manifest, open(mpath, "w"), indent=2)
    print(json.dumps({"stroke": a.stroke, "kept": len(hits), "files": names, "manifest": mpath}))


if __name__ == "__main__":
    main()
