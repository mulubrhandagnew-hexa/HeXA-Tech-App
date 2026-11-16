// "Teach Tigtog to sing": consented, guided recording of Tigrinya and
// Amharic singing for training Tigtog's own voice model.
//
// Each recording is labelled automatically: the text, its phonemes (g2p.js)
// and the exact guide notes (pitch + timing relative to the audio), which is
// what a DiffSinger-style model needs.
import { t, getLang } from "./i18n.js";
import { MusicEngine } from "./music.js";
import { g2p, phonemeString } from "./g2p.js";
import { promptsFor, guideNotes } from "./voice-prompts.js";

const BPM = 76; // median Guayla tempo in the reference songs
const RANGES = { low: 45, mid: 50, high: 57 }; // root MIDI: A2, D3, A3
const CONSENT_VERSION = 1;

let engine;

function pickAudioMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return null;
}

/**
 * @param {HTMLElement} view
 * @param {{api: Function, store: object, el: Function, toast: Function, requireLogin: Function}} h
 * @returns {() => void} cleanup
 */
export function renderVoice(view, h) {
  const { api, store, el, toast, requireLogin } = h;
  engine ??= new MusicEngine();
  let mic = null;
  let timer = 0;
  let disposed = false;
  const page = el("div", { class: "page voice" });
  view.replaceChildren(page);

  const header = () => el("header", { class: "studio-head" },
    el("h1", {}, t("voiceTitle")), el("p", { class: "muted" }, t("voiceIntro")));
  const statsLine = el("p", { class: "muted small" });

  api("/api/voice/stats").then(({ stats }) => {
    const by = Object.fromEntries(stats.map((s) => [s.language, s]));
    statsLine.textContent = t("datasetStats", { ti: by.ti.minutes, am: by.am.minutes, n: Math.max(by.ti.singers, by.am.singers) });
  }).catch(() => {});

  if (!store.me) {
    page.replaceChildren(header(), statsLine,
      el("button", { class: "primary", onclick: () => requireLogin(() => renderVoice(view, h)) }, t("login")));
    return () => {};
  }

  // ---------------------------------------------------------------- consent
  function showConsent() {
    const boxes = ["consentAdult", "consentOwn", "consentAgree"].map((k) =>
      el("label", { class: "check" }, el("input", { type: "checkbox" }), t(k)));
    const go = el("button", { class: "primary", disabled: true, onclick: async () => {
      go.disabled = true;
      try {
        await api("/api/voice/consent", { method: "POST", body: { version: CONSENT_VERSION, adult: true, ownVoice: true, agree: true } });
        showRecorder();
      } catch (err) { toast(err.message); go.disabled = false; }
    } }, t("consentButton"));
    for (const b of boxes) b.querySelector("input").addEventListener("change", () => {
      go.disabled = !boxes.every((x) => x.querySelector("input").checked);
    });
    page.replaceChildren(header(), statsLine, el("section", { class: "card" },
      el("h2", {}, t("consentTitle")),
      el("ul", { class: "consent-points" }, ["consent1", "consent2", "consent3"].map((k) => el("li", {}, t(k)))),
      ...boxes, go));
  }

  // --------------------------------------------------------------- recorder
  async function showRecorder() {
    const lang = getLang() === "am" ? "am" : "ti";
    const state = { lang, range: "mid", done: new Set(), index: 0 };
    const langSel = el("select", { onchange: (e) => { state.lang = e.target.value; state.index = 0; next(); } },
      [["ti", t("ti")], ["am", t("am")]].map(([v, l]) => el("option", { value: v, selected: v === lang }, l)));
    const rangeSel = el("select", { onchange: (e) => { state.range = e.target.value; } },
      [["low", t("rangeLow")], ["mid", t("rangeMid")], ["high", t("rangeHigh")]].map(([v, l]) => el("option", { value: v, selected: v === "mid" }, l)));
    const card = el("section", { class: "card prompt-card" });
    const mine = el("section", { class: "card" });
    page.replaceChildren(header(), statsLine,
      el("section", { class: "card" },
        el("div", { class: "fields" },
          el("label", { class: "field" }, el("span", {}, t("language")), langSel),
          el("label", { class: "field" }, el("span", {}, t("voiceRange")), rangeSel)),
        el("p", { class: "muted small" }, t("headphones"))),
      card, mine);

    async function refreshMine() {
      const { samples } = await api("/api/voice/samples");
      state.done = new Set(samples.map((s) => s.promptId));
      const minutes = samples.reduce((a, s) => a + s.durationSec, 0) / 60;
      mine.replaceChildren(
        el("div", { class: "card-head" }, el("h2", {}, `${t("myRecordings")} · ${samples.length} · ${minutes.toFixed(1)} min`)),
        el("ul", { class: "recordings" }, samples.slice(0, 50).map((s) => el("li", {},
          el("span", { lang: s.language }, s.text),
          el("button", { class: "del", onclick: async () => {
            await api(`/api/voice/samples/${s.id}`, { method: "DELETE" });
            await refreshMine(); next();
          } }, t("delete"))))),
        el("button", { class: "link danger", onclick: async () => {
          if (!confirm(t("withdrawConfirm"))) return;
          await api("/api/voice/consent", { method: "DELETE" });
          toast(t("withdrawn"));
          showConsent();
        } }, t("withdraw")));
    }

    function next() {
      if (disposed) return;
      const prompts = promptsFor(state.lang);
      const todo = prompts.filter((p) => !state.done.has(p.id));
      if (!todo.length) return card.replaceChildren(el("p", {}, t("allDone")));
      const prompt = todo[state.index % todo.length];
      renderPrompt(prompt, prompts.indexOf(prompt) + 1, prompts.length);
    }

    function renderPrompt(prompt, i, n) {
      const root = RANGES[state.range];
      const notes = guideNotes(prompt, { root, bpm: BPM });
      const words = g2p(prompt.text, prompt.lang);
      const syllEls = notes.map((nt) => el("span", { class: "syl" }, nt.syllable));
      const status = el("p", { class: "muted small", role: "status" }, t(prompt.kind === "sweep" ? "sweepHint" : "listenCountIn"));
      const recBtn = el("button", { class: "primary rec", onclick: () => record(prompt, notes, syllEls, status, recBtn) }, `● ${t("recordPrompt")}`);
      card.replaceChildren(
        el("div", { class: "card-head" }, el("h2", {}, `${i} / ${n}`),
          el("button", { class: "secondary sm", onclick: () => { state.index++; next(); } }, t("skip"))),
        el("p", { class: `prompt-text ${prompt.kind}`, lang: prompt.lang }, syllEls),
        el("p", { class: "phonemes", "aria-label": "phonemes" }, words.map((w) => w.phonemes.join(" ")).join("  ·  ")),
        status, el("div", { class: "row" }, recBtn));
    }

    async function record(prompt, notes, syllEls, status, recBtn) {
      const mime = pickAudioMime();
      if (!mime) return toast(t("recordUnsupported"));
      try {
        mic ??= await navigator.mediaDevices.getUserMedia({
          // Raw voice for training: no echo cancellation, denoising or auto gain.
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        });
      } catch {
        return toast(t("cameraDenied"));
      }
      const ctx = engine.ensure();
      if (ctx.state === "suspended") await ctx.resume();
      engine.cents = 0;
      recBtn.disabled = true;
      const chunks = [];
      const rec = new MediaRecorder(mic, { mimeType: mime });
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const started = new Promise((r) => (rec.onstart = r));
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start(250);
      await started;
      const recT0 = ctx.currentTime;
      const first = engine.playGuide(notes, { bpm: BPM, at: ctx.currentTime + 0.3 });
      const offset = first - recT0;
      const end = notes[notes.length - 1].start + notes[notes.length - 1].dur;
      status.textContent = t("listenCountIn");
      // Karaoke highlight of the current syllable.
      clearInterval(timer);
      timer = setInterval(() => {
        const now = ctx.currentTime - first;
        syllEls.forEach((s, k) => s.classList.toggle("now", now >= notes[k].start && now < notes[k].start + notes[k].dur));
      }, 30);
      await new Promise((r) => setTimeout(r, (offset + end + 0.8) * 1000));
      rec.stop();
      await stopped;
      clearInterval(timer);
      syllEls.forEach((s) => s.classList.remove("now"));
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      const duration = offset + end + 0.8;
      const labelled = notes.map((n) => ({
        syllable: n.syllable, midi: n.midi,
        start: Math.round((offset + n.start) * 1000) / 1000, dur: Math.round(n.dur * 1000) / 1000,
      }));
      review(prompt, blob, labelled, duration, status, recBtn);
    }

    function review(prompt, blob, labelled, duration, status, recBtn) {
      const url = URL.createObjectURL(blob);
      const audio = el("audio", { src: url, controls: true });
      const keep = el("button", { class: "primary", onclick: async () => {
        keep.disabled = true;
        try {
          const { audio: a } = await api("/api/voice/audio", { method: "POST", body: blob, raw: true, headers: { "Content-Type": blob.type } });
          await api("/api/voice/samples", { method: "POST", body: {
            audioId: a.id, promptId: prompt.id, kind: prompt.kind, language: prompt.lang, text: prompt.text,
            phonemes: phonemeString(prompt.text, prompt.lang), notes: labelled, bpm: BPM, cents: 0,
            durationSec: Math.round(duration * 100) / 100,
          } });
          URL.revokeObjectURL(url);
          toast(t("saved"));
          await refreshMine();
          next();
        } catch (err) { toast(err.message); keep.disabled = false; }
      } }, t("keep"));
      const redo = el("button", { class: "secondary", onclick: () => { URL.revokeObjectURL(url); next(); } }, t("redo"));
      status.replaceChildren(audio);
      recBtn.replaceWith(el("div", { class: "row" }, keep, redo));
    }

    await refreshMine();
    next();
  }

  api("/api/voice/consent").then(({ consent, currentVersion }) => {
    if (disposed) return;
    if (consent?.version === currentVersion) showRecorder();
    else showConsent();
  }).catch((err) => toast(err.message));

  return () => {
    disposed = true;
    clearInterval(timer);
    mic?.getTracks().forEach((tr) => tr.stop());
    mic = null;
  };
}
