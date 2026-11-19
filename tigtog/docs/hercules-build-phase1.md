Tigtog — Phase 1: replace the MusicGen beat with Tigtog's own traditional ጓይላ engine, and make the reference songs private.

Context. The owner tested the current AI-generated beats and said they are "totally not Tigrigna — Indian beats". Tigtog's focus is traditional Tigrinya music and Tigray rhythms. A deterministic Web Audio engine was built and measured against real Tigrinya recordings outside Hercules; bring it in. Do this phase only, then stop and report.

1. Add the engine files UNCHANGED (plain ES modules, no dependencies) to src/lib/tigtog/. Download them from these exact, pinned URLs (public GitHub, fixed commit):
   - https://raw.githubusercontent.com/mulubrhandagnew-hexa/HeXA-Tech-App/1c5eb5e2eb8c24d179e04993bd1cc138fd203386/tigtog/public/music.js
   - https://raw.githubusercontent.com/mulubrhandagnew-hexa/HeXA-Tech-App/1c5eb5e2eb8c24d179e04993bd1cc138fd203386/tigtog/public/fidel.js
   - https://raw.githubusercontent.com/mulubrhandagnew-hexa/HeXA-Tech-App/1c5eb5e2eb8c24d179e04993bd1cc138fd203386/tigtog/public/g2p.js
   Guide (read it): https://raw.githubusercontent.com/mulubrhandagnew-hexa/HeXA-Tech-App/1c5eb5e2eb8c24d179e04993bd1cc138fd203386/tigtog/HERCULES_HANDOFF.md
   Do not rewrite or "improve" music.js; its numbers were tuned against real recordings. If a TypeScript wrapper is needed, add a thin typed wrapper file, not edits.

2. Use it for the studio's beat instead of MusicGen.
   - Create one MusicEngine per page (new MusicEngine()); start it only from a user tap (browser audio rule): await engine.start(); engine.stop().
   - Defaults: engine.rhythm = "guaylaWedding" (traditional Tigray Guayla, 88 BPM), engine.scale = "tizitaMajor", engine.instrument = "krar", engine.key = "A", engine.cents = 0.
   - Controls (labels from the existing i18n; Tigrinya terms): ቕኒት (scale: Object.keys(SCALES)), ስዕስዒት (rhythm: RHYTHM_ORDER, traditional first), instrument (INSTRUMENTS: krar=ኽራር, masinko=ጭራ-ዋጣ, washint=ሸምበቆ, embilta=እምብልታ), key (KEYS), fine tune −50…+50 cents (engine.cents), tempo (engine.bpm).
   - Melody: engine.notes is a Set of "row:column" strings; generateMelody(engine.rhythm) gives a new one; columnsFor(rhythm) and ROWS give the grid size; engine.onStep = (col) => … for the playhead.
   - Recording a music video: engine.recordDest.stream is the audio MediaStream (mix it with a canvas.captureStream() for MediaRecorder); engine.analyser for visualisers.
   - On page leave: engine.stop().
   - Keep MusicGen only as an optional, clearly labelled "AI experiment" if it is easy; the default and recommended path must be the Tigtog engine. Do not call MusicGen automatically.

3. Real ከበሮ recordings (optional, prepared). The engine loads real drum hits if present: await engine.loadDrumSamples(baseUrl) reads `${baseUrl}/manifest.json` = {"dum": ["dum_01.wav",…], "ta": [...]} and falls back to the synthesized drum if missing. Serve these from the app (they are not private). Call it once after creating the engine; ignore failures.

4. Make the reference songs private — required.
   Files & Media gives every file a public CDN URL (confirmed by Hercules support). The commercial reference songs currently there (Gebrehiwet Gebremaryam "Guramayle", Merkeb, Timnit Welday, Eyasu Berhe, Wedi Tukul, and others) are other artists' recordings and must not be publicly downloadable from Tigtog, and must not be used to condition AI generation.
   - Stop referencing them from any generation code path (tigrignaPresets, referenceLoops, culture library defaults).
   - Remove them from Files & Media. Before deleting, list exactly which files you will remove and ask the owner to confirm.

5. Check and report.
   - Run the full test suite (baseline was 230 passing); add tests for the wrapper if you add one.
   - In the preview (do not publish yet — the owner reviews first; tigtog.app is live): the studio opens on ጓይላ ባህላዊ, a tap plays the beat, there is no bass in the traditional rhythm, switching rhythm/scale/instrument/key works, and no request goes to Replicate/MusicGen unless the user explicitly chooses the AI option.
   - Confirm no file in Files & Media is one of the reference songs.
   - Report what changed, which files, test results, and anything you could not do.

Not in this phase (later phases): the "Teach Tigtog to sing" voice dataset (it needs private backend storage, never Files & Media), Fidel typing in every text field, and the tigtog.app domain (already live — do not change it).

Do not publish. Stop after the report so the owner can review the preview.
