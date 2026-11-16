#!/usr/bin/env python3
"""Ornament profile of a sustained melodic line (wata, flute, voice) in a time window.

Reports, over notes >= 350 ms: note length, vibrato rate (Hz) and depth (cents
peak-to-peak, after removing slides with a ~190 ms median), scoop into the
note (cents, first 50 ms vs 150-350 ms), and pitch range. Used to calibrate
the ጭራ-ዋጣ voice (WATA in public/music.js). Audio is analysed locally only.

Slow vibrato is partly removed by the slide filter, so compare measured values
with measured values (render the synth, then run this on both).

    .venv/bin/python tools/analyze_ornaments.py song.mp3 15 58
"""
import sys, json, numpy as np, librosa
path,t0,t1=sys.argv[1],float(sys.argv[2]),float(sys.argv[3])
y,sr=librosa.load(path,sr=22050,offset=t0,duration=t1-t0)
yh,_=librosa.effects.hpss(y,margin=2.0); hop=128
f0,vf,_=librosa.pyin(yh,fmin=100,fmax=1200,sr=sr,frame_length=2048,hop_length=hop)
c=1200*np.log2(np.where(vf,f0,np.nan)/440); fps=sr/hop
rms=librosa.feature.rms(y=yh,frame_length=2048,hop_length=hop)[0]
runs=[];i=0
while i<len(vf):
    if vf[i]:
        j=i
        while j<len(vf) and vf[j]: j+=1
        if (j-i)/fps>=0.35: runs.append((i,j))
        i=j
    else: i+=1
rates=[];depths=[];scoops=[];attacks=[];durs=[]
for i,j in runs:
    x=c[i:j]; durs.append((j-i)/fps)
    # note body: skip first/last 80 ms; detrend with 250 ms median for slides
    k=int(0.08*fps); body=x[k:-k] if len(x)>2*k+8 else x
    trend=np.array([np.median(body[max(0,n-16):n+16]) for n in range(len(body))])
    d=body-trend
    if len(d)>=24:
        sp=np.abs(np.fft.rfft(d*np.hanning(len(d)),2048)); fr=np.fft.rfftfreq(2048,1/fps); m=(fr>=2)&(fr<=9)
        rates.append(fr[m][np.argmax(sp[m])]); depths.append(np.percentile(d,90)-np.percentile(d,10))
    scoops.append(np.median(x[:int(0.05*fps)])-np.median(x[int(0.15*fps):int(0.35*fps)]))
    r=rms[i:j]; pk=np.argmax(r[:int(0.4*fps)]); attacks.append(pk/fps)
pc=lambda a:[round(float(np.percentile(a,q)),2) for q in (25,50,75)]
print(json.dumps(dict(notes=len(runs),dur_s=pc(durs),vibrato_hz=pc(rates),vibrato_depth_cents_pp=pc(depths),
  scoop_cents=pc(scoops),attack_s=pc(attacks),f0_hz=[round(float(np.nanpercentile(f0[vf],q))) for q in (10,50,90)])))
