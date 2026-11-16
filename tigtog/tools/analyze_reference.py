#!/usr/bin/env python3
"""Measure tempo, tuning, likely qenet and per-beat drum patterns of reference songs.

Used to calibrate the studio's rhythms (see docs/reference-analysis.md).
Reference audio is analysed locally and never stored in the repo.

    python3 -m venv .venv && .venv/bin/pip install librosa
    .venv/bin/python tools/analyze_reference.py song1.mp3 song2.mp3 ...

Output, per song (JSON): tempo (beats/min, beat = dotted quarter in 6/8),
tuning offset from A440 in cents, top-3 qenet/root matches, and onset
profiles of the low (kebero/bass, 30-180 Hz) and high (claps, hand drum,
shaker, 2-8 kHz) bands over a two-beat bar, each beat split in 3 (x3) or 4 (x4).
"""
import sys, json, os, subprocess, tempfile
import numpy as np, librosa
SCALES = {"tizitaMajor":[0,2,4,7,9],"tizitaMinor":[0,2,3,7,8],"batiMajor":[0,4,5,7,11],
          "batiMinor":[0,3,5,7,10],"ambassel":[0,1,5,7,8],"anchihoye":[0,1,5,6,9]}
NAMES = "C C# D D# E F F# G G# A A# B".split()
HOP=256
def band_env(S, freqs, lo, hi):
    m = (freqs>=lo)&(freqs<hi)
    e = np.maximum(0, np.diff(np.log1p(S[m]), axis=1)).sum(axis=0)
    e = np.concatenate([[0], e]); return e/ (e.max()+1e-9)
def load(path):
    # Decode 150 s from 45 s in with ffmpeg (tolerates odd MP3 headers).
    with tempfile.TemporaryDirectory() as d:
        wav = os.path.join(d, "a.wav")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", "45", "-t", "150", "-i", path,
                        "-ac", "1", "-ar", "22050", wav], check=True)
        return librosa.load(wav, sr=22050)

for path in sys.argv[1:]:
    y, sr = load(path)
    yh, yp = librosa.effects.hpss(y, margin=2.0)
    tuning = float(librosa.estimate_tuning(y=yh, sr=sr))
    ch = librosa.feature.chroma_cqt(y=yh, sr=sr, tuning=tuning, bins_per_octave=36)
    # weight frames by energy, keep sharpest frames
    chm = (ch**2).mean(axis=1); chm/=chm.sum()
    res=[]
    for name, sc in SCALES.items():
        for r in range(12):
            pcs=[(r+i)%12 for i in sc]; inside=chm[pcs].sum()
            res.append((round(float(inside + 0.3*chm[r]),3), name, NAMES[r], round(float(inside),3)))
    res.sort(reverse=True)
    # rhythm: beat grid
    env = librosa.onset.onset_strength(y=yp, sr=sr, hop_length=HOP)
    tempo, beats = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=HOP, start_bpm=90)
    Sx = np.abs(librosa.stft(yp, n_fft=1024, hop_length=HOP)); freqs = librosa.fft_frequencies(sr=sr, n_fft=1024)
    low, high = band_env(Sx,freqs,30,180), band_env(Sx,freqs,2000,8000)
    def profile(e, sub):
        prof=np.zeros(sub*2); n=0
        for i in range(0, len(beats)-2, 2):
            a,b,c = beats[i], beats[i+1], beats[i+2]
            for k in range(sub):
                for j,(s,t) in enumerate(((a,b),(b,c))):
                    f = int(round(s + (t-s)*k/sub)); prof[j*sub+k]+= e[max(0,f-3):f+4].max()
            n+=1
        return (prof/n/ (prof/n).max()).round(2).tolist()
    # choose bar phase: rotate by one beat if second beat has stronger low hit
    out = {"tuning_cents": round(tuning*100), "tempo": round(float(np.atleast_1d(tempo)[0]),1),
        "qenet_top3": res[:3], "chroma": {NAMES[i]: round(float(chm[i]),3) for i in np.argsort(chm)[::-1][:6]},
        "low_x3": profile(low,3), "high_x3": profile(high,3), "low_x4": profile(low,4), "high_x4": profile(high,4)}
    print(path, json.dumps(out), flush=True)
