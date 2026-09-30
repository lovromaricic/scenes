# Scenes — build notes

A beginner-friendly, fully in-browser video editor. This file records decisions, simplifications,
known issues and ideas, phase by phase. A summary is at the end.

## How to run

```bash
npm install          # .npmrc sets legacy-peer-deps (see below)
npm run dev          # editor at http://localhost:5173, component gallery at /design
npm run build        # static site in build/
npm test             # unit + component tests (Vitest)
npm run test:e2e     # Playwright end-to-end tests (builds and serves on 127.0.0.1:4317)
npm run lint         # prettier --check + eslint
npm run check        # svelte-check (TypeScript strict)
```

## Architecture

- `src/lib/model/` — pure TypeScript editing model (types, catalogs, timeline maths, time formatting).
  No DOM, no Svelte; unit tested with Vitest.
- `src/lib/ui/` — reusable design-system components (Button, IconButton, PillStepper, ChipGroup,
  SwatchPicker, Slider, Panel, Field, FloatingToolbar, Divider).
- `src/lib/editor/` — editor screens (TopBar, AddColumn/AddPanel, Stage, Inspector, Storyboard…).
- `src/lib/styles/tokens.css` — every design token. Components use only these variables.
- Later phases add `src/lib/media/` (Mediabunny + IndexedDB), `src/lib/render/` (WebGL2 compositor),
  `src/lib/audio/` (Web Audio) and `src/lib/playback/` (the rAF loop, outside Svelte reactivity).

## Decisions

### Phase 1

- **Tooling versions.** SvelteKit 2.70 / Svelte 5 / Vite 8 / Vitest 5 / TypeScript 6. The scaffold puts
  the Svelte config inside `sveltekit()` in `vite.config.ts` (no `svelte.config.js`).
- **Node 23 / npm peer deps.** The machine runs Node 23, which is outside some packages' declared
  `engines` range, so the scaffold's `engine-strict` was dropped. npm 10.9 crashes resolving
  Vitest 5's optional peers, so `.npmrc` sets `legacy-peer-deps=true`. Everything builds and runs fine.
- **Static SPA.** `adapter-static` with `fallback: 'index.html'`, `ssr = false`, `prerender = false`
  in `src/routes/+layout.ts`.
- **Test server port.** Playwright serves the production build on `127.0.0.1:4317` (4173 was already
  taken by another local app on this machine).
- **Tokens only.** All colours come from the six palette tokens, plus tints mixed from them with
  `color-mix()`. The one exception is the mood swatches (`--mood-*`), which are content that
  previews each colour mood, not interface chrome.
- **Accent use.** Accent appears only on the playhead, selection outlines (cards, captions, selected
  text on the preview, selected mood swatch) and the "Save video" button.
- **Transitions don't shorten the video.** The video's length is the sum of the scene lengths, and a
  transition straddles the cut. This keeps cards, captions and sounds on one simple time scale.
  (How the frames on either side of the cut are filled is decided in Phase 6.)
- **Photos ignore speed.** A photo scene's length is set directly, so the Speed chips only show for videos.
- **Storyboard scale.** The storyboard fits the whole video to the available width
  (clamped to 14–160 px per second; it scrolls horizontally past that). Card width is exactly
  proportional to length, so very short scenes get narrow cards (the duration label hides under 88px).
- **Placeholder content.** Phase 1 uses a static demo project (`src/lib/editor/placeholder.ts`) with
  mood gradients as thumbnails and a generated waveform. The on-preview text is drawn with HTML/CSS
  for now; from Phase 4 the WebGL compositor draws text so export matches the preview.
- **Keyboard.** Chip groups and swatches are radio groups (arrow keys move the selection); the
  floating toolbar is a `role="toolbar"` with roving focus; the playhead handle is a focusable
  button (←/→ nudge 0.1s, Shift for 1s, Home/End).
- **Reduced motion.** Duration tokens drop to 0 under `prefers-reduced-motion`, and a global rule
  stops CSS transitions and animations.
- **Tablet.** Below 1280px the side columns get narrower via tokens. More work planned in Phase 8.

### Phase 2

- **Media storage.** Imported files are stored as Blobs in IndexedDB (`media` store) with their
  metadata; thumbnails (320px JPEG) in a separate store. Mediabunny reads straight from the Blob
  (`BlobSource`), so nothing is loaded fully into memory. `navigator.storage.persist()` is requested
  on first import.
