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

## Round 2: fixes and features

### 1. Filmstrip thumbnails (bug fix)

- **Root cause:** there was no filmstrip. Each card showed the _single_ 320px thumbnail made at
  import (one frame ~1s into the clip), repeated along the card with CSS `background-repeat`.
  It ignored the scene's trim, speed and length entirely — a Phase 2 shortcut (it was even written
  down as "one frame, repeated") that looked like a filmstrip but wasn't one.
- **Now:** `Filmstrip.svelte` draws one tile per slot along the card, each the video's shape, and
  samples the middle of each tile's slice of the scene's _visible source range_
  (`sampleTimes(sourceStart, sourceEnd, tiles)`), so trimming, splitting and speed changes (which
  change the card's width, hence the number of tiles) all update it.
- **Background decoding:** `src/lib/media/filmstrip.ts` keeps one small (144px tall), separate
  decoder per file, processes requests one file at a time with `canvasesAtTimestamps` (one pass per
  batch), yields to the main thread between frames, and caches frames (as ImageBitmaps, up to 800,
  LRU) by file and time rounded to 0.1s. The import thumbnail shows until the tiles arrive.
- Test: `e2e/filmstrip.test.ts` imports the clip that changes colour every second and checks the
  tiles show five-plus different colours in order, then trims to 2s and checks only red and green
  remain.

### 2. Aspect switch removed from the stage

- The 16:9 / 9:16 / 1:1 switch that floated on the right under the preview is gone (the project
  format control in the top bar replaces it, section 4). The row under the preview holds only the
  play button and the time, centred under the preview (checked by the layout test).

### 3. Using the empty space

- **Preview size:** width _and_ height are both computed from container-query units
  (`min(100cqw, 100cqh × ratio)` / `min(100cqh, 100cqw ÷ ratio)`) inside a padded viewport, so the
  preview fills whichever dimension runs out first, with a margin all round. A 9:16 project uses the
  full height. It animates (200ms) only when the project's shape changes; plain window resizing is
  immediate, because an animated size lags behind the pointer. Stage padding was tightened.
- **"Your media"** under the Add buttons lists every photo and video imported into the project
  (new `project.library`, migrated from the scenes for older projects), with thumbnails, durations
  and a "Not used" badge. Click adds it as a new scene at the end; drag it onto the storyboard to
  insert it where the (ink) drop marker shows. Media in the library is kept even when no scene uses
  it (the start-up cleanup now respects the library). Add buttons were made a little more compact
  to leave room for it.
- Playwright note: HTML5 drag-and-drop is tested with raw mouse moves; `locator.dragTo` waits for
  the target to be "stable" using animation frames, which Chromium pauses during a native drag.

### 4. Project format and resolution

- `project.aspect` is replaced by `project.format` = `{ preset, width, height, fps }`
  (`src/lib/model/format.ts`, pure and unit tested). Old saved projects are migrated to 1080p at
  30 fps in their old shape.
- **Presets:** Landscape 16:9, Vertical 9:16, Square 1:1, Portrait 4:5, Classic 4:3, Cinematic
  21:9, each at 720p / 1080p / 4K (short side 720 / 1080 / 2160). When the long side would pass
  4096 (4K cinematic would be 5040×2160) both sides shrink together, so it's 4096×1756 —
  a decision to keep every format encodable with H.264.
- **Custom** width × height: rounded to even numbers, clamped to 240–4096 each, applied on Enter or
  when the field loses focus. **Frame rate:** 24 / 25 / 30 / 60.
- **First clip decides:** a new project takes its format from the first imported photo or video —
  its shape (a preset when within 2%, otherwise Custom), the largest standard resolution not
  bigger than the clip (720p minimum), and the nearest standard frame rate (measured with
  Mediabunny packet stats). After that only the user changes it (`project.formatSet`). The first
  import's undo step also undoes the format it chose.
- The top bar shows e.g. "1920 × 1080 · 30 fps"; clicking it opens the Project format panel
  (shape cards with a drawn outline, size chips or custom fields, frame-rate chips). Every change
  applies immediately and is one undo step.
- Export sizes now come from the format (section 6 finishes the dialog).

### 5. Framing each scene

- `scene.frame = { mode: 'fill' | 'fit' | 'custom', bars: 'black' | 'white' | 'blur', zoom, x, y }`
  (missing on old projects = Fill). One pure function, `frameRect()` in `src/lib/model/framing.ts`,
  decides where the picture goes for any output size; the compositor, the filmstrip tiles and export
  all use it, so they can't disagree. It's relative, so preview and export match at any resolution.
- **Fill** covers the frame (crops). **Fit** shows everything with bars. **Custom**: zoom is relative
  to Fill (1 = Fill; minimum = Fit's size; maximum 4×) and x/y move the picture's centre as a
  fraction of the frame, clamped so the centre stays inside the frame. Choosing Custom starts from
  what you saw (Fill, or Fit's size when coming from Fit).
- **Bars** show whenever the picture doesn't cover the frame (Fit, or zoomed-out Custom): black,
  white, or a blurred copy. The blur is drawn by rendering a cover-fitted copy into a framebuffer
  1/12 the size, then scaling it up through a 9-tap tent filter (slightly darkened); cheap at any
  resolution. Thumbnails use Canvas 2D `filter: blur()` for the same look.
- **Reframing on the preview (Custom):** when a Custom scene is selected and the playhead is in it,
  the whole picture shows as a faded "ghost" around the frame (the area outside is dimmed), with the
  frame outlined. Drag to move, scroll or pinch to zoom, arrow keys / + / − from the keyboard; the
  zoom slider and Reset are in the Frame section. A drag or pinch is one undo step; wheel and slider
  changes merge. The ghost is clipped to the preview area only while reframing, so it never covers
  the play controls (and text popovers aren't clipped otherwise).
- **Apply to all scenes** copies the whole framing (mode, bars, zoom, position) to every scene.
- Fixed along the way: resizing the preview (window or format change) cleared the WebGL canvas until
  the next frame, a brief black flash; the player now redraws immediately on resize. And
  `Compositor.dispose()` crashed on gaps in its buffer lists (only blur buffers allocated), which
  turned a successful export into an error.

### 6. Save video follows the project format

- Export renders at the project's size and **frame rate** (24/25/30/60), through the same framing
  and compositor as the preview.
- Presets now control quality relative to the format: **Best quality** (project size, high
  bitrate), **Balanced** (project size, about half the bitrate), **Small file** (short side scaled
  down to 720 if the project is bigger, never up; lower bitrate). Bitrate scales with pixels and
  with frame rate to the power 0.7 (consecutive frames at 60 fps are more alike, so doubling the
  frame rate doesn't need double the bits).
- Each preset card shows the final size, frame rate and an estimated file size before saving.
- Tests: a 1080p 60 fps project saves as 1920×1080 at 60/1 fps with Balanced; Small file turns a
  vertical 1080p project into 720×1280 at its 25 fps; the framing test saves a 720×1280 project and
  compares its frames with the preview in Fill, Fit-with-blur and Custom.

## Crop tool

- **Model:** `scene.crop = { x, y, w, h }` in the source clip's own pixels (missing = the whole clip).
  All crop maths is pure and unit tested in `src/lib/model/crop.ts`: edge/corner/move drags,
  snapping to the clip's edges and centre lines, Shift/locked-shape corners (anchored at the
  opposite corner), "largest box of this shape centred on the current box", the four side values,
  and clamping (inside the clip, at least 64 × 64). A crop covering the whole clip is stored as
  "no crop".
- **Order: crop, then frame.** The layer shader samples only the cropped part of the texture
  (`uCrop`), and framing (`frameRect`) works with the cropped size, so Fill / Fit / Custom place the
  cropped picture. Blurred bars use the cropped picture too. Because the same `layerInput()` is used
  by the preview, Watch mode and export, and the filmstrip uses the same crop and framing maths with
  Canvas 2D, they all match. Custom-framing zoom limits and the reframe ghost use the cropped size.
- **Crop mode** (Crop button next to Frame, the C key, or double-clicking the picture): playback
  pauses and Space won't start it, but scrubbing (ruler, ←/→) still works; the preview shows the
  scene's whole source, fitted, without its crop, framing or words. The box has 8 handles (corners
  and edge midpoints), dragging inside moves it, arrow keys nudge it (Shift = 10 px), the outside is
  dimmed, a thirds grid shows while dragging, a size label rides under the box, and handles snap
  within 8 screen pixels. When a shape is locked, only the corner handles show (edges would break
  the shape). Double-clicking inside the box also applies.
- **Crop panel** (replaces the right column): Original and Cropped sizes, Left / Right / Top / Bottom
  fields (typing moves that side live), shape chips (Free, Original, Match project, 16:9, 9:16, 1:1,
  4:5), Reset, Cancel (Esc) and Done (Enter). Enter on a focused button in the panel presses that
  button instead. Undo/redo and editing shortcuts wait until you leave crop mode.
- **After cropping:** the scene settings show "1280 × 800 → cropped to 1280 × 720" with a Crop button,
  a soft note when the picture is enlarged more than 1.15× in the saved video ("Enlarged 1.5×, may
  look a bit soft."), and "Apply crop to all scenes from this clip" when several scenes use the
  same file. Split halves keep the crop. One undo step per Done; saved with the project.
- **Toasts no longer block clicks**: the message body lets clicks through to what's underneath
  (only × is clickable). The first-run tip sat right over the crop box's top handle.
- Tests: `e2e/crop.test.ts` crops the magenta "browser toolbar" off a generated 1280×800 screen
  recording by dragging the top edge (checking the live label), then checks preview, filmstrip and
  the saved 1280×720 MP4 contain no toolbar pixels; plus side fields, shape chips, Shift, snapping,
  Reset, Cancel, undo/redo, crop with Fit/Custom framing (and the enlargement note), applying to
  every scene from the clip, and reload.

## Add column: Looks removed, Cards added

### Looks removed

- The Looks button and its panel are gone. Moods are set per scene in the scene settings (Mood
  section), as before. The store actions that only served the panel (`setProjectMood`,
  `clearSceneMoods`) were removed. `project.mood` stays as the default for scenes without their own
  mood (Natural for new projects; older projects keep theirs); the scene setting's hint and button
  now say "Default look" / "Use the default look".

### Cards

- **A card is a scene with no file** (`kind: 'card'`, `mediaId: ''`) holding
  `card = { background, rect: { color, x, y, w, h, radius } | null }`. The rectangle is stored as
  fractions of the frame (so changing the project format keeps its relative place and size) and
  shown in project pixels; radius 0–1 means square to fully rounded (half the shorter side).
  Pure helpers and tests are in `src/lib/model/card.ts`.
- Cards behave like still photos everywhere timing is concerned (length set directly, speed
  ignored; split, trim, reorder, delete, transitions, Words and Sound all work). Every
  scene-level "is it a photo?" check became "is it not a video?".
- **Rendering:** `drawCard()` (Canvas 2D) draws a card at an exact pixel size. The preview player
  and export render it at the output size into a cached canvas that the compositor uses as the
  scene's picture (cards are never graded, cropped or reframed); filmstrip tiles draw it at tile
  size. So preview, Watch, thumbnails and the saved video all match (checked in the e2e test).
- **Adding:** the Cards button (below Clips) adds a 3-second card after the selected scene (or at
  the end) and selects it. Drag the button onto the storyboard to insert a card where the
  insertion marker shows. New cards are ink (#141417) with no rectangle.
- **Card settings** replace the scene settings: Length, Background (10 swatches: white, ink, the
  accent, soft neutrals and colours, plus a colour picker and a hex field), Rectangle (Add; then
  colour, Width/Height/X/Y in project pixels, Corners slider, Center, Fill frame, Remove
  rectangle), Duplicate and Remove. Speed, Frame, Crop and Mood don't show for cards, and C
  does nothing on a card. Duplicate works for any scene.
- **Rectangle on the preview:** 8 handles and drag-to-move, reusing the crop tool's box logic
  (`dragBox`, now shared: crops are bounded to the clip, card rectangles may overhang the frame,
  minimum 8 × 8), snapping to the frame's edges and centre lines, Shift on a corner to keep
  proportions, arrow keys to nudge, and a live "1200 × 400" label. One drag = one undo step.
- **Fixed on the way:** move-snapping (crop box and card rectangle) could miss because of
  floating-point noise (`snap(y + h) - h` ≠ `y`), so a box dragged right next to the centre didn't
  snap. Snapping now compares distances. And restoring a project would have dropped cards, because
  scenes whose file is missing are left out and a card has no file.

## Known issues / ideas

- Tablet landscape: the preview gets small at 1024×768 because the storyboard is fixed height. Phase 8.
- Stepper hold-to-repeat works with a pointer; keyboard users press repeatedly.
- The Words, Sound and Looks panels are still placeholders (Phases 4–6). Clips works.
- Mood swatches are stored per scene but only change the picture from Phase 6.
- Framing ideas: rotate, "follow the subject" pan over time (Ken Burns), per-scene background colour.
- The reframe ghost uses the preview-quality frame (≤1280px); fine for positioning, soft when
  zoomed far in.
- Crop ideas: rotate/straighten, crop presets remembered per clip, keyboard resizing of the crop box.
- Card ideas: gradients, several shapes, images on cards, saving a card as a reusable style.
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

Round 2 added real filmstrips, a project format (shape, resolution, frame rate), per-scene
framing (fill / fit with bars / custom reframe on the preview), a "Your media" library, and a preview
that fills the stage in any shape.

Tests: ~140 unit/component tests (editing model, history, timing, text animation, moods,
transition composition, audio clips, export presets, autosave) and ~37 Playwright tests in real
Chrome covering every phase's and round's "done when" scenario, plus automated accessibility checks.
