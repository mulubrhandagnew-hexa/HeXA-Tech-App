#!/usr/bin/env python3
"""Measure the timbre of a plucked instrument (e.g. krar) in a recording.

Finds isolated notes (no new onset for >= 350 ms) and reports:
  - pitch range of those notes,
  - harmonics 1-8 in dB relative to the fundamental, at the attack and later,
  - decay of the note's own partials (h1-h4) in dB/s, and T60,
  - spectral centroid / f0 at attack and after 200 ms (brightness).

Used to calibrate the Karplus-Strong krar in public/music.js
(see docs/reference-analysis.md). Audio is analysed locally only.

    .venv/bin/python tools/analyze_timbre.py krar_recording.mp3
"""
import json, os, subprocess, sys, tempfile
import numpy as np, librosa

def decode(path, d):
    wav = os.path.join(d, "a.wav")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", path, "-ac", "1", "-ar", "44100", wav], check=True)
    return wav

def isolated_notes(y, sr, hop=256):
    on = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop, units="samples", backtrack=True, delta=0.15)
    for i, s in enumerate(on[:-1]):
        gap = (on[i + 1] - s) / sr
        if gap >= 0.35:
            yield y[s: s + int(min(gap, 1.2) * sr)]

def f0_of(seg, sr):
    f0s, vf, _ = librosa.pyin(seg[: int(0.25 * sr)], fmin=100, fmax=1000, sr=sr, frame_length=2048)
    return float(np.nanmedian(f0s[vf])) if vf.any() else None

def harmonics(x, f0, sr):
    X = np.abs(np.fft.rfft(x * np.hanning(len(x)), 16384)); fr = np.fft.rfftfreq(16384, 1 / sr)
    h = np.array([X[np.abs(fr - f0 * k) <= max(f0 * k * 0.03, 4)].max() for k in range(1, 9)])
    return 20 * np.log10(h / h[0] + 1e-9)

def partial_decay(seg, f0, sr, hop=256):
    X = np.abs(librosa.stft(seg, n_fft=4096, hop_length=hop)); fr = librosa.fft_frequencies(sr=sr, n_fft=4096)
    p = sum(X[np.abs(fr - f0 * k) <= max(f0 * k * 0.02, 16)].max(axis=0) ** 2 for k in (1, 2, 3, 4))
    db = 10 * np.log10(p / p[:6].max() + 1e-12); t = np.arange(len(db)) * hop / sr
    pk = int(np.argmax(db[:6])); m = (t >= t[pk]) & (t < t[pk] + 0.3)
    return float(np.polyfit(t[m], db[m], 1)[0]) if m.sum() >= 8 else None

def centroid(x, f0, sr):
    return float(librosa.feature.spectral_centroid(y=x, sr=sr, n_fft=min(2048, len(x) - 1)).mean()) / f0

def analyze(path):
    with tempfile.TemporaryDirectory() as d:
        y, sr = librosa.load(decode(path, d), sr=44100)
    rows = []
    for seg in isolated_notes(y, sr):
        if len(seg) < int(0.35 * sr) or np.sqrt(np.mean(seg[:2048] ** 2)) < 0.01:
            continue
        f0 = f0_of(seg, sr)
        if not f0:
            continue
        a = seg[int(0.005 * sr): int(0.06 * sr)]; b = seg[int(0.20 * sr): int(0.30 * sr)]
        rows.append(dict(f0=f0, decay=partial_decay(seg, f0, sr), h_attack=harmonics(a, f0, sr),
                         h_late=harmonics(b, f0, sr), cen_attack=centroid(a, f0, sr), cen_late=centroid(b, f0, sr)))
    dec = [r["decay"] for r in rows if r["decay"] is not None]
    med = lambda k: float(np.median([r[k] for r in rows]))
    return dict(
        notes=len(rows), f0_range_hz=[round(min(r["f0"] for r in rows)), round(max(r["f0"] for r in rows))],
        harmonics_attack_db=np.median([r["h_attack"] for r in rows], axis=0).round(1).tolist(),
        harmonics_late_db=np.median([r["h_late"] for r in rows], axis=0).round(1).tolist(),
        partial_decay_db_s=[round(float(np.percentile(dec, q)), 1) for q in (25, 50, 75)],
        t60_s=round(-60 / float(np.median(dec)), 2),
        centroid_x_f0=[round(med("cen_attack"), 2), round(med("cen_late"), 2)])

if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(os.path.basename(p), json.dumps(analyze(p)), flush=True)