- **Frame decoding and caching (scrubbing).** Each scene has its own `VideoFrameSource`
  (`src/lib/media/frames.ts`): a Mediabunny `CanvasSink` iterator decodes frames into a time-sorted
  cache (`FrameCache`) around the playhead — 0.6s behind / 0.8s ahead when paused, 1.5s ahead while
  playing, max 90 frames. Asking for a time the cache doesn't cover restarts decoding from the nearest
  keyframe; until the exact frame arrives the nearest cached frame is shown, so scrubbing never goes
  blank. Sources far from the playhead drop their cache and decoder. Preview frames are decoded at
  most 1280px on the long side.
  Measured on a 1080p/30fps clip with a 2s keyframe interval (Chrome, M-series Mac): random seeks
  land on the exact frame in 40–115ms; drag-scrubbing nearby is 0–20ms; playback showed 0 stale
  frames over 3s at 60fps.
- **Sources per scene, not per file.** Two scenes from the same file (after a split) each get their
  own decoder, so the next scene can be pre-decoded while the current one plays.
- **Audio clock.** The Web Audio `AudioContext` is the master clock while playing; the preview shows
  the frame matching what's audible (`currentTime - outputLatency`). Clip audio is streamed with
  `AudioBufferSink`, scheduled ≤2s ahead, with 10ms ramps at scene edges to avoid clicks. Speed
  changes use `playbackRate`, so 0.5×/2× sound changes pitch (simple, and expected in beginner apps).
- **Fit.** Scenes always fill the frame ("cover"), cropping the edges when the shape differs
  (e.g. landscape clips in a 9:16 video). A per-scene Fit/Fill option is an idea for later.
- **Space key** always plays/pauses except while typing in a text field — even when a button has
  focus (Enter still presses buttons). This matches what people expect from video apps.
- **Thumbnails** tile along wide cards like a filmstrip (one frame, repeated) rather than
  decoding several frames per clip.
- **Tests** run in real Chrome (`channel: 'chrome'`), since Scenes targets Chrome/Edge and export
  needs its H.264/AAC encoders. Fixtures are generated by `scripts/make-fixtures.sh` (ffmpeg) and
  committed (≈270 KB) so the tests don't need ffmpeg. `window.__scenes` exposes the editor store for
  tests and debugging.
- **Unsupported browsers** (no WebCodecs, WebGL2, Web Audio or IndexedDB) get a friendly page
  pointing to Chrome or Edge.

### Phase 3

- **Edit functions are pure** (`src/lib/model/edits.ts`): move, remove, set length, trim an edge,
  set speed, split. The store (`src/lib/state/editor.svelte.ts`) only wires them to the UI.
- **Undo = project snapshots.** `History<Project>` stores before/after snapshots of the whole
  project (it holds no media, so snapshots are tiny). This can't drift out of sync with the edit
  code. Quick repeats of the same control (e.g. holding the Length stepper, dragging the volume
  slider) merge into one step within 1s. A multi-file import is one step. Drags (trim, reorder)
  record one step when released. Limit: 200 steps. History isn't kept across reloads.
- **Trimming** by dragging card edges (handles appear on the selected card, or on hover). While
  dragging, the storyboard scale is frozen, a badge shows the new length, and the preview "peeks" at
  the exact frame at the new edge, without moving the playhead. Trimming the start moves only that
  card's left edge until release, then later cards close the gap.
- **Length stepper** grows/shrinks at the end; if the clip runs out, the extra comes from the start.
  Steps of 0.5s, min 0.5s, max = whole clip at the current speed (photos: 60s).
- **Speed** keeps the same part of the clip, so the scene gets longer (0.5×) or shorter (2×).
- **Split** (S key or "Split here") splits the scene under the playhead, not the selected one; the
  outgoing transition stays on the second half. Refused within 0.25s of a cut, with a friendly toast.
- **Reorder** by dragging a card (5px threshold so clicks still select), with auto-scroll near the
  edges, or with Alt+←/→ on a focused card.
- **Selecting a scene** moves the playhead to its start if it isn't already inside it, so the
  preview shows what you picked.
- **Keyboard:** Space play/pause, S split, Delete/Backspace remove, ←/→ one frame (Shift: 1s),
  Home/End, Esc deselect, ⌘/Ctrl+Z undo, ⌘/Ctrl+Shift+Z or Ctrl+Y redo.
