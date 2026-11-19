// Tigtog Studio: compose a loop in an Ethiopian/Eritrean qenet, write lyrics
// in Fidel, and record a 9:16 music video (animated or camera background,
// optional vocals) that can be posted straight to the feed.
import { t, getLang } from "./i18n.js";
import { attachFidelInput, transliterate } from "./fidel.js";
import {
  MusicEngine, SCALES, RHYTHMS, RHYTHM_ORDER, INSTRUMENTS, ROWS, KEYS, columnsFor, generateMelody, rowToMidi,
} from "./music.js";

const W = 720;
const H = 1280;

// Colour pair per qenet for the animated background.
const PALETTES = {
  tizitaMajor: ["#2b1d4f", "#f5a524"], tizitaMinor: ["#1b2340", "#5fb3b3"],
  batiMajor: ["#3a1530", "#ff7a59"], batiMinor: ["#16242b", "#9ccf6a"],
  ambassel: ["#2d1630", "#e05fa0"], anchihoye: ["#12223a", "#7aa2ff"],
};

const FONT = '"Noto Sans Ethiopic", "Abyssinica SIL", "Nyala", system-ui, sans-serif';

// Ge'ez hashtags, in the song's own language (Tigrinya / Amharic spellings).
const TAGS = {
  ti: {
    guayla: "ጓይላ", guaylaWedding: "ጓይላ", guaylaClassic: "ጓይላ", eskista: "እስክስታ", chikchika: "ችክችካ", ballad: "ደርፊ",
    krar: "ኽራር", masinko: "ዋጣ", washint: "ሸምበቆ", embilta: "እምብልታ",
    tizita: "ትዝታ", bati: "ባቲ", ambassel: "ኣምባሰል", anchihoye: "ኣንቺሆየ", lang: "ትግርኛ",
  },
  am: {
    guayla: "ጓይላ", guaylaWedding: "ጓይላ", guaylaClassic: "ጓይላ", eskista: "እስክስታ", chikchika: "ችክችካ", ballad: "ዘፈን",
    krar: "ክራር", masinko: "ማሲንቆ", washint: "ዋሽንት", embilta: "እምቢልታ",
    tizita: "ትዝታ", bati: "ባቲ", ambassel: "አምባሰል", anchihoye: "አንቺሆዬ", lang: "አማርኛ",
  },
};
function songTags(lang, engine) {
  const m = TAGS[lang] ?? TAGS.ti;
  const scale = engine.scale.replace(/(Major|Minor)$/, "");
  return ["tigtog", m.lang, m[engine.rhythm], m[engine.instrument], m[scale]].map((x) => `#${x}`).join(" ");
}

let engine; // shared across visits so audio state persists

/**
 * @param {HTMLElement} view
 * @param {{api: Function, store: object, el: Function, toast: Function, requireLogin: Function, navigate: Function, fidelField: Function}} h
 */