- **Autosave** writes the whole project (plus playhead and selection) to IndexedDB at most 300ms
  after the first unsaved change — a throttle, not a debounce, so a burst of edits can't postpone
  saving. On page hide/close, an extra synchronous copy goes to `localStorage`, because an async
  IndexedDB write can be cut off by the unload; on load the newer copy wins and is written back to
  IndexedDB. The top bar shows "Saved on this device".
- **Restore** loads the most recently edited project. Scenes whose file is missing (storage cleared)
  are left out with a toast. Media no project uses any more is deleted at start-up.
- **Project title** is editable in the top bar (click it; Enter saves, Esc cancels).

### Phase 4

- **Text is drawn by WebGL, not HTML.** Each text item is drawn with Canvas 2D into a sprite
  (`src/lib/render/text.ts`), uploaded once as a texture and composited with its animation
  (opacity/offset/scale) by the compositor. Export will use the exact same code, so words look
  identical in the saved video. Sprites are cached by id + words + style + frame size.
- **Sizes scale with the frame's short side**, so text looks the same in 16:9, 9:16 and 1:1 and
  at any resolution. Lines wrap at 84% of the frame width; Shift+Enter adds a line break.
- **Six styles** (Clean white, Bold box, Serif italic, Outlined, Highlighter, Big title) are defined
  once as data (`TEXT_STYLE_SPECS`). The same spec generates CSS (`textCss`) for the style picker
  tiles and for typing in place. The highlighter yellow and the white/ink text colours are part
  of the rendered video (content), not interface colours.
- **Typing in place.** Adding a title/caption, double-clicking the words, "Edit words" or Enter on
  the selected words opens a `contenteditable="plaintext-only"` box over the video, styled with the
  CSS mirror; the WebGL copy is hidden meanwhile. Enter saves, Esc cancels, clicking away saves;
  empty words remove the item.
- **Moving words** on the preview snaps to the centre lines (accent guides show when snapped).
  Arrow keys nudge the selected words (Shift = 5%). The Inspector also has Top/Middle/Bottom presets.
- **Animations:** fade, slide up, pop (0.5s entrance, shortened for very short text), plus an
  automatic 0.25s fade out at the end for any animated text. "None" is a plain cut in and out.
- **Words lane:** pills stack into rows when they overlap; drag to move in time, drag the ends to
  change start/end; Alt+←/→ on a focused pill moves it by 0.1s (Shift 1s). While dragging, the
  playhead follows so you can see the words.
- **Selecting words** moves the playhead into their time (just after the entrance animation).
- Text timing is kept inside the video when edited, but texts are not automatically moved if the
  video later gets shorter (they simply stop at the end).
- **Fixed a playback race** found by the e2e tests under load: for up to 400ms after pressing play
  (waiting for the first frame) the render loop read a stale audio clock and jumped the playhead
  back to where the _previous_ playback started. The clock is now only read once sound has
  actually started. Also: imports wait for the saved project to finish restoring, and restoring
  never replaces work already started in the session.

### Phase 5

- **One mixing model for everything.** Scene sound, music and voiceovers all become `AudioClip`s
  (`src/lib/audio/clips.ts`) with volume and fades. Live playback (`AudioEngine`) and the offline
  mix (`mixdown()`, used by export and by tests) schedule gain with the same function
  (`scheduleClipGain`), so what you hear is what gets saved.
- **Music** is one song for the whole video (adding another replaces it, with an undo hint). It
  starts at 0:00, stops when the video ends, and fades in 1.5s / out 3s when "Fade in and out" is on
  (default). "Start the song at" skips an intro. Default volume 60%. It doesn't loop if shorter
  than the video (the inspector says so). Idea: loop option, auto-lower music under voiceovers.
- **Volume changes while playing** retune the running gain nodes instead of restarting playback,
  so dragging a slider is smooth; timing changes restart the sound from the playhead.