export function renderStudio(view, h) {
  const { el, api, store, toast, requireLogin, navigate, fidelField } = h;
  engine ??= new MusicEngine();
  // Real ከበሮ recordings, if installed (public/samples/kebero); else synthesized.
  if (!engine._samplesTried) { engine._samplesTried = true; engine.loadDrumSamples().catch(() => {}); }
  let camStream = null;
  let micStream = null;
  let micNode = null;
  let raf = 0;
  let recording = null; // { recorder, until, bars }
  let recordedBlob = null;
  let playCol = -1;
  const camVideo = el("video", { muted: true, playsinline: true, autoplay: true });
  camVideo.muted = true;

  // ------------------------------------------------------------ controls
  const select = (options, value, onchange) => {
    const s = el("select", { onchange: (e) => onchange(e.target.value) },
      options.map(([v, label]) => el("option", { value: v, selected: v === value }, label)));
    return s;
  };

  const titleInput = el("input", { maxlength: "80", placeholder: t("songTitle") });
  fidelField(titleInput);
  const langSelect = select([["ti", t("ti")], ["am", t("am")]], getLang() === "am" ? "am" : "ti", () => {});

  const scaleSelect = select(Object.keys(SCALES).map((k) => [k, t(k)]), engine.scale, (v) => { engine.scale = v; preview(); });
  const tempoValue = el("output", {}, String(engine.bpm));
  const tempo = el("input", { type: "range", min: "50", max: "160", value: String(engine.bpm), "aria-label": t("tempo"),
    oninput: (e) => { engine.bpm = Number(e.target.value); tempoValue.textContent = e.target.value; } });
  const rhythmSelect = select(RHYTHM_ORDER.map((k) => [k, t(k)]), engine.rhythm, (v) => {
    engine.rhythm = v;
    engine.bpm = RHYTHMS[v].bpm;
    tempo.value = String(engine.bpm);
    tempoValue.textContent = String(engine.bpm);
    engine.notes = generateMelody(v);
    buildGrid();
    if (engine.playing) engine.start();
  });
  const keySelect = select(KEYS.map((k) => [k, k]), engine.key, (v) => { engine.key = v; preview(0); });
  const centsValue = el("output", {}, `${engine.cents > 0 ? "+" : ""}${engine.cents}¢`);
  const cents = el("input", { type: "range", min: "-50", max: "50", step: "1", value: String(engine.cents), "aria-label": t("fineTune"),
    oninput: (e) => { engine.cents = Number(e.target.value); centsValue.textContent = `${engine.cents > 0 ? "+" : ""}${engine.cents}¢`; },
    onchange: () => preview(0) });
  const instSelect = select(INSTRUMENTS.map((k) => [k, t(k)]), engine.instrument, (v) => { engine.instrument = v; preview(); });

  const playBtn = el("button", { class: "primary", type: "button", onclick: togglePlay }, `▶ ${t("play")}`);
  async function togglePlay() {
    if (recording) return;
    if (engine.playing) { engine.stop(); playCol = -1; paintPlayhead(); playBtn.textContent = `▶ ${t("play")}`; }
    else { await engine.start(); playBtn.textContent = `■ ${t("stop")}`; }
  }
  /** Audition one note when tapping the grid while stopped. */
  function preview(row) {
    if (engine.playing || row === undefined) return;
    const ctx = engine.ensure();
    ctx.resume();
    engine._melody(rowToMidi(engine.scale, row, engine.root), ctx.currentTime + 0.01, 0.3);
  }

  // ---------------------------------------------------------- melody grid
  const grid = el("div", { class: "seq", role: "grid", "aria-label": t("melody") });
  function buildGrid() {
    const cols = columnsFor(engine.rhythm);
    const beat = RHYTHMS[engine.rhythm].stepsPerBeat / 2;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const cells = [];
    for (let row = ROWS - 1; row >= 0; row--) {
      for (let c = 0; c < cols; c++) {
        const key = `${row}:${c}`;
        const b = el("button", {
          type: "button", class: `cell${c % beat === 0 ? " beat" : ""}${row % 5 === 0 ? " root" : ""}`,
          "aria-pressed": String(engine.notes.has(key)), dataset: { col: String(c) },
          "aria-label": `${row + 1}, ${c + 1}`,
          onclick: () => {
            if (engine.notes.has(key)) engine.notes.delete(key);
            else { engine.notes.add(key); preview(row); }
            b.setAttribute("aria-pressed", String(engine.notes.has(key)));
          },
        });
        cells.push(b);
      }
    }
    grid.replaceChildren(...cells);
  }
  function paintPlayhead() {
    for (const c of grid.children) c.classList.toggle("now", Number(c.dataset.col) === playCol);
  }
  engine.onStep = (col) => { playCol = col; paintPlayhead(); };
  buildGrid();

  // -------------------------------------------------------------- lyrics
  const lyrics = el("textarea", { rows: "5", maxlength: "1000", placeholder: t("lyricsPlaceholder") });
  fidelField(lyrics);
  const lyricLines = () => lyrics.value.split("\n").map((s) => s.trim()).filter(Boolean);

  // ------------------------------------------------------------ background
  let bgMode = "animated";
  const bgSelect = select([["animated", t("animated")], ["camera", t("camera")]], bgMode, async (v) => {
    bgMode = v;
    if (v === "camera") {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 720, height: 1280 } });
        camVideo.srcObject = camStream;
        await camVideo.play().catch(() => {});
      } catch {
        toast(t("cameraDenied"));
        bgMode = "animated";
        bgSelect.value = "animated";
      }
    } else stopStream("cam");
  });
  const vocals = el("input", { type: "checkbox", onchange: async (e) => {
    if (e.target.checked) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const ctx = engine.ensure();
        micNode = ctx.createMediaStreamSource(micStream);
        micNode.connect(engine.recordDest); // recorded, not played back (avoids feedback)
        micNode.connect(engine.analyser);
      } catch {
        toast(t("cameraDenied"));
        e.target.checked = false;
      }
    } else stopStream("mic");
  } });

  function stopStream(which) {
    if (which === "cam" && camStream) { camStream.getTracks().forEach((tr) => tr.stop()); camStream = null; camVideo.srcObject = null; }
    if (which === "mic" && micStream) { micNode?.disconnect(); micStream.getTracks().forEach((tr) => tr.stop()); micStream = null; micNode = null; }
  }

  const lengthSelect = select([4, 8, 12, 16].map((n) => [String(n), t("bars", { n })]), "8", () => {});

  // -------------------------------------------------------------- canvas
  const canvas = el("canvas", { width: String(W), height: String(H), class: "studio-canvas", "aria-label": t("preview") });
  const g = canvas.getContext("2d");
  const freq = new Uint8Array(128);

  function draw(now) {
    const [bg, accent] = PALETTES[engine.scale];
    const pos = engine.position();
    const time = now / 1000;

    // Background
    if (bgMode === "camera" && camVideo.readyState >= 2) {
      const vw = camVideo.videoWidth, vh = camVideo.videoHeight;
      const s = Math.max(W / vw, H / vh);
      g.save();
      g.translate(W, 0); g.scale(-1, 1); // mirror selfie view
      g.drawImage(camVideo, (W - vw * s) / 2, (H - vh * s) / 2, vw * s, vh * s);
      g.restore();
      g.fillStyle = "rgba(0,0,0,.25)";
      g.fillRect(0, 0, W, H);
    } else {
      const grad = g.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, bg);
      grad.addColorStop(1, "#0d0b14");
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      // Glow that pulses on each beat.
      const beatFrac = engine.playing ? (pos.frac * (RHYTHMS[engine.rhythm].stepsPerBar / RHYTHMS[engine.rhythm].stepsPerBeat)) % 1 : 0.5;
      const r = 260 + 60 * Math.pow(1 - beatFrac, 3);
      const glow = g.createRadialGradient(W / 2, H * 0.36, 10, W / 2, H * 0.36, r * 1.6);
      glow.addColorStop(0, accent + "aa");
      glow.addColorStop(1, accent + "00");
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
    }

    // Audio-reactive ring
    if (engine.analyser) engine.analyser.getByteFrequencyData(freq);
    g.save();
    g.translate(W / 2, H * 0.36);
    g.strokeStyle = accent;
    g.lineWidth = 6;
    g.lineCap = "round";
    const bars = 48;
    for (let i = 0; i < bars; i++) {
      const v = freq[Math.floor((i / bars) * 64)] / 255;
      const a = (i / bars) * Math.PI * 2 + time * 0.2;
      const r0 = 150, r1 = r0 + 12 + v * 120;
      g.globalAlpha = 0.5 + v * 0.5;
      g.beginPath();
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      g.stroke();
    }
    g.restore();
    g.globalAlpha = 1;

    // Tibeb-style woven border bands (top and bottom), drifting with time.
    tibeb(g, 0, accent, time);
    tibeb(g, H - 44, accent, -time);

    // Title
    const title = titleInput.value.trim();
    g.textAlign = "center";
    g.fillStyle = "#fff";
    if (title) {
      g.font = `700 54px ${FONT}`;
      wrap(g, title, W / 2, 140, W - 100, 64, 2);
    }

    // Karaoke lyrics
    const lines = lyricLines();
    if (lines.length) {
      const barsPerLine = recording ? Math.max(1, Math.floor(recording.bars / lines.length)) : 2;
      const idx = Math.floor(pos.bar / barsPerLine) % lines.length;
      const prog = ((pos.bar % barsPerLine) + pos.frac) / barsPerLine;
      karaoke(g, lines[idx], H * 0.6, prog, accent);
      if (lines.length > 1) {
        g.font = `500 34px ${FONT}`;
        g.fillStyle = "rgba(255,255,255,.55)";
        g.fillText(lines[(idx + 1) % lines.length], W / 2, H * 0.6 + 80, W - 80);
      }
    }

    // Watermark
    g.font = `800 30px system-ui, sans-serif`;
    g.textAlign = "left";
    g.fillStyle = "rgba(255,255,255,.8)";
    g.fillText("tigtog", 32, H - 70);
    if (recording) {
      g.fillStyle = "#ff4d4d";
      g.beginPath(); g.arc(W - 48, 92, 14, 0, Math.PI * 2); g.fill();
    }
    raf = requestAnimationFrame(draw);
  }

  function tibeb(g, y, accent, time) {
    const size = 44;
    const off = ((time * 30) % (size * 2) + size * 2) % (size * 2);
    g.save();
    g.fillStyle = "rgba(0,0,0,.35)";
    g.fillRect(0, y, W, size);
    for (let x = -size * 2 + off; x < W + size; x += size) {
      const even = Math.round((x - off) / size) % 2 === 0;
      g.fillStyle = even ? accent : "#fff";
      g.globalAlpha = even ? 0.9 : 0.7;
      g.beginPath();
      g.moveTo(x, y + size / 2);
      g.lineTo(x + size / 2, y + 6);
      g.lineTo(x + size, y + size / 2);
      g.lineTo(x + size / 2, y + size - 6);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function karaoke(g, text, y, prog, accent) {
    g.font = `700 50px ${FONT}`;
    g.textAlign = "center";
    const width = Math.min(g.measureText(text).width, W - 80);
    const x0 = W / 2 - width / 2;
    g.lineWidth = 8;
    g.strokeStyle = "rgba(0,0,0,.55)";
    g.strokeText(text, W / 2, y, W - 80);
    g.fillStyle = "#fff";
    g.fillText(text, W / 2, y, W - 80);
    g.save();
    g.beginPath();
    g.rect(x0, y - 70, width * Math.min(1, Math.max(0, prog)), 100);
    g.clip();
    g.fillStyle = accent;
    g.fillText(text, W / 2, y, W - 80);
    g.restore();
  }

  function wrap(g, text, x, y, maxW, lh, maxLines) {
    const words = text.split(/\s+/);
    let line = "";
    let n = 0;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (g.measureText(test).width > maxW && line) {
        g.fillText(line, x, y + n * lh);
        line = w;
        if (++n >= maxLines) return;
      } else line = test;
    }
    g.fillText(line, x, y + n * lh);
  }

  // ------------------------------------------------------------ recording
  // Re-tag the caption when the song's language changes after recording.
  langSelect.addEventListener("change", () => {
    if (!result.hidden) caption.value = [titleInput.value.trim(), songTags(langSelect.value, engine)].filter(Boolean).join("\n");
  });

  const status = el("p", { class: "muted", role: "status" });
  const recordBtn = el("button", { class: "primary rec", type: "button", onclick: startRecording }, `● ${t("record")}`);
  const result = el("div", { class: "result", hidden: true });

  function pickMime() {
    if (typeof MediaRecorder === "undefined") return null;
    for (const m of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]) {
      if (MediaRecorder.isTypeSupported?.(m)) return m;
    }
    return null;
  }

  async function startRecording() {
    const mime = pickMime();
    if (!mime || !canvas.captureStream) return toast(t("recordUnsupported"));
    engine.ensure();
    const bars = Number(lengthSelect.value);
    const stream = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...engine.recordDest.stream.getAudioTracks(),
    ]);
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      recordedBlob = new Blob(chunks, { type: mime.split(";")[0] });
      engine.stop();
      playCol = -1; paintPlayhead();
      recording = null;
      setBusy(false);
      showResult();
    };
    await engine.start();
    recorder.start(250);
    const total = bars * engine.barDur + 0.4; // let the last note ring
    recording = { recorder, bars, until: performance.now() + total * 1000 };
    setBusy(true);
    const countdown = () => {
      if (!recording) return;
      const left = Math.max(0, Math.ceil((recording.until - performance.now()) / 1000));
      status.textContent = t("recording", { s: left });
      if (left <= 0) recorder.stop();
      else setTimeout(countdown, 200);
    };
    countdown();
  }

  function setBusy(on) {
    for (const c of [recordBtn, playBtn, rhythmSelect, scaleSelect, lengthSelect, bgSelect, vocals]) c.disabled = on;
    playBtn.textContent = on ? `■ ${t("stop")}` : `▶ ${t("play")}`;
    if (!on) status.textContent = "";
  }

  const caption = el("textarea", { rows: "3", maxlength: "500", placeholder: t("captionPlaceholder") });
  fidelField(caption);

  function showResult() {
    const url = URL.createObjectURL(recordedBlob);
    const vid = el("video", { src: url, controls: true, playsinline: true, class: "result-video" });
    // Chrome's MediaRecorder WebM has no duration header; seeking far ahead
    // makes the browser scan the file so the seek bar works.
    vid.addEventListener("loadedmetadata", () => {
      if (vid.duration === Infinity) {
        vid.currentTime = 1e9;
        vid.addEventListener("timeupdate", () => { vid.currentTime = 0; }, { once: true });
      }
    }, { once: true });
    const tags = songTags(langSelect.value, engine);
    caption.value = [titleInput.value.trim(), tags].filter(Boolean).join("\n");
    const postBtn = el("button", { class: "primary", type: "button", onclick: () => requireLogin(postSong) }, t("postSong"));
    async function postSong() {
      postBtn.disabled = true;
      postBtn.textContent = t("posting");
      try {
        const { media } = await api("/api/media", { method: "POST", body: recordedBlob, raw: true, headers: { "Content-Type": recordedBlob.type } });
        const { post } = await api("/api/posts", { method: "POST", body: { caption: caption.value, mediaId: media.id, language: langSelect.value, kind: "music" } });
        toast(t("posted"));
        navigate(`#/p/${post.id}`);
      } catch (err) {
        toast(err.message);
        postBtn.disabled = false;
        postBtn.textContent = t("postSong");
      }
    }
    result.replaceChildren(
      el("h3", {}, t("preview")), vid,
      el("label", {}, t("caption"), caption),
      el("div", { class: "row" }, postBtn,
        el("button", { class: "secondary", type: "button", onclick: () => { result.hidden = true; URL.revokeObjectURL(url); } }, t("retake"))));
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------- layout
  const field = (label, control, extra) => el("label", { class: "field" }, el("span", {}, label), control, extra ?? null);

  view.replaceChildren(el("div", { class: "page studio" },
    el("header", { class: "studio-head" }, el("h1", {}, t("studioTitle")), el("p", { class: "muted" }, t("studioIntro"))),
    el("div", { class: "studio-grid" },
      el("div", { class: "studio-preview" }, canvas, el("div", { class: "row" }, playBtn, recordBtn), status),
      el("div", { class: "studio-controls" },
        el("section", { class: "card" },
          el("div", { class: "fields" },
            field(t("songTitle"), titleInput),
            field(t("language"), langSelect),
            field(t("qenet"), scaleSelect),
            field(t("rhythm"), rhythmSelect),
            field(t("instrument"), instSelect),
            field(t("key"), keySelect),
            field(t("fineTune"), cents, centsValue),
            field(t("tempo"), tempo, tempoValue))),
        el("section", { class: "card" },
          el("div", { class: "card-head" }, el("h2", {}, t("melody")),
            el("button", { class: "secondary sm", type: "button", onclick: () => { engine.notes = generateMelody(engine.rhythm); buildGrid(); } }, `✦ ${t("generate")}`),
            el("button", { class: "secondary sm", type: "button", onclick: () => { engine.notes = new Set(); buildGrid(); } }, t("clear"))),
          el("p", { class: "muted small" }, t("melodyHint")),
          grid),
        el("section", { class: "card" },
          el("div", { class: "card-head" }, el("h2", {}, t("lyrics")),
            el("button", { class: "secondary sm", type: "button", onclick: () => { lyrics.value = transliterate(lyrics.value); } }, t("convertFidel"))),
          lyrics,
          el("p", { class: "muted small" }, t("fidelHint"))),
        el("section", { class: "card" },
          el("div", { class: "fields" },
            field(t("background"), bgSelect),
            field(t("length"), lengthSelect)),
          el("label", { class: "check" }, vocals, t("vocals")),
          el("p", { class: "muted small" }, t("headphones"))),
        result))));

  // Canvas text doesn't trigger web-font loading on its own.
  document.fonts?.load(`700 50px "Noto Sans Ethiopic"`, "ሰላም").catch(() => {});
  raf = requestAnimationFrame(draw);

  // Clean up when the user navigates away.
  return () => {
    cancelAnimationFrame(raf);
    if (recording) recording.recorder.stop();
    engine.stop();
    engine.onStep = null;
    stopStream("cam");
    stopStream("mic");
  };
}