- **Voiceover:** Sound → Voiceover asks for the mic, counts down 3-2-1, then records while the video
  plays _muted_ from the playhead (so speakers don't echo into the mic). Stop with the button, Space
  or Esc, or it stops when the video ends. Recordings are WebM/Opus from MediaRecorder, stored like
  any other file. Drag a voiceover in the Sound lane to move it.
- **Waveforms** are computed once per file (streamed decode, 25 peaks/s, square-root scaled so quiet
  audio is visible) and stored in IndexedDB (`waveforms` store, schema v2), recomputed if missing.
- **Tests measure the actual mix**: the e2e tests render the soundtrack with the app's offline mixer
  and use a Goertzel filter to check the balance of the 220 Hz "music" against the 440 Hz clip,
  the fades, and that the (fake) microphone recording sits exactly where it was recorded.
- Fixed: `.webm` recordings (audio/webm) were detected as video because the extension was checked
  before the MIME type. MIME type now wins.

### Phase 6

- **Transitions straddle the cut** (`src/lib/model/composition.ts`): they run from half their
  length before the cut to half after, so the video's length doesn't change. The outgoing scene
  keeps playing into its trimmed-off footage when the clip has some ("handles"), otherwise it holds
  its last frame; the incoming scene likewise starts early or holds its first frame. Lengths:
  crossfade 0.8s, fade to black 1.0s, slide 0.6s, zoom 0.7s, shortened to fit short scenes.
  There is no length control (kept simple on purpose).
- **Sound doesn't crossfade** — audio still cuts at the scene boundary (the 10ms edge ramps avoid
  clicks). Idea for later: short audio crossfades matching the picture.
- **Compositor pipeline:** each scene frame is cover-fitted and graded into an offscreen
  framebuffer, a transition shader blends the two (crossfade, dip to black, push slide, zoom
  through, all smoothstep-eased), then text sprites go on top. Without a transition the scene is
  drawn straight to the screen.
- **Looks** are six grade presets (gain, contrast, saturation, lift) in `src/lib/model/moods.ts`,
  applied by the same shader for every frame. `applyGrade()` is an exact CPU mirror; the e2e test
  checks the GPU output against it (within 4/255).
- **Whole video vs. one scene:** the Looks panel sets the whole-video look; a scene's Mood swatches
  give it its own look ("This scene only"), with "Match the whole video" to go back. The Looks
  panel says how many scenes have their own look, with "Use this look for every scene".
- **Transition picker** opens from the round button between cards (fixed-positioned so the
  storyboard's scroll area can't clip it), lists the five options with a short description, works
  with arrow keys and Esc, and jumps the playhead to just before the cut so you see the result.
- The favicon is now a static file linked from `app.html` (Chrome was requesting `/favicon.ico`
  before JavaScript added the icon link, causing a 404).

### Phase 7

- **Export renders through the preview's compositor.** `src/lib/export/exporter.ts` builds every
  frame with the same `compose()` + `Compositor` + text sprites as the preview (shared helpers in
  `src/lib/render/frame.ts`), on an OffscreenCanvas at the output size, and feeds it to a
  Mediabunny `CanvasSource`. The e2e test compares exported frames (via ffmpeg) with the preview's
  pixels at the same times, including mid-crossfade, the look and the caption.
- **Streaming, bounded memory:** each scene is read by one sequential decoder at the size the
  output needs (never upscaled; freed once passed), sound is mixed offline in 2s chunks with the
  same mixer as playback, and the file is written straight to disk in OPFS via `StreamTarget`
  (MP4 with the index at the end, `fastStart: false`). If OPFS isn't available it falls back to
  memory. Only the latest export is kept in OPFS so its download link keeps working.
- **Presets:** Best quality (1080p short side, ~12 Mbps at 16:9), For social (1080p, ~5.6 Mbps),
  Small file (720p, ~2.2 Mbps); bitrate scales with pixel count, so 9:16 and 1:1 get the same
  quality per pixel. All presets match the project's shape. 30 fps output. Audio AAC 192/128/96 kbps.
  Decision: "For social" differs from "Best" by file size, since every preset already follows the
  video's shape.
- **Format:** MP4 (H.264 + AAC) when `canEncodeVideo/Audio` say so, otherwise WebM (VP9 + Opus),
  and the dialog says so before saving. `localStorage['scenes:force-webm'] = '1'` forces the
  fallback (used by the e2e test).
- **Dialog:** presets with size estimates → progress bar with a friendly time estimate and
  Cancel (Esc also cancels) → "Your video is ready" with the file name and size; the download
  starts automatically, with "Download again". The dialog is modal, so the project can't change
  mid-export.
- Measured: the 30-second, 3-scene 1080p test project (text, music, crossfade, look) exports in
  about 8 seconds on this Mac.

### Phase 8

- **Empty state:** a friendly drop zone in the preview with one big button and three numbered
  steps (add clips → put in order, add words & music → save). After the first import a tip toast
  points at drag-to-reorder and the `?` shortcuts. "Save video" and "Watch" are disabled until
  there's something to save or watch.
- **Loading states:** "Opening your project…" while the last project restores, "Adding…" cards
  while files are read, a saving progress bar with time left, and waveforms appear when ready.
- **Shortcuts overlay:** `?` (or the keyboard button in the top bar) opens a dialog listing every
  shortcut.
- **Watch:** full-screen playback from the start (Fullscreen API; falls back to a full-window
  overlay), controls fade out after 2.5s of stillness, click/Space to pause, ←/→ jump 5s, a
  clickable progress bar, Esc or "Back to editing" to return. The player draws into Watch's own
  canvas via a small canvas stack, then goes back to the editor's canvas.
- **Tablet landscape (1024–1279px):** slimmer side columns, compact Add buttons, a shorter scene
  row, and bigger touch targets for trim handles, transition buttons and word-pill edges on coarse
  pointers. Tested at 1024×768 and 1180×820: no horizontal scroll, every main control on screen.
  Transition buttons sit above trim handles so both stay usable.
- **Toasts moved to the top** (under the top bar). At the bottom they covered the Sound lane and
  swallowed drags there — found by the voiceover e2e test once the longer first-import tip appeared.
- **Accessibility:** axe-core (WCAG 2 A/AA) runs on the empty editor, a full editor with words,
  the save dialog and `/design` with no violations. (The checker has to wait for fade-in animations
  to finish, or it measures half-faded text.)
- **Performance with a 5-minute project** (10 × 30s 1080p scenes, a 5-minute song, 20 texts,
  M-series Mac, Chrome): playback across a cut, rapid jumps all over the timeline and drag-scrubbing
  all ran at 60fps with no frame over 33ms and no long tasks; JS heap ≈107MB. Exporting all
  5 minutes at 1080p ("For social", with transitions and captions) took 47s (≈6× real time) and
  the 214MB file decodes cleanly in ffmpeg; the JS heap stayed between 54 and 127MB during export.
  Nothing needed fixing.

## Known issues / ideas

- Tablet landscape: the preview gets small at 1024×768 because the storyboard is fixed height. Phase 8.
- Stepper hold-to-repeat works with a pointer; keyboard users press repeatedly.
- The Words, Sound and Looks panels are still placeholders (Phases 4–6). Clips works.
- Mood swatches are stored per scene but only change the picture from Phase 6.
- Only one project exists at a time (no project list). Ideas: a small "Your videos" page.
- Undo history isn't persisted across reloads.

## Summary

**Scenes** is a complete, static, client-side video editor built with SvelteKit (Svelte 5 runes,
TypeScript strict), Mediabunny/WebCodecs, WebGL2, Web Audio and IndexedDB. Everything happens on
the user's device.

What you can do:

- Drop in photos and videos; each becomes a scene card (thumbnail, name, length) in a storyboard.
- Play, scrub (frame-cached, exact frames), and watch full screen.
- Reorder by dragging cards, trim by dragging card edges (with a live frame peek) or with the
  Length stepper, split at the playhead (S), delete, change speed (0.5×/1×/2×).
- Add titles and captions: six ready-made styles, typed directly on the video, dragged into
  place, with fade / slide-up / pop entrances, timed in the Words lane.
- Add background music with waveform, volumes per scene and for music, automatic fades, and
  record voiceovers at the playhead.
- Pick transitions between scenes (cut, crossfade, fade to black, slide, zoom) and colour moods for
  the whole video or per scene — all WebGL shaders.
- Save an MP4 (H.264/AAC; WebM fallback) in three presets, rendered through the same compositor
  as the preview, streamed to disk with progress, time left and cancel.
- Undo/redo everything; the project autosaves continuously and comes back on reload.

How to run: see "How to run" at the top (`npm install`, `npm run dev`; `npm test` and
`npm run test:e2e` for the tests — the e2e suite uses installed Google Chrome, and the save-video
tests use ffmpeg/ffprobe to inspect the output if they're installed).

Tests: ~120 unit/component tests (editing model, history, timing, text animation, moods,
transition composition, audio clips, export presets, autosave) and 28 Playwright tests in real
Chrome covering every phase's "done when" scenario, plus automated accessibility checks.
