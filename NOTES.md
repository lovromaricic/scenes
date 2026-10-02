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

## Text colour, size and fonts

- **Styles are starting points.** The six styles are data in `src/lib/model/textStyle.ts`
  (base font, fill, box/band and outline as colour + opacity). A text item can override colours
  (`colors.fill`, `colors.box` — the box for Bold box or the band for Highlighter — and
  `colors.outline` colour + thickness), `size` and `font`. `resolveTextStyle()` merges them; the
  canvas renderer, the CSS used while typing, and the style tiles all read the resolved style.
  Picking a style resets the colour overrides to that style's own (font and size are kept);
  "Reset colors" does the same without changing the style.
- **Opacity:** translucent text is drawn opaque into its own layer (letters + outline) and then
  placed with the fill's opacity, so the outline doesn't show through half-transparent letters.
- **Size:** a slider and a number field in project pixels (12–400; now 12–2000, see "Very large words"). Stored as a fraction of the
  frame's short side, so it keeps its look when the format changes.
- **Built-in fonts:** ten SIL Open Font License families bundled as Latin-subset woff2 files in
  `static/fonts` (716 KB total, fetched from their Fontsource npm packages by
  `scripts/fetch-fonts.sh`, licences alongside): Geist, Instrument Serif, Oswald (bold condensed),
  Nunito (rounded), Lora (classic serif), Playfair Display, Space Grotesk, JetBrains Mono, Caveat
  (handwritten), Anton (poster). Nothing is loaded from the internet at runtime for video text.
  (The interface's own fonts still come from Google Fonts, as in the original brief.)
- **Fonts are loaded with the FontFace API** under private names (`sv-<id>`, `sv-face-<id>`), so
  they can't clash with the interface's fonts. `src/lib/render/fonts.ts` loads each face once and
  tracks its status. Drawing never waits: until a font is ready the words use Geist, and the
  sprite cache key includes the font actually in use, so they redraw when it arrives. The player
  starts loading every font a project uses whenever the project changes; export awaits all of them
  before the first frame.
- **On this computer** (Chrome/Edge): "Show fonts on this computer" calls `queryLocalFonts()`
  (permission prompt) and lists installed families. Choosing one copies that face's file (via
  `FontData.blob()`) into IndexedDB (`fonts` store, schema v3), so the project renders the same
  after a reload without asking again. Elsewhere the section explains the browser can't list
  fonts. The Local Font Access permission prompt can't be automated, so this path was tested
  manually; the stored-font path it relies on is the same as for uploads (tested).
- **Uploaded fonts** (.ttf, .otf, .woff2, any browser): stored in IndexedDB. For TTF/OTF the
  family, weight and italic are read from the font's `name` and `OS/2` tables
  (`src/lib/media/fontFile.ts`); WOFF2 is Brotli-compressed, so its style is guessed from the file
  name ("MyFont-BoldItalic.woff2"). Files that don't load as fonts are rejected with a message.
- **Weights and styles** of the chosen family show as chips (Regular, Bold, Italic, Bold Italic…).
  **Recently used** fonts (up to 6, kept in `localStorage`) head the picker. The picker is
  searchable, shows every name in its own font, and always fits in the window.
- **Missing fonts** (e.g. storage cleared): Geist is used at the requested weight, the words show
  a "Font missing" badge on the preview, and the settings say so with "Pick another font".
- **Fixed on the way:** changing a colour on words (or a card's background) that already had an
  override silently failed, because `structuredClone` can't copy Svelte's reactive proxies; the
  store now copies with `$state.snapshot`.
- Tests (`e2e/text-style.test.ts`): built-in font + weights/italic + search + recent + undo; text,
  box and outline colours with hex and opacity measured in pixels; reset; size; an uploaded TTF
  (Pacifico, OFL, fixture) that survives a reload; a deleted font falling back with the warning;
  and the saved MP4's text pixels matching the preview's with Anton and custom colours.

## Project management

### 1. Multiple projects in the app

- **Storage (IndexedDB v4).** `projects` already held one record per project, so the existing
  project simply becomes the first entry in the list; nothing is copied or renamed. It keeps
  its title ("My video"). New projects are called "Untitled video". The upgrade adds a `hash`
  index on `media`, a `files` store (where each project was last saved as a file), and a
  `settings` store.
- **Media per project, stored once.** Files stay in one shared `media` store, and projects refer
  to them by id. That makes "the same file imported twice is stored once" hold across projects
  as well as within one, and it makes duplicating a project free. Each file gets a fingerprint:
  SHA-256 of its size plus three 1 MB samples (start, middle, end), or of the whole file if it
  is under 3 MB. Hashing whole multi-GB videos would take seconds; the samples plus the exact
  size are enough to tell files apart in practice. On import, a matching fingerprint reuses
  the stored file (no probing, thumbnails or storing). Files stored before this version get
  their fingerprint in the background on first launch (`backfillMediaHashes`).
- **Deleting** a project removes its thumbnail and file link, plus the media and uploaded or
  computer fonts that no other project uses (`orphansAfterDelete`, pure and unit-tested).
- **Migration** runs in `migrateProject`, which is shared with project files (section 4). It is
  safe on current data. It handles:
  - the legacy `aspect` field, converted to a format;
  - missing fields, which get defaults;
  - "Your media", rebuilt from the scenes when missing;
  - unknown text styles, which fall back to Clean.
- **One store per project.** `EditorStore(projectId, fresh)`:
  - A fresh project isn't written to storage until something is changed, so opening
    "New video" and leaving creates nothing.
  - Emergency copies (written on pagehide) are now per project: `scenes:unsaved-project:<id>`.
    The home screen stores any newer copy before listing projects.
- **Home-card thumbnails.** A 320 px JPEG of the first scene, in the project's shape, with its
  crop and framing (a card is drawn directly). It is only regenerated when the first scene or
  the format changes, 800 ms after the edit.
- **Persistent storage.** `navigator.storage.persist()` is asked once, on first use. The answer
  is recorded in `settings` (`persistAsked`, `persisted`).
- **Fix found along the way.** The editor now mounts after an async step (choosing which
  project to open). Svelte's `bind:clientWidth/Height` on the preview read its size during that
  first layout (2 px short) and never corrected it, so words and card rectangles were placed for
  a slightly smaller frame. The overlays now take their size from the same ResizeObserver entry
  as the canvas, so they always match the picture.
- Tests:
  - Unit: library actions (duplicate, rename, delete keeps shared files, emergency copies),
    fingerprints, and migration of unknown styles.
  - e2e: a real version-3 database (one project, media without fingerprints) opens unchanged
    as "My video", gets its fingerprint, and re-importing the same file stores nothing new; the
    persistence answer is recorded; the same file imported twice is stored once.

### 2. Home screen

- **Routes.** `/` is the home screen; `/edit/<id>` opens a project. "New video" opens
  `/edit/<new id>?new=1`, which starts empty when nothing is stored under that id. Reloading
  after something was added opens the stored project, never a blank one. The editor is keyed
  by id, so switching projects gives a fresh store. An id that doesn't exist (deleted in another
  tab, or a link from another browser) shows "This video isn't here" with a way back. The
  browser-support check moved to the layout, so it covers every page.
- **Layout.**
  - A large ink "New video" card, then the projects in a responsive grid, most recently edited
    first.
  - Each card shows the project's picture (in its own shape, letterboxed on the surface
    colour), name, length and format in mono ("0:30 · 1920 × 1080"), and "Edited 2 hours ago".
    The edited time refreshes every 30 s.
  - On first launch there are no cards, only the New video card and a line saying videos will
    appear there.
  - The accent colour isn't used on this screen: it stays reserved for the playhead, selection
    and Save video.
- **Card menu.** Open, Rename (inline, on the card), Duplicate, Delete. Delete asks first
  ("Delete “Trip”?", then Cancel or Delete) through a new shared `ConfirmDialog`. The menu is a
  new shared `ui/Menu` (arrow keys, Home/End, Esc, click outside; focus returns to the button),
  which the editor's title menu will also use. Save to file comes in section 4.
- **Storage line.** "Your videos use 120 MB on this device.", then either that the browser keeps
  them safely (persistent) or that it may clear them when space runs low, with a suggestion to
  save important ones to a file.
- **Editor.** The top bar has a "Projects /" link before the title (the logo also goes home).
  The page title is the video's name. Toasts from the editor are cleared on the home screen.
- **Leaving the editor** saves right away (`beforeNavigate`, as well as on destroy), and the
  home screen waits for those saves before listing. That way a rename or import made just
  before clicking Projects always shows.
- **Card pictures are self-healing.** Each picture is stored with the key of what it shows
  (first scene, crop, framing, format). The editor writes pictures while you work, and the
  home screen makes any missing or stale one itself. At first the editor made the picture when
  it closed, but in Chrome `createImageBitmap`/`img.decode()` on the stored thumbnail sometimes
  never settled while the page was switching, so that project was left without a picture.
- Tests (e2e):
  - Empty first launch, and New video → empty "Untitled video" → back with nothing kept.
  - Two projects: order, pictures (the photo project's picture really is yellow), length, format
    and edited time; switching; renaming from the menu; duplicating (the copy opens with its
    scenes); deleting with Cancel, then Delete. Shared clips survive while the copy uses them
    and are removed with the last project that uses them.
  - axe checks on the home screen (empty, with projects, with the menu, with the delete
    dialog).
  - Every existing test now starts from the home screen (`openNewVideo`).

### 3. In the editor

- The title was already editable by clicking it (Enter saves, Esc cancels); the page title now
  follows it.
- A small chevron after the title opens the **video menu**, built on the shared `ui/Menu`:
  New video, then the project-file items, then Back to projects. New video from the editor
  opens a fresh `/edit/<id>?new=1`. The current project is saved on the way out, and an
  untouched new video is never stored.
- The file items and their shortcuts (Open project file…, Save to file ⌘S, Save as… ⇧⌘S,
  ⌘O) ship with section 4. Adding them here would have meant menu items that did nothing.
- Keys pressed inside the menu stay in it, so Space or S in the menu never plays or splits.
- Test: rename via the title and the page title; open the menu from the keyboard, arrow keys,
  Esc (focus returns to the button, playback untouched); New video from the menu; Back to
  projects shows only the kept project.

### 4. Project files (`.scenes`)

- **Format** (`files/format.ts`, `files/zip.ts`, written with `@zip.js/zip.js`, no web workers):
  - `manifest.json` comes first and is stored uncompressed, so any zip tool shows what the file
    is: app, format version, name, created and saved dates.
  - `project.json` (compressed) holds the project, the view, and info about each media file and
    font, with their paths in the archive.
  - `thumbnail.jpg`, then `thumbnails/<media>.jpg` (each clip's picture, so opening doesn't
    decode anything), then `fonts/`, then `media/`.
  - Media is stored uncompressed and read in slices while writing, so a big project never sits
    in memory.
  - Only media the project uses or keeps in "Your media" goes in, plus uploaded and computer
    fonts the words use. Built-in fonts come with the app.
- **Versions.** `FILE_FORMAT_VERSION = 1`. On open, `checkManifest` rejects other apps and
  newer versions, and `migrateProjectJson` runs each version's step, then `migrateProject`
  (the same one used for storage).
- **Opening is zero-copy for media.** For stored entries, the local header is read and the
  media is sliced straight out of the File (`file.slice`), then put into IndexedDB. Small entries
  go through zip.js with checksum verification.
- **Damaged files.** Every open is checked, and each problem gets a plain message: not a zip or
  no manifest ("isn't a Scenes project"), a bad checksum, cut short or missing entries
  ("damaged"), or a newer format ("saved by a newer version").
  - Media sliced from the file is checked by size, not checksum. Hashing gigabytes would slow
    every open. This is a known trade-off.
- **Saving** (`files/save.ts`):
  - In Chrome and Edge, `showSaveFilePicker` is used and the handle is kept in the `files`
    store with the project's `updatedAt`, so Ctrl/Cmd+S writes to the same file with no dialog.
    Permission is checked and re-asked if needed. "Save as…" always asks.
  - The file is chosen before gathering the project, while the key press still counts as the
    user's action.
  - Other browsers get a download. The file is written to private storage (OPFS) first, so it
    isn't built in memory.
  - Saving runs in the background: editing continues, and the top bar shows
    "Saving to file… 45%".
  - The home screen's card menu also has Save to file, with a progress card.
- **Save status** is derived: "Saved to summer-trip.scenes" when the project's `updatedAt`
  equals the one saved in the file, "Unsaved changes in file" otherwise, and "Saved on this
  device" when there's no file. Undoing back to the saved state shows "Saved to …" again,
  which is accurate because the content matches the file.
- **Opening** (`files/opener.svelte.ts`, with dialogs in the layout so every page shares them):
  - Ways to open: the "Open project file" button on home, Ctrl/Cmd+O on either page, the video
    menu, or dropping a `.scenes` file on the home screen or the editor. On the editor, other
    dropped files are still added as media.
  - `showOpenFilePicker` and dropped-file handles (`getAsFileSystemHandle`) keep the handle, so
    Save goes back to the opened file.
  - If the project id is already in the app, the user chooses "Replace the one in the app" or
    "Keep both". Keep both stores a copy with a new id and " (copy)" in its name, with no file
    link since it's a new project.
  - Replace deletes media only the old version used.
  - If the project being replaced is the one open in the editor, that editor is frozen first,
    so its last autosave can't overwrite the file's version. The route re-keys on `?opened=`,
    so the editor reopens fresh.
  - Media already in the app (same id, or same fingerprint) isn't stored again.
- **Shortcuts.** Ctrl/Cmd+S, Ctrl/Cmd+Shift+S and Ctrl/Cmd+O always prevent the browser's own
  save and open. Any typing in progress (a title or words) is committed first. The shortcuts
  dialog lists them.
- Tests:
  - Unit, in Node: round trip; entry order and stored media; progress; not-a-project, damaged
    (cut short, bad checksum, missing project data) and newer-version files; safe file names.
  - e2e, where the Chrome pickers are stand-ins returning real OPFS file handles:
    - A project with clips, a crop, a card, words in an uploaded font with custom colours, and
      music is saved; the file's entries and manifest are checked.
    - An edit shows "Unsaved changes in file"; Cmd+S saves with no dialog; undo and redo flip
      the status.
    - The project is deleted (its media and font go too), then opened again from home. It is
      deep-equal to before, with the same media and font, still linked to the file, and the
      card renders.
    - Keep both, then Replace.
    - A text file named `.scenes` and a cut-short project file each show a clear message.
    - Without pickers: the download from the home card menu, then opening via the file
      chooser, gives an identical project.
  - axe: the video menu and the error dialog.

## Selection on the video

- **Nothing selected means "the scene under the playhead".** The store has `sceneAtPlayhead`
  and `inspectedScene`: the selected scene, or with nothing selected, the one under the
  playhead. The right column shows `inspectedScene`, so deselecting words switches it to that
  scene's settings. "Nothing selected" now only appears in an empty project. Pressing on the
  settings of that scene selects it (capture listener on the column), so its outline, framing
  overlay and rectangle handles appear while you work on it.
- **Deselecting.**
  - A press on the picture that isn't on an on-video item (`data-on-video`: words, a card's
    rectangle, the reframe handle) deselects.
  - So does a press on the empty stage around the preview (the stage, its viewport, or the
    controls row itself, but not the play button).
  - So does a press on empty storyboard space: between or after scenes, and empty Words or
    Sound lane space. Presses on the ruler, playhead, cards, pills and transition buttons don't.
  - Esc deselects. While typing, the typing box handles the first Esc (stops typing), and the
    second one deselects.
- **Not deselecting.**
  - Only those explicit presses deselect: nothing listens for "click outside" on the window.
    So the right column, the floating toolbar and its popovers, and the font and colour
    pickers and dialogs never deselect.
  - Drags start on the item itself (with pointer capture), so releasing anywhere keeps the
    selection.
  - Esc in an open picker closes the picker only.
- **Card rectangles are now on-video items.** When a card is under the playhead, its rectangle
  can be pressed to select the card and dragged straight away. Handles, the accent outline and
  the size label show only while the card is selected; otherwise there's a dashed outline on
  hover.
- Tests (`e2e/selection.test.ts`):
  - Empty picture, stage background, and Esc (including the Esc while typing) deselect, and the
    toolbar disappears.
  - Colour fields, opacity, the font picker (and Esc in it) and the toolbar's Style popover keep
    the words selected.
  - Dragging words and releasing over the storyboard keeps them selected.
  - Other words take the selection; a scene card selects the scene; empty scene-row and
    Words-lane space deselect, and the settings follow the playhead.
  - Rectangle: resizing and releasing outside the preview keeps it selected; empty picture and
    Esc hide the handles (the card's settings stay); clicking the rectangle selects it; changing
    the card's settings selects it.

## Layers track

### 1. Storyboard zoom

- **Minimum widths without losing alignment.** Drawing short items wider would push everything
  after them away from the ruler and playhead. Instead, `TimeMap` in `editor/scale.ts`:
  - Each scene gets `max(48 px, duration × zoom)`, and time runs evenly inside each scene; after
    the last scene it runs at the plain scale.
  - The ruler, playhead, scene cards, words, sound and (soon) layers all position through
    `map.x(t)` / `map.t(x)`, so they stay lined up.
  - Words and sound pills are at least 48 px too. Their rows are stacked by where they sit on
    screen, so short ones never overlap.
  - Ruler labels skip any that would crowd.
- **Short items.**
  - Scene cards under 64 px show just their number, and pills hide their label.
  - The full name is in the tooltip (`title`) on every card and pill.
- **Zoom.**
  - A slider ("Storyboard zoom") sits at the right end of the ruler, outside the scroll area.
    It's logarithmic, from Fit (0) to 400 px per second.
  - Ctrl/Cmd + scroll zooms around the mouse. It's a non-passive listener, so the page itself
    never zooms. The slider zooms around the playhead when it's in view.
  - "Fit" shows the whole video. `fitTimeline` finds the scale by binary search, counting the
    minimum widths. Long videos can now fit below the old 14 px/s limit.
- **Keeping the zoom anchor in place.** The time under the pointer is remembered at the start
  of a burst of zoom steps. It's re-applied in an `$effect` after each step is on screen, and
  forgotten 200 ms after the burst.
  - An earlier version scrolled after `tick()`. Under load, that sometimes ran before the next
    step's DOM update, so the scroll was clamped. It also reused a slider's anchor for a wheel
    zoom that followed quickly.
  - Card slide animations are off while zooming, so everything scales together.
- Tests:
  - Unit: map, fit and zoom.
  - e2e: a 0.5 s scene between longer ones is ≥ 36 px wide, has a tooltip, is clickable and
    lines up with the playhead; Fit needs no scrolling; the slider zooms; Fit restores the
    fitted size; Ctrl/Cmd+wheel keeps the time under the mouse in place (stress-tested with
    4 parallel workers × 8 runs).
  - The framing panel also has a "Zoom" slider, so older tests now match it exactly.

### 2. The Layers track

- **Model** (`model/overlay.ts`, pure and unit-tested). `Project.overlays: Overlay[]`, which older
  projects get as `[]` in `migrateProject`. Each overlay has:
  - its kind (video, photo or card) and media;
  - `sceneId` + `offset`: linked to the scene it starts over, starting that far into it;
  - `duration`, and `sourceStart` for videos;
  - `row`, `box` (fractions of the frame), and optional `crop` and `card`;
  - `style` (radius, border, shadow, opacity), `enter` and `exit` animations, and `sound`.

  All fields for the later sections are there from the start, so the saved format only
  changes once.
- **Linking.** An overlay's time is its scene's start plus `offset`. Moving, trimming or
  reordering scenes carries it along with nothing to update. Moving the overlay relinks it
  to the scene under its new start (`linkAt`).
  - Splitting a scene keeps overlays where they are in time (`relinkByTime`).
  - Removing a scene with overlays asks "Remove this scene's layers too?": Keep in place (relinked
    by time) or Remove them too. Each is one undo step.
- **Rows.** `row` 0 is the lowest and is drawn first.
  - `assignRow` puts an overlay in the row it's dropped on. If it would overlap something
    there, it goes in a new row just above (rows above shift up).
  - `compactRows` removes empty rows after every change.
  - The storyboard shows the highest row at the top.
- **Track UI** (`LayersTrack.svelte`, above Scenes, labelled "Layers").
  - Items look like small scene cards: picture strip, name and length.
  - Drag to move in time, or up and down between rows. Dragging above the top row shows a
    dashed "new row". Drag the ends to change the length; a video can't outlast its clip.
  - Alt+←/→ nudges. Items are at least 48 px wide, placed through the same `TimeMap`.
  - An empty track shows the hint. Empty space in it deselects.
  - A selected item draws a dotted accent line down to the start of its scene.
- **Row choice while dragging** comes from how far the pointer has moved vertically (whole rows
  from the starting row), not from the track's position. The storyboard is anchored to the
  bottom of the window: when the "new row" appears, the track grows upwards and its edges
  move (also during its height animation). Measuring against the track made the new row
  flicker on and off under a still pointer. Found with a 4-worker stress run.
- The store has `placedOverlays`, `selectedOverlay`, `placeOverlay`, `resizeOverlay`,
  `setOverlayTiming`, `addOverlayFromMedia`, `addCardOverlay` and `deleteOverlay`. New
  overlays get 5 s, or the clip's length if shorter; at most 4 videos may play at once (see
  section 6). Delete removes the selected overlay.
- The right column shows a basic "Layer" panel for now (section 5 fills it in).
- Overlay media counts as used for project files, clean-up and the per-file media list.
- Tests: 12 unit tests for the model. e2e:
  - The track sits above Scenes, labels are ordered, and the empty hint shows.
  - Items show name and length, sit at the right time, and move with a gap; trimming works,
    capped at the clip's length.
  - Overlapping items make a row above; moving one into free space removes the empty row;
    dragging above the top row makes a new one.
  - Items follow their scene through a move and a trim; the link line shows; removing the
    scene asks, both answers work and undo.
  - All stress-tested with 4 workers.

### 3. Adding overlays

- **Three drop targets, one routing function.** `handleVisualDrop` (in `media/dragTypes.ts`)
  sends a drop to the right action, whether it came from "Your media", the Cards button, or
  photo/video files from the computer:
  - **The picture** gives a layer on the scene at the playhead, centred and 40% of the frame's
    width. It lasts 5 s, or the clip's length if that's shorter.
  - **The Layers track** gives a layer at the pointer's time, in the row under it. If that
    overlaps something, `assignRow` makes a new row above.
  - **The Scenes track** gives a scene at the drop position, as before. It now also takes files,
    via `importFiles(files, index)`.
  - With no scenes yet, a drop on the picture or Layers makes the first scene instead, since a
    layer needs something to sit on.
- **"Clips"** is read as photos and videos dragged in from the computer, the way clips come in.
  The Clips button opens a file picker and has nothing to drag. Files dropped as layers are
  stored once (fingerprint) and join "Your media" in the same undo step as the layer.
- **Drop indicators.**
  - On the picture: the whole picture dims, a dashed box shows where the layer lands, and a
    label says "Drop to place on top of this scene".
  - On the Layers track: an outlined lane and a dashed "Place here" ghost at the drop time and
    row. The empty-track hint hides meanwhile.
  - On the Scenes track: the existing insertion marker.
- **Page-wide hint.** The full-page "Drop to add scenes" cover would have hidden these. While
  files are dragged over the page, there's now a light dashed border and a pill: "Drop on the
  picture or the Layers row to place on top · anywhere else adds scenes".
- **Who handles a drop.** A target claims a drop with `preventDefault()` only when it used it.
  The editor's page-wide drop handler then just resets its state. So a `.scenes` project file
  dropped on the picture still opens as a project.
- `storeVisual` (store once, load info and thumbnail, friendly errors) is now shared by
  `importFiles` and the new `importAsOverlays`.
- Tests (e2e): each target is exercised with synthetic drag events, whose indicators can be
  checked mid-drag, plus one real mouse drag and drop from Your media onto the picture.
  Covered:
  - Your media → picture, and the length follows the clip.
  - Cards button and computer files → Layers at the pointer's time, with a new row on overlap.
  - Your media and files → Scenes at the drop position.
  - The page hint shows while dragging files.
  - No scenes → the first scene.
  - Stress-tested with 4 workers.

### 4. Moving between tracks

- **Scene → layer.** A scene card dragged up past the top of the Scenes row stops reordering and
  shows a "Make it a layer" ghost in the Layers track (at its time and the row under the
  pointer). The lifted card follows the pointer up. On release, `sceneToOverlay` runs:
  - The scene gets the default layer box: 40% wide, centred, with its own (cropped)
    proportions. Its crop and card content carry over.
  - It keeps its whole used part of the clip, at normal speed.
  - The remaining scenes close the gap. The drop time is converted to the closed-up timeline
    (times after the removed scene move back by its length).
  - Layers that started over that scene stay where they are in time.
  - The only scene can't become a layer (nothing to sit on); a message says so. The 4-videos
    limit is checked.
- **Layer → scene.** A layer dragged below the Layers track shows the Scenes insertion marker.
  On release, `overlayToScene` inserts a full-frame scene at that position: the same part of the
  clip (or the same length for photos and cards), with its crop and card content. Layers
  linked to later scenes move along with them.
- Each is one `edit()`, so one undo step.
- Tests (e2e): a scene dragged up with the ghost showing becomes a 40%-wide layer at the drop
  time, the gap closes, the Layer panel shows, and one undo restores everything. A layer
  dragged down with the marker showing becomes a scene at that position with the whole
  clip, and one undo restores it. Stress-tested with 4 workers.

### 5. Overlay settings and editing

- **On the preview** (`OverlayBoxOverlay.svelte`, under the words and over the scenes). Layers
  showing at the playhead are on-video items (`data-on-video`), so the deselect rules from the
  selection round apply as they are.
  - Pressing a layer selects it and can drag it straight away; higher rows sit on top here too.
  - Selected: accent outline, 8 handles, and a live size label in project pixels (hidden while
    a popover is open).
  - Resizing uses the same `dragBox` as crop and card rectangles: unbounded, snapping to the
    frame's edges and centre lines.
  - Corners keep a photo's or video's proportions unless Shift is held (cards: Shift keeps them).
    Edges change the shape, and the picture fills the box without stretching (cover).
  - Arrow keys nudge (Shift ×10). Each drag is one undo step.
- **Floating toolbar**: Crop (not for cards), Style, Animate, Remove. Style and Animate open
  popovers with the same controls as the right column (`OverlayStyleFields`,
  `OverlayAnimationFields`).
- **Right column** (`OverlayInspector.svelte`):
  - Position and size: X, Y, W, H in pixels, plus corner and centre placement (4% margin of the
    shorter side).
  - Crop / Change crop / Remove crop.
  - Style: corners, border thickness and colour, shadow off/soft/strong, opacity.
  - Timing: start and length steppers. Length is capped by the clip and by the end of the video.
  - Animation: comes in / goes out.
  - Sound, for videos: a switch, then volume.
  - Layer order: Bring forward, Send back.
  - For card layers: background and rectangle, through `CardContentFields`. It's extracted from
    the card scene settings, which use it too; the rectangle is measured in the layer's box.
- **Crop** reuses the crop tool: `cropping.sceneId` can be a layer id. `croppingSource` gives the
  source size for either, and the player shows the layer's whole source (section 6). Applying
  a crop gives the box the cropped picture's shape around the same centre (`fitShape`).
  - Found by the e2e test: a tall crop was first capped at the frame's height without narrowing
    the width, which distorted the shape. `fitShape` now keeps proportions and makes the box
    narrower if it would be taller than 90% of the frame.
- Tests (e2e):
  - Toolbar contents; deselect and reselect; move with snapping to the exact centre (toolbar
    hidden while dragging); corner resize keeps 16:9 with a live size label, Shift frees it;
    undo; Esc.
  - Crop to the blue third: preview pixel and shape; Remove crop.
  - Every right-column section: fields, bottom-right placement, style values, the layer stays
    selected while editing, timing (the clip-length cap disables Longer), in/out animation,
    sound switch and volume, Bring forward / Send back against another layer.
  - A card layer: Card section, no Crop or Sound, background colour on the preview, Add
    rectangle.
  - axe on the layer panel, toolbar and Style popover.

### 6. Rendering (done before section 5)

Built before the settings panel because the panel's crop, corners, border and shadow can only be
judged on the rendered picture. It's committed as its own section.

- **One draw description for every output.** `overlayDraw` (`render/overlay.ts`) turns a placed
  overlay into output-pixel geometry at time `t`:
  - its box after the entrance/exit animation (fade = opacity, slide-up = offset by a quarter of
    its height, pop = scale about the centre);
  - the crop, then a *cover* fit into the area inside the border (no stretching if the box
    doesn't match the picture's shape);
  - corner radius (fraction of half the shorter side), border (project pixels scaled to the
    output) and shadow (fractions of the frame's shorter side, so it looks the same at any size);
  - opacity × animation;
  - the video's look: pictures follow the whole video's mood, cards keep exact colours.

  The preview, Watch mode (the same player), export and the home-screen picture all use it.
- **Compositor.** A new pass runs after the scenes (and transitions), before words: one shader
  per overlay on a quad grown to fit its shadow.
  - A signed distance to the rounded box gives smooth edges, the border ring (another rounded
    box inside), and a soft shadow (smoothstep on the offset distance).
  - Output is premultiplied, blended `ONE, ONE_MINUS_SRC_ALPHA`, lowest row first.
  - Each overlay has its own texture slot, so a still photo or card is uploaded once.
- **Decoding in parallel.** Every overlay has its own frame source, keyed by overlay id, even
  when a scene uses the same file. Scene and layer decoders run side by side.
  - Layers are prefetched like scenes (1.5 s ahead when playing) and idle when far away.
  - `framesReady` also waits for layer frames, so play starts cleanly and tests read exact
    frames.
  - Layers are part of the redraw key.
- **Four videos at most** at any moment (`tooManyVideos`), checked when adding, moving,
  lengthening or turning a scene into a layer. The message explains why it can't go there.
  With four videos and the scene decoding, playback keeps pace with the clock (e2e).
- **Crop view** for a layer: the player shows its whole source through a stand-in scene with
  the layer's id, so it uses the layer's own decoder. The crop UI comes in section 5.
- **Export** draws the same `OverlayDraw` list per frame. Each layer has its own reader, freed
  1.5 s after it ends. **Sound:** `overlayAudioClips` adds video layers with sound on to the
  playback and export mix (off by default).
- **Home picture**: layers showing at the start are drawn with the 2D canvas using the same
  geometry, and they're part of its cache key.
- **Send back** was fixed along the way. It must put a layer *under* whatever it overlaps in the
  row below (a new row just below it), not above it (`sendBack`, unit-tested).
- Tests:
  - Unit: cover fitting, animated placement, output-size scaling of corners, border and shadow,
    crop before fit.
  - e2e preview: a picture-in-picture video with pill corners, white border and strong shadow
    (layer, border, rounded-off corner and shadow pixels); a half-transparent card over a photo
    blends; a video over a photo scene; higher rows on top, and sending back swaps them.
  - e2e export: the same points in the saved MP4 match the preview (within a few levels). The
    green layer's 660 Hz tone is in the mix with its sound on; the blue layer's 880 Hz (off) is
    absent; the red scene's 440 Hz is there.
  - e2e limits: four videos play at once, a fifth is refused with the message, and playback
    keeps up.
  - The `.scenes` round trip now includes a styled layer with sound, and comes back identical.

## Fix: upside-down photos and scaling photo layers

- **Photos were drawn upside down** everywhere through WebGL: scenes, layers, crop view, Watch
  and the saved video.
  - Photos are decoded as `ImageBitmap`, and WebGL ignores `UNPACK_FLIP_Y_WEBGL` for
    ImageBitmaps. Videos (CanvasSink canvases) and cards (canvases) were flipped correctly, so
    only photos were affected.
  - Every earlier test used a solid yellow photo, which looks the same upside down.
  - Fix: the compositor copies an ImageBitmap once into an OffscreenCanvas (cached per bitmap
    in a WeakMap) before uploading it, so it's flipped like everything else. It's one place, so
    preview, Watch and export are all covered. 2D drawing (thumbnails, filmstrips) was never
    affected.
  - EXIF-rotated phone photos were already the right size and shape (`from-image`).
- **Scaling photo and video layers.**
  - Before: corners kept the box's *current* shape, and edge handles changed the shape with
    the picture cropped to fill it. Scaling from a side looked like zooming or cropping, and
    after one edge drag the odd shape stuck.
  - Now photo and video layers scale in their own (cropped) shape from every handle: a side
    handle grows the whole picture, anchored on the opposite side's middle (`dragBox`
    `keepRatioOnEdges`). Shift frees the shape. Cropping is the Crop tool's job. Cards stay
    free-form (Shift on a corner keeps their shape).
- The live size label no longer covers the floating toolbar when a layer reaches the bottom of
  the frame. It moves inside the box's bottom edge instead of above the box.
- Tests: new fixtures in `make-fixtures.sh` (Pillow): `quads.jpg`, `quads.png`,
  `quads-large.jpg` (4032×3024) and `quads-exif6.jpg` (sideways with an EXIF rotate tag).
  - `e2e/photos.test.ts` checks the four quarter colours of each photo as a scene, as a
    full-frame layer, in crop view, and in the saved MP4.
  - It also checks side, top and corner resizes keep 4:3, Shift frees the shape, and the next
    plain drag restores it.
  - Unit test for edge scaling in `dragBox`.

## Fix: layer toolbar under words

- The layer's floating toolbar and its Style/Animate popovers were inside the layer's box on the
  preview (z-index 4–5). The words' layer (z-index 5) comes later in the page, so words sitting
  under an open popover were on top of it. They caught clicks, for example while dragging the
  border slider.
- The toolbar and popovers now render outside the box, in a `toolbar-anchor` with z-index 7 that
  only lets its toolbar take clicks. The box's hit area stays below the words, so words over a
  layer can still be clicked when no popover is in the way.
- Test: words placed under the open Style popover. The element under the pointer there is the
  popover; dragging the slider and clicking there keeps the layer selected. The test fails on
  the old code.

## Fix: drags that kept going after the mouse was released

**Symptom.** Resizing an image layer from its left handle: press, drag, release, and the box kept
following the mouse.

**Root cause.** Every drag listened for its release only as a `pointerup` on the handle, and
nothing else could end it.
- When the release never reaches the page, every later mouse move with no button held was
  still treated as part of the drag. Pointer capture was still active, so the moves kept going
  to the handle, and the box followed the mouse.
- Nothing checked `event.buttons`, `lostpointercapture` or the window losing focus. On macOS
  the release goes missing when the window loses focus mid-drag (a notification, Cmd-Tab, Mission
  Control), and with some trackpad gestures.
- Reproduced exactly with Chrome's DevTools input API (press, move, no release, then moves with
  `button: 'none'`). The new test fails on the old code on this case only.

**The four suspected causes, checked:**
1. *Release listener only on the handle.* Pointer capture delivered the release to the handle
   everywhere tested: inside the preview, over the right column, and outside the browser window
   (DevTools input). Not the cause here, but fragile, so releases are now heard on the window.
2. *Handle re-created mid-drag.* Not for layer handles: the event log showed capture and the
   release on the same element, and they're in keyed blocks that don't reorder. **It was real
   for storyboard reordering**, though: Svelte moves a scene card's node as the order changes,
   and moving a node releases pointer capture. That drag now captures on the stable tracks
   container.
3. *Native image drag.* No `dragstart` ever fired (there are no `<img>` elements on the preview;
   the picture is a canvas). Guarded anyway.
4. *Mixed events, cancel and lost capture.* Everything used pointer events. `pointercancel` was
   handled, but `lostpointercapture` wasn't, and neither was a move with no button held. **This is
   the cause**: nothing could end a drag whose release was lost.

**Fix: one shared helper, `ui/drag.ts`** (`startDrag`, `DragScope`, `preventNativeDrag`), used by
every drag:
- moving and all 8 handles of layers;
- crop handles and the crop box;
- card rectangle handles;
- words on the video;
- reframing (per pointer, so pinch still works);
- storyboard reordering, edge trims, and ruler/playhead scrubbing;
- Layers, Words and Sound lane items and their edges;
- holding a stepper button (it would keep repeating if the release were lost).

The helper:
- captures the pointer on an element that stays in the page. Reordering captures on the tracks
  only once the drag really moves (`drag.capture(el)`), so a plain click still selects the card;
- listens on the window (capture phase) for `pointermove`, `pointerup` and `pointercancel`, on
  the captured element for `lostpointercapture`, and for window `blur`. Any of the last four
  ends the drag, as does a move with `buttons === 0`;
- ignores other pointers, ends a drag exactly once, and removes every listener when it ends.
  `DragScope.dispose()` (on component destroy) ends any drag still running.

Also: `dragstart` is prevented on the preview and the storyboard tracks, the home card image is
`draggable="false"`, and all handles keep `touch-action: none`.

**Tests.**
- `e2e/drag-release.test.ts` presses through the DevTools protocol, and releases four ways:
  inside, outside the preview, outside the browser window (x < 0), or not at all (lost). After
  the release, more moves must change nothing. It covers:
  - all 8 handles and moving, on image, video and card layers;
  - crop handles;
  - words on the video;
  - storyboard trims, ruler scrubbing and reordering;
  - card rectangle handles.
- Unit tests for the helper: release anywhere, no-button move, cancel, lost capture, blur, other
  pointers, scope disposal.
- Test gotcha: in `Input.dispatchMouseEvent`, `button: 'left'` on a move means the button is
  held. Moves after a release must use `button: 'none'`, or they're still drags.

## Sound clips: trim, move, split, rows, snapping and fades

- **Model.**
  - `SoundItem` loses `fade: boolean` and gains `fadeIn` and `fadeOut` (seconds, 0–5) and `row`.
  - `migrateSounds` (run by `migrateProject`, so older projects and `.scenes` files come up to
    date): `fade: true` becomes the automatic 1.5 s in / 3 s out; music goes in row 0 and
    voiceovers in the first free row below.
  - The pure editing logic is in `model/sound.ts` and unit-tested: `trimSound`, `splitSound`,
    `effectiveFades`, `freeRow`, `assignSoundRow`, `compactSoundRows` and `snapTimes`.
- **Trimming.**
  - The start edge moves `start` and `sourceStart` together, so the rest of the audio stays
    where it was. The end edge changes `duration`.
  - Neither goes beyond the file (the media's first sample to its end), before 0 on the
    timeline, or below 0.3 s.
  - A clip running past the video's end is trimmed from where its end is drawn.
  - The waveform is drawn from `sourceStart` for the clip's length at the storyboard's scale, so
    trimming hides audio instead of squeezing it. The new length shows live ("0:10").
- **Moving and rows.**
  - Drag a clip to move it in time (gaps are fine) and up or down to change rows. Rows are
    counted from the pointer's travel, as on the Layers track.
  - Dropping onto an overlap makes a new row below (rows go downwards here: music on top), and
    empty rows go away.
  - New songs are added, no longer replacing the old one: the first at 0 s, later ones at the
    playhead, in the first row where they fit. Voiceovers also go in the first free row.
- **Splitting.** S splits the selected sound clip (otherwise the scene, as before), and so does
  "Split here" in its settings. The two halves play exactly as before; the first keeps the fade
  in, the second the fade out.
- **Snapping.** Moves (the clip's start or end) and trims snap to the playhead, scene boundaries
  and other clips' edges within 8 px. A thin line across the storyboard shows the snap target
  (`snapX`, bound up to the storyboard). Alt/Option drags freely.
- **Fades.**
  - Heard at the clip's (trimmed) edges. `effectiveFades` caps each at 5 s and shrinks both
    together if they'd be longer than the clip. A clip still playing when the video ends fades
    out by then.
  - Dots at the top corners are dragged to set each fade (0–5 s, live label). The fade is drawn
    as a sloped line with the faded part lightened.
- **Settings**: name and how long it plays, starts at, length, volume, fade in, fade out, Split
  here (enabled when the playhead is inside) and Remove. The old "Start the song at" stepper and
  the Fade switch are replaced by trimming and the fade lengths.
- **Everywhere else.** Playback, Watch and export all build their sound from
  `soundAudioClips`, which uses the trimmed part, position and fades. Lane previews commit as
  one `edit()` when the drag ends, so each gesture is one undo step. Every drag uses the shared
  drag helper.
- Tests:
  - Unit: 11 for the sound model; the existing clip tests are updated to fade lengths.
  - e2e (`sound-editing.test.ts`):
    - Trim both sides: live length label, position and width at the same scale, capped at the
      file's ends, silence where trimmed, one undo per trim.
    - Move with snapping (the snap line shows, lands on exactly 12 s), Alt moves freely, gaps.
    - Split with S and with Split here: contiguous, fades split, total length unchanged.
    - A second song goes in its own row; moving it into free space removes the row; an
      overlapping drop makes a new one.
    - Fades follow a trimmed start; dragging the fade-in dot gives a half-loud midpoint; the
      fade-out dot to 0; the right column matches.
    - The saved MP4's loudness in seven windows matches the preview mixer within ±15% (and
      silence where it's silent), after trims, a move, a long fade and a second song.
  - The phase 5 test now sets "Fade in" to 0 where it used to turn the Fade switch off.

## Tracks (one multi-track system)

The Layers rows, the Words lane and the Sound rows are replaced by tracks of three kinds.
`project.tracks` is in storyboard order, top to bottom:

- **Overlay tracks** (any number): videos, photos, cards and text, at fixed times, gaps allowed.
  Higher tracks are drawn on top.
- **The main track, "Scenes"** (exactly one): the scenes, magnetic as before.
- **Audio tracks** (any number): music and voiceovers.

Items (`overlays`, `texts`, `sounds`) name their track by `trackId` and have a fixed `start`.
Overlays aren't linked to scenes any more.

### 1. Migration

- **Model.**
  - `model/tracks.ts`: `Track {id, kind, name, hidden, muted, locked}`, ordering helpers
    (`orderTracks`, `insertTrack`, `indexAbove`, `overlayTracksBottomUp`), `accepts` (what goes
    where), `fits` and `freeTrack`.
  - `model/items.ts` handles every kind of item the same way: `allItems`, `getItem`,
    `updateItem`, `removeItems`, `moveItems`, and `settle`, which moves an overlapping item onto a
    new track just above. It also manages the tracks themselves: add, rename, flags, delete,
    duplicate and move.
- **Migration** (`migrateToTracks`, run by `migrateProject`, so both stored projects and
  `.scenes` files come up to date):
  - Each Layers row becomes an overlay track, keeping its stacking.
  - The Words lane becomes an overlay track "Text", above all others (text was always drawn on
    top).
  - Each Sound row becomes an audio track.
  - An overlay linked to a scene gets that scene's start plus its offset as its fixed start.
  - There is always at least one overlay track and one audio track, as the old storyboard always
    showed a Layers row and a Sound row.
  - The file format is now version 2. A version 1 file drops any `tracks` field before migrating.
- **Rendering.**
  - `render/visuals.ts` (`visualsAt`) lists what's on screen at a time, in drawing order:
    overlay tracks from the lowest to the highest, and items by start on each track.
  - The compositor draws that one list (overlay shader or text sprite). Preview, export and the
    home picture all use it, so they can't disagree about stacking.
  - `projectAudioClips` gets the tracks too.
- **Storyboard.**
  - One scroller holds every track. Each row is a sticky header (name) plus a lane.
  - The ruler sticks to the top and the Scenes row to the top and bottom, so both stay in view
    when there are many tracks.
  - `TrackLane.svelte` draws and drags every kind of item: cards for pictures, a "T" card for
    text, and waveforms with fades for sound. This replaces `LayersTrack`, `WordsLane` and
    `SoundLane`.
  - `.tracks` is `isolation: isolate`, so its sticky rows stay under the zoom controls.
  - The storyboard has `min-width: 0`, so a zoomed-in timeline scrolls instead of widening the
    page.
- **Gone.** Scene links (`sceneId`/`offset`), rows and relinking on split or delete. Deleting a
  scene no longer asks about its layers: overlays keep their times.
- **Tests.**
  - Unit (`tracks.test.ts`): migration order, starts, idempotence, moving items, managing tracks.
  - Unit (`zip.test.ts`): a v1 file opens with tracks.
  - E2E (`tracks-migration.test.ts`): a project is built, recorded, rewritten in IndexedDB in
    the old shape (rows, scene links, sound rows, no tracks) and reloaded. The tracks come out
    as Text, Overlay 2, Overlay 1, Scenes, Audio 1, Audio 2, every start is the same, and the
    preview pixels at four times and the audio clip list match.
  - The existing e2e tests now use track names and `.item-slot`.

### 2. Track headers

- **Header** (`TrackHeader.svelte`): a grip, the name, then Hide (visual tracks, eye) or Mute
  (audio tracks, speaker), Lock, and a "…" menu. The Scenes header shows only its name: it
  can't be renamed, hidden, locked, moved or deleted.
- **Rename.** Double-click the name, or use Rename in the menu. Enter or clicking away keeps the
  new name, Esc cancels. Names are trimmed and capped at 40 characters.
- **Hide / Mute.**
  - A hidden or muted track is dimmed in the storyboard.
  - It's left out of preview, Watch, export and the home picture. Rendering already skips hidden
    tracks (`visualsAt`), and `projectAudioClips` drops muted audio tracks and video overlays on
    hidden tracks.
  - Both are saved with the project and can be undone.
- **Lock.**
  - Items on a locked track can't be selected, dragged or trimmed on the storyboard, and don't
    get a box on the picture.
  - Store actions that change an item check the lock too.
  - Locking deselects anything on that track.
- **Menu:** Rename, Duplicate track (a copy with all its items, just above, named "… copy"),
  and Delete track.
  - Deleting a track that has items asks first ("The 2 items on it will be removed too. You can
    undo this.").
  - An empty track goes right away.
  - The menu is rendered outside the scrolling track list, so it isn't clipped. Its items keep
    the track they were opened for, because the menu closes before an item runs.
- **Reorder.**
  - Drag a header by its grip or name. A line shows where the track will go.
  - Overlay tracks stay above Scenes and audio tracks below: a drag past Scenes stops at the
    nearest allowed place (`moveTrack`).
  - Moving an overlay track changes what's drawn on top.
- **Adding tracks.** "+ Overlay track" sits above the top track (a new one goes on top) and
  "+ Audio track" below the last one. New tracks get the lowest free "Overlay N" / "Audio N"
  name.
- **Scrolling.** The storyboard scrolls up and down once there are many tracks. The ruler stays
  at the top, the Scenes track stays in view, and the headers stay on the left when scrolling
  sideways.
- **Tests** (`tracks-headers.test.ts`):
  - adding and renaming, Esc, Scenes not renamable, undo;
  - hide changes the preview pixel, mute silences the mix, both kept after a reload;
  - lock blocks select and move, and deselects;
  - duplicate, delete with a confirmation (and cancel), delete an empty track, undo;
  - reordering, with the Scenes limits;
  - eight extra tracks: vertical scroll with the ruler and Scenes in view, headers pinned when
    scrolled sideways.

### 3. Placing and moving

- **Dragging items** (`TrackLane`, with `targetAt` from the storyboard):
  - Drag left or right to change the time. Drag up or down onto another track of the right kind:
    pictures and text go on overlay tracks, sound on audio tracks. Anywhere else, only the time
    changes.
  - Between two tracks, or above the top one, a line shows and the drop makes a new track there
    (`moveItemToNewTrack`).
  - Dropped on another item, it goes on a new track just above (`settle`). Nothing ever overlaps
    on a track.
  - A picture overlay dragged onto Scenes becomes a scene. A scene dragged onto an overlay track
    becomes an overlay there.
- **Media dropped on the picture** goes to the top overlay track that is free for its whole
  length from the playhead. If there is none, a new top track is made (`overlayTrackFor`).
  "Free at the playhead" means the whole item fits, so a drop never has to move it elsewhere.
- **Multi-select.**
  - Shift-click adds an item to the selection or takes it out.
  - Dragging from an empty spot on the tracks draws a selection box. Shift keeps what was
    already selected.
  - Dragging one selected item moves them all by the same time. Each stays on its own track, and
    anything that would overlap goes on a new track above.
  - Delete removes them all in one undo step.
- **Copy, cut and paste** (Ctrl/Cmd+C, X, V; text fields keep their own):
  - The clipboard lives in the page only.
  - Paste puts the earliest item at the playhead, and the others keep their spacing.
  - Each pasted item goes on the *selected track* if that track takes it. The selected track is
    the track of the last selected item, or a lane whose empty spot was clicked
    (`activeTrackId`). Otherwise an item goes back on its own track, or the first track of its
    kind.
  - Overlaps go on a new track above. Pasted videos still respect the four-at-once limit (a
    friendly message says when one was left out).
  - The pasted items end up selected.
- **Layout.**
  - "+ Overlay track" moved into the ruler's empty corner, saving a row.
  - The Add column's content now scrolls when the window is short, so the Add buttons and "Your
    media" stay reachable however many tracks there are. The Cards/Words/Sound panel beside it
    isn't clipped.
- **Shortcuts dialog:** Shift-click, ⌘/Ctrl+C/X and ⌘/Ctrl+V were added.
- **Tests** (`tracks-moving.test.ts`):
  - moving between tracks, and not onto the wrong kind;
  - gap and top drops making tracks;
  - dropping onto another item;
  - picture drops choosing the top free track or making a new one;
  - Shift-click, the selection box, group move and group delete with undo;
  - copy/paste to the selected track, keeping spacing; cut and paste; undo.

### 4. Trimming, snapping and ripple

- **Trimming.** Every item (picture, card, text, sound) has the same edge handles in
  `TrackLane`, driven by the shared drag helper (`DragScope`). Their limits depend on the kind:
  a video can't outlast its clip, and a sound can't go beyond its file.
- **Snapping.**
  - Moving or trimming snaps to the playhead, the video's start and end, scene boundaries, and
    item edges on every track. The only exceptions are the item being dragged and the selection
    moving with it.
  - A line shows across all tracks, the Scenes track included (the line was under the sticky
    Scenes row before). Hold Alt to place freely.
- **Ripple** (`model/ripple.ts`, pure and unit-tested):
  - A "Ripple" toggle sits next to Fit. It's off by default and remembered on this device
    (localStorage, a per-viewer preference, not part of the project).
  - `reconcileTimeline(before, after, ripple)` runs after every edit that changes the scenes:
    `edit()`, `endGesture()`, and the end of an import (one undo step with the import).
  - It only touches items the edit itself didn't place, so a dropped or trimmed item stays
    where it was put.
  - **Off:** items keep their times.
  - **On:** `mapTime` moves each item's start with the part of the video it was over. It finds
    the same moment of the same clip (the scene itself, or a piece split off it), so trimming a
    scene's start, changing its speed, reordering, or adding scenes before it keeps items lined
    up with their scenes.
  - If that part was cut, the item keeps its distance to the next scene that's still there, but
    never goes back past the cut.
  - Ripple shifts items and never resizes them. Anything that then overlaps goes on a new track
    just above.
- **The video's end.**
  - An item whose end is exactly at the end of the video (with ripple on or off) stretches or
    shrinks to keep ending there when the video's length changes.
  - It stays within what it can show: a video overlay's clip, or a sound file's length.
  - It shows a small "end" marker (top right of the item).
  - This is how a logo can last the whole video, however many scenes are added.
- **Tests.**
  - Unit (`ripple.test.ts`): off, delete, trim end, trim start, add before and reorder, speed,
    split (no change), the end anchor with and without a limit, items placed by the edit left
    alone.
  - E2E (`tracks-ripple.test.ts`), the Logo scenario:
    - a new track renamed "Logo" and a PNG dragged onto it;
    - its end dragged to the end of the video, where it snaps, with the snap line spanning
      every track and the end marker shown;
    - two scenes added: it still ends at the end, and the picture at the very end shows it;
    - a scene deleted: it ends with the shorter video.
  - E2E: ripple off keeps times; on, deleting and shortening scenes move items. One undo step
    each, and the setting survives a reload.

### 5. Text on tracks

- Words are ordinary items on overlay tracks: they move, trim, snap, multi-select, copy and
  paste like pictures, and can go on any overlay track.
- Their stacking follows their track, so words on a track under a card are hidden by it.
  `visualsAt` draws overlay tracks bottom-up with pictures and words together.
- **Words** (Add column) puts a title or caption on the track named "Text", at the playhead.
  - If there's no such track, one is made at the top.
  - If the new words would overlap other words there, they go on a new track just above.
  - A hidden or locked "Text" track isn't used: a new "Text" track is made, so the words can be
    seen and typed.
- **Tests** (`tracks-text.test.ts`):
  - the Text track is made on the first title and reused later, and a new one is made when it's
    locked;
  - with a full-frame green card, the words show over it while the Text track is on top;
  - dragged into the gap under the card's track, the words are hidden (every sampled pixel is
    green);
  - with that track moved to the top, the words show again.

### 6. Rendering

- **One drawing order everywhere.** `visualsAt` gives the scenes first, then overlay tracks from
  the lowest to the highest, skipping hidden tracks. The preview, Watch, export and the home
  picture all use it.
- **One mix everywhere.** `projectAudioClips` combines the scenes' own sound, video overlays
  with their sound on (not on hidden tracks), and clips on audio tracks that aren't muted. Live
  playback, `mixdown` and export all use it.
- **At most four videos on top at once.**
  - Adding, dropping and pasting already checked this.
  - Now `edit()` and `endGesture()` also refuse any change that would go over four when it
    wasn't over before, with the same friendly message. This covers moving items, duplicating a
    track, ripple and anything added later.
  - Hidden tracks count too, so showing one again can never go over.
  - `mostVideosAtOnce` was added to `model/overlay.ts`.
- **Tests** (`tracks-render.test.ts`):
  - A project with a low blue card, a higher yellow card over it, a hidden magenta full-frame
    card, and a hidden video with its sound on.
  - The same five points are checked in the preview, Watch, the saved MP4 (with ffmpeg, also
    compared against the preview) and the home picture.
  - The MP4 has the scene's 440 Hz tone and not the hidden video's 880 Hz tone.
  - A second test fills up to four videos, then checks that a fifth, or a duplicated track with
    a video, is refused.
- **Done-when check** (all covered by the tests above):
  - An old project opens looking and sounding the same (`tracks-migration`).
  - The Logo PNG stretched to the end stays there as scenes are added (`tracks-ripple`).
  - Tracks can be added, renamed, reordered, hidden, locked, duplicated and deleted
    (`tracks-headers`).
  - Items move between tracks, make new tracks from gaps, can be multi-selected, and copy/paste
    (`tracks-moving`).
  - Ripple works on and off (`tracks-ripple`), and the MP4 matches the preview
    (`tracks-render`).
- **Test totals:** 248 unit and 116 Playwright tests pass.
  - `phase5-sound`'s voiceover test failed once in a full run (it records 2 s from the fake
    microphone). It passed 4/4 on its own, so it looks timing-sensitive under load rather than
    broken.

## Keeping the preview large with many tracks

- **Resizable divider** (`StoryboardDivider.svelte`, maths in `editor/layout.ts`):
  - A line between the preview and the storyboard. Drag it up for a taller storyboard, down for a
    bigger preview. On hover it shows an ns-resize cursor and a small grip.
  - It's a focusable separator: arrow keys move it (Shift for bigger steps), Home and End go to
    the limits, and Enter or a double-click resets it to the default.
  - Limits: the preview's area keeps at least 40% of the window height (the editor is never
    treated as shorter than its 640 px minimum). The storyboard never gets smaller than the ruler
    plus the Scenes track.
  - The chosen height is remembered in localStorage (`scenes.storyboardHeight`), per device and
    not per project, and clamped again when the window changes size.
  - The editor grid is now top bar, workspace (`minmax(0, 1fr)`), divider, storyboard. The
    storyboard gets a fixed height, so extra tracks never push the preview smaller.
- **Default height and scrolling.**
  - By default the storyboard shows the ruler and about four tracks: Scenes, a picture track, two
    slim tracks and the "+ Audio track" row.
  - The tracks scroll inside it. The ruler (sticky) and the toolbar (Ripple, Fit, zoom, outside
    the scroller) stay at the top. Headers scroll with their tracks.
  - The Scenes track is no longer pinned while scrolling. A pinned 108 px row hid other tracks'
    headers and ate most of a short storyboard; the new request only asks for the ruler and
    toolbar to stay put.
  - Wheel: plain scrolls up and down, Shift scrolls sideways, and Ctrl/Cmd zooms as before.
  - **Auto-scroll:** while dragging an item, a scene card toward the overlay tracks, a track
    header, or a selection box, being within 36 px of the top (under the ruler) or the bottom
    edge scrolls the tracks, faster nearer the edge (`LaneServices.autoScroll`).
    - Each scroll step re-runs the drag, so drop targets follow.
    - The dragged item's vertical offset includes the scroll, so it stays under the pointer.
  - A new track (from the buttons, a drop in a gap, a paste…) scrolls into view.
  - Stacking inside the scroller, low to high: rows, headers (14), the ruler row (15, so rows'
    headers scroll under its corner), the playhead and snap line (16), the gap line (17), the
    selection box (18).
    - The playhead and snap line hide while they are under the header column (scrolled sideways),
      so they never draw over the headers.
- **Slimmer tracks** (`trackHeight`):
  - Scenes stays 104 px.
  - Overlay tracks with pictures or cards are 62 px (60%), with thumbnails and names.
  - Text tracks and audio tracks are 40 px. A text track is an overlay track holding only words,
    or the empty "Text" track.
  - Words show in their items; audio shows the waveform, fades and name.
  - Headers are a little wider (172 px) so names like "Overlay 1" fit next to the controls.
  - Trim handles got an invisible grab area 6 px outward. It is outward only: an inward one
    turned presses near an item's edge into trims.
- **Collapsing tracks:**
  - An arrow in each overlay and audio track header collapses it to a 20 px strip with bars
    where its items are. Pictures are dark, cards are in their colour, words and sound are
    lighter, and a selected item is outlined.
  - The header then shows just the arrow and the name.
  - `Track.collapsed` is saved with the project. It's a view setting, so it's not an undo step,
    and undo/redo keep the current collapsed state.
  - The Scenes track doesn't collapse (it keeps its height).
- **Tests.**
  - Unit (`layout.test.ts`): limits, default, track heights.
  - E2E (`storyboard-layout.test.ts`):
    - 10 tracks: the preview and storyboard keep their size, and the ruler and toolbar stay put
      while scrolled; headers move with their lanes.
    - Wheel, Shift + wheel, Ctrl/Cmd + wheel.
    - The divider: drag, both limits, reload, double-click reset, keyboard.
    - The default shows four tracks.
    - Slim heights and readable labels, waveform and handles.
    - Collapse and expand, surviving undo/redo and a reload.
    - Auto-scroll down and up while dragging a card onto a track that was off-screen, and a
      time drag while scrolled.
    - New tracks scroll into view.
  - Updated: the reorder test drags the divider up first, and the old "Scenes stays pinned"
    check was replaced by the tests above.
  - Totals: 251 unit and 123 Playwright tests pass.

## Labels that match the media

- **One helper:** `model/labels.ts`. `mediaNoun(item)` gives "video" for scenes or layers made
  from a video clip and "picture" for photos and cards. `MediaNoun(item)` gives the capitalised
  form.
- **Changed to follow the scene's or layer's type:**
  - Scene settings: the "Picture" heading above the size and Crop becomes "Video" or "Picture",
    and "Around the picture" becomes "Around the video" or "Around the picture".
  - Scene settings: the Fit chip's description ("Shows the whole video/picture, with bars around
    it"), the Custom tip ("Drag the video/picture on the preview…") and "Apply crop to all scenes
    from this video/picture" (it said "clip"), with its undo label.
  - Scene settings: "Clip sound" becomes "Video sound" (it only shows for video scenes).
  - The reframe handle on the preview: "drag to move the video/picture".
  - Crop mode, for scenes and layers: "Drag the box on the video/picture…".
  - Layers: "Play the clip’s sound" becomes "Play the video’s sound" (only video layers have
    it).
- **Left as they are:**
  - Wording about the whole video's frame or the preview: "Same shape as the video", "Covers
    the whole frame", "Drop on the picture…", "drag onto the storyboard or the picture" in Your
    media, and "Layer … on the video".
  - Messages about files or imports, where the type isn't known yet or both are meant ("Add a
    photo or video first…", "Adding a clip", file errors).
  - The layer subtitle already said Video / Photo / Card.
- **Tests:**
  - Unit: `labels.test.ts`.
  - E2E (`media-labels.test.ts`), for a video scene and a photo scene: the heading, "Around
    the …", the Fit description, the sound slider (video only), the Custom tip, the reframe
    handle, the crop-mode subtitle, and "Same shape as the video" left unchanged. For video and
    photo layers: the sound switch (video only) and the crop wording.
  - Existing tests were updated for the new names ("Video sound volume", "Play the video’s
    sound", "…from this video").
- **Test stability:**
  - The auto-scroll test from the last change failed once under full-suite load. Its drop target
    sat in the bottom auto-scroll zone, so the view kept moving while the pointer travelled.
  - The test now parks the pointer mid-view, waits for scrolling to stop, re-measures, then
    drops. It passed 24/24 in parallel and in a clean full run.
  - The voiceover test (`phase5-sound`) flaked once more and passes on its own (6/6).

## Fix: black flash during transitions

### Root cause (found before fixing)

`e2e/transitions-frames.test.ts` plays, scrubs and saves ten solid red and blue scenes (every
pair of video, photo and card, trimmed and at 0.5× / 2×). It checks the centre of every frame
against the transition shader's own maths.

**Preview:** black frames from about 0.3 s after every cut until the transition ended, with every
type except slide.
- Crossfade: 0.30–0.40 s after the cut; fade through black: 0.30–0.50 s; zoom: 0.30–0.35 s.
- Slide is only 0.6 s long, so half of it ends right at 0.3 s.

**Export:** clean (only a test artifact at slide's exact midpoint, where the sampled patch
straddles the moving edge).

Two things together caused it:

1. **Two different ideas of "which scenes are needed".**
   - `compose()` (what gets drawn) keeps the outgoing scene on screen until half the transition
     after the cut, up to 0.5 s.
   - `Player.manageSources` (which decoders to keep) had its own rule: a scene that ended more
     than 0.3 s ago is "far" and gets `idle()`.
   - `idle()` clears that scene's frame cache, so for the rest of the transition the outgoing
     scene had no frame at all.
   - The same separate rule also prefetched the incoming scene at its trimmed start. A transition
     first shows it half a transition *before* that, in the footage before the trim, so its
     first frames could arrive late.
2. **A missing layer was drawn as black.**
   - `Compositor.render` only blends when both layers are present. With the outgoing layer
     missing it went to its "nothing to draw" branch and cleared the canvas to black, even
     though the incoming scene was right there.
   - (With the incoming one missing it showed only the outgoing scene, so the transition
     popped.)

The timing maths was fine. The windows are contiguous, speed and trimmed starts are handled in
`extendedSourceTime`, and photos and cards behave like videos. Export was fine because its
readers decode synchronously and are never idled, but it used the same compositor, so it would
have flashed in the same way if a reader ever returned nothing.

### The fix

- **One rule for which scenes are needed:** `scenesNeeded(placed, from, to, bounds)` in
  `model/composition.ts`.
  - It calls `compose` at every scene edge and transition edge in the span, so it can't disagree
    with drawing.
  - It returns each scene with the first source time it needs, including the footage a
    transition borrows from before a trim.
  - It is used by:
    - the preview (`Player.manageSources`): decoders stay awake for exactly these scenes; all
      others sleep;
    - export: the readers of scenes needed in the next 2 s are started early with `prepare`;
    - thumbnails: the scene at 0 s comes from `compose`.
- **Prepared early:** 2 seconds ahead while playing (was 1.5 s), 0.6 s while paused.
  - The incoming scene's decoder starts at the source time the transition first shows, not at
    its trimmed start.
  - Export readers open in the background (`ExportFrameReader.prepare`), and `frameAt` waits
    for that first.
- **Never black for a missing frame:**
  - The preview and export keep each scene's (and layer's) last good frame and use it while a
    new one isn't ready. In development builds this is logged with `console.debug`.
  - If a scene has never had a frame (right after a jump), the preview keeps the picture
    already on screen for up to a second instead of drawing a gap.
  - As a last resort the compositor draws whichever side of a transition has a picture,
    instead of clearing to black.
- **Test hook:** `Player.drawnTime` is the timeline time of the frame actually on screen, so the
  test checks every drawn frame against the exact expected colour.
- **Tests** (`transitions-frames.test.ts`, one per transition type):
  - ten scenes covering every ordered pair of video, photo and card (VV VP PP PC CC CV VC CP PV),
    with trimmed footage before and after, 2× and 0.5×, and red and blue fixtures
    (`solid-red/blue.mp4/.png`, 6 s, 2 s keyframe interval so seeks have to decode through);
  - every frame drawn during playback of the whole video;
  - scrubbing through every frame from 1 s before to 1 s after each transition, without waiting;
  - jumping from far away into the middle of each transition, and the exact mix once decoded;
  - every frame of the saved MP4 (with ffmpeg).
  - The centre colour must match the shader's maths (mix, darkening for fade through black,
    edge position for slide) within 28/255. Before the fix 9–36 frames per type were black;
    now none are.
  - Unit: `scenesNeeded` matches `compose` at every time, including just after a cut.

## Transition buttons: solid border

The round buttons between scenes now have a solid 1px border in `--color-border` instead of a
dashed one.
- Hover: the ink border and icon, plus the small grow.
- A set transition: filled with ink.
- Open (picker showing): the accent border with a 1px accent ring, so it still reads at 1px.

## Keyframes and export options

Follows the usual keyframe workflow (as in CapCut / Premiere): one keyframe holds every
animatable value, a diamond adds one at the playhead, and changing an animated item at the
playhead sets the keyframe there.

### 1. The model

- **`model/keyframes.ts`** (pure, unit-tested):
  - `Keyframe<V> {id, time, values, easing}`.
  - Overlays and words animate `ItemValues`: centre x/y as fractions of the frame, scaleX and
    scaleY, rotation in degrees clockwise, and opacity.
  - Scenes with Custom framing animate `FrameValues` (x, y, zoom).
  - `interpolate` holds the first or last keyframe outside them and eases in between, using the
    easing of the first keyframe of each stretch.
  - `itemValuesAt` and `sceneFrameAt` are the one way to get values at a time. The preview,
    Watch, thumbnails, export and the on-preview handles all use them.
  - `tidyItemValues` keeps opacity within 0–100% and the scale above 0, whatever the easing does.
- **Base size and scale:**
  - An overlay's `box.w`/`box.h` are its base size. `scaleX`/`scaleY` (shown as %, 100% = base
    size) apply on top of it, around the centre, and are what keyframes animate.
  - Changing the base size (the Width/Height fields, or resize handles on an item without
    keyframes) affects the whole animation.
  - Width and height scale are linked by default (`scaleLinked`); there's an unlink button.
  - Words get the same scale, rotation and an opacity. Their font size stays separate.
- **Times:**
  - Overlays and words: seconds from the item's start, so keyframes move with the item.
  - Trimming from the left (the end stays put) shifts them the other way, so the motion stays
    where it was on the timeline (`retimed` in the store).
  - Keyframes outside the visible part are kept and come back if the item is extended.
  - Scenes: the clip's own time (source seconds; for photos and cards, seconds into the scene;
    `sceneContentTime`). Changing the speed or trimming keeps them on the same moments of the
    video, so their timeline positions move with it.
  - `compose()` now gives each layer its `contentTime`.
- **Drawing:**
  - `overlayRect` returns the keyframed rect, rotation and opacity, with the entrance/exit on
    top: a fade multiplies the opacity, slide up offsets the position, pop multiplies the scale.
  - The overlay and text shaders turn their quads around the centre. An overlay's shadow offset
    is turned back, so the shadow still falls down the screen.
  - Words that grow are drawn from a larger sprite (`textSharpness`: in steps of 0.5, up to
    4×), so they stay sharp.
  - Thumbnails turn layers with the canvas transform and use the scene's framing at its first
    moment.
- **Editing at the playhead:**
  - `setItemValues` / `liveItemValues` (drags) and `setFrameValues` / `liveFrameValues` change
    the item itself when it has no keyframes.
  - With keyframes they add a keyframe at the playhead holding the values there, or update the
    one already there, so only that moment changes.
  - Everything that moves, scales, turns or fades an item goes through them: the box on the
    preview, the words on the preview, Custom reframing on the preview, the X/Y fields, quick
    placement, the opacity slider, and the new scale/rotation fields.
- **The box on the preview:**
  - It follows the item at the playhead: keyframed centre, base size × scale, rotation (CSS
    `rotate`).
  - Resizing works in the item's own turned frame and snaps to the frame's edges only when
    upright.
  - With keyframes, resizing changes the scale at the playhead; without, it changes the base
    size.
- **Settings:** Scale (%) with a link/unlink button, and Rotation (°), for layers and words.
  Words also get Opacity.
- **Tests:**
  - Unit (`keyframes.test.ts`): easings (CSS-matching bezier, hold, overshoot, bounce),
    interpolation and holding, opacity clamping, upsert, neighbours, shifting, base values,
    scene content time and speed.
  - Store: values with and without keyframes; left trim versus move.
  - E2E (`keyframes-model.test.ts`):
    - A blue square moves, doubles, turns 45° and fades. A point inside the diamond is blue; a
      point inside an upright square but outside the diamond is red. Checked in the preview and
      the saved MP4.
    - A quads video's framing zooms into its red quarter, and at 2× the zoom lands at half the
      times.
    - The words' scale, unlink and rotation fields work.
- **New fixture:** `quads.mp4` (the quads picture as a 6 s video).
- `project-files`' damaged-file test failed once under full-suite load and passes on its own
  (3/3).

### 2. Easing

- Easing belongs to the stretch from a keyframe to the next one and is stored on the first
  keyframe of it.
- **Presets:** Linear, Ease in, Ease out, Ease in and out (the CSS cubic-bezier values), Hold,
  Overshoot and Bounce.
  - The first four are curves you can fine-tune; Hold, Overshoot and Bounce are fixed shapes.
  - `easingPreset` names a curve, or returns "custom".
  - `cubicBezier` solves the curve like CSS: Newton's method, then bisection.
  - Overshoot goes about 10% past the target and settles. Bounce comes in under the target and
    bounces back up a few times, never past it.
  - Opacity is clamped after easing, so neither can push it outside 0–100%.
- **Curve editor** (`CurveEditor.svelte`, in a popover):
  - It draws the curve with room above and below for overshooting handles.
  - The two handles can be dragged (x kept within 0–1) or moved with the arrow keys (Shift for
    bigger steps). A drag is one undo step.
  - Under it are the preset chips, the preset's name (or "Custom"), and "Use for new keyframes".
- **In the settings** (`KeyframeSection.svelte`, for layers, words and Custom-framed scenes):
  - It shows how many keyframes there are, plus "Easing here", the stretch the playhead is in,
    which opens the curve editor.
  - (Right-clicking keyframe markers on the timeline comes in section 4.)
- **Store:**
  - `keyframeTrack(id)` gives any item's keyframes, whatever it is, with time conversions to
    and from the timeline and where the item shows.
  - `updateKeyframes` changes them as one undo step.
  - `setKeyframeEasing(id, keyframeIds, easing)` sets the easing on several keyframes at once.
  - `setDefaultEasing` changes the easing for new keyframes (Ease in and out to start with),
    remembered in localStorage (`scenes.defaultEasing`).
- **Tests** (`keyframes-easing.test.ts`):
  - Each preset's effect on the motion halfway, Hold's jump, Overshoot's overshoot, and
    Bounce's dip without passing the target.
  - A handle drag gives "Custom" with a slower start; a keyboard nudge; two undos give Linear
    back.
  - The default easing survives a reload and is used by a new keyframe.
  - Unit tests for the maths are in section 1.

### 3. Adding and editing keyframes

- **Diamond with arrows** (`KeyframeButtons.svelte`): ◀ ◆ ▶. They appear in the settings header
  of layers, words and Custom-framed scenes (only once the framing is Custom), and as a dark
  pill next to the floating toolbar over the preview.
  - The diamond (`toggleKeyframe`) adds a keyframe at the playhead with the item's values there.
    It's filled when the playhead is on a keyframe, and then removes it. Adding needs the
    playhead on the item (a friendly message otherwise).
  - The arrows (`seekKeyframe`) move the playhead to the item's previous or next keyframe,
    among those that show. They're disabled when there's none that way.
- **Automatic keyframes:** once an item has a keyframe, any change at the playhead goes through
  `setItemValues` / `setFrameValues` (section 1) and adds or updates the keyframe there. That
  covers dragging, resizing or rotating on the preview, the X/Y, scale, rotation and opacity
  fields, quick placement, the zoom slider and reframing. A drag only touches the keyframe at
  the playhead.
- **Rotation:**
  - Layers and words have a knob on a short stem above their box, turning with it.
  - Dragging it turns the item around its centre, following the pointer's angle; Shift snaps
    to 15°. It's one undo step and works at the playhead.
  - There's also a Rotation field (section 1).
  - The floating toolbars sit higher (40 px above the box, or below it near the top) so they
    never cover the knob.
- **Motion path** (`MotionPath.svelte`, for the selected layer or words with 2+ keyframes):
  - A thin dashed line through where it goes (96 samples, so the easing shows), with a dot at
    each keyframe. Clicking a dot goes to that keyframe.
  - Dragging the line (a wide invisible hit area) moves every keyframe's position together
    (`liveMoveAnimation`), as one undo step.
  - Clicking selects the path (it turns accent-coloured and gets focus): the arrow keys then
    nudge the whole animation by 1 project pixel (Shift: 10) without moving the playhead
    (`moveAnimation`). Esc or clicking elsewhere unselects it.
- **Remove all keyframes:** in the Keyframes section, with a confirmation. The item keeps its
  values at the playhead (`removeAllKeyframes`). Removing the last keyframe with the diamond
  does the same.
- **Tests** (`keyframes-editing.test.ts`):
  - The logo scenario: the diamond at 0.5 s, then a drag on the preview at 2.5 s adds the
    second keyframe; in between it moves.
  - A corner drag changes the scale at the playhead, not the base size.
  - The path and its two dots; prev/next; the toolbar's buttons.
  - The rotation knob with Shift gives a multiple of 15°, and the box turns.
  - Dragging the path moves both keyframes by the same amount; arrow and Shift+arrow nudges.
  - The filled diamond removes; Remove all keeps the values at the playhead.
  - Custom framing: the diamond only shows once it's Custom; the zoom slider makes a second
    keyframe. Words: the diamond and dragging them.

### 4. Keyframes on the timeline

- **Markers** (`KeyframeMarkers.svelte`): on layer and words items in their tracks, and on scene
  cards with Custom framing (along the bottom of the picture). Only keyframes inside the item's
  visible part show.
  - Shape by the easing that starts there: a diamond for Linear, round for eased curves, a
    square for Hold, a triangle for Overshoot and a ring for Bounce.
  - They're white with a dark edge so they show on any picture; selected ones are accent.
  - Positions use the storyboard's time map (piecewise, because short scenes get a minimum
    width), so markers line up with the ruler.
- **Selecting:**
  - A click selects the keyframe (and its item) and moves the playhead there. Shift-click adds
    or removes.
  - A selection box over markers selects those keyframes instead of items.
  - Selecting anything else, or Esc, clears it.
  - Store: `selectedKeyframes: {itemId, id}[]`.
- **Dragging:** moves every selected keyframe by the same time, shown live on all markers
  (`keyframeDragDelta`).
  - It snaps (within 8 px) to the playhead, item edges, scene boundaries, the video's ends and
    other keyframes, with a short line on the item; Alt turns snapping off.
  - Scene keyframes move by the matching stretch of their clip (the speed applies).
  - A keyframe landing on another one replaces it.
- **Delete/Backspace** removes the selected keyframes before anything else; their item stays.
- **Right-click** (also selects it):
  - Easing presets (the current one ticked; applied to every selected keyframe), Edit curve…
    (the curve editor in a popover, above the marker when there's no room below), and Delete.
  - Copy comes with section 5.
- **Popovers from inside the tracks** (this menu and the curve editor) are moved to `<body>`
  (`ui/portal.ts`). Inside the tracks' isolated stacking they could be covered by the divider.
- **Tests** (`keyframes-timeline.test.ts`):
  - Shapes for linear, eased and hold, evenly spaced. A click selects and seeks; Shift-click
    adds and removes.
  - A drag snaps onto the playhead, and the other selected keyframe moves the same; with Alt
    it doesn't snap.
  - Delete keeps the item; undo; a selection box over the markers.
  - Right-click easing for two at once (shapes change to bounce, then overshoot); Edit curve →
    Ease out; Delete.
  - Scene card markers: a click seeks, and at 2× the same marker is at half the time.

### 5. Copy and paste keyframes

- **Ctrl/Cmd+C** copies the selected keyframes when keyframes (not items) are selected; right-click
  → Copy does the same.
  - It copies those of one item (the first selected keyframe's): their values, easing and spacing
    on the timeline.
  - Copying items clears copied keyframes and the other way round, so Ctrl/Cmd+V pastes
    whatever was copied last.
- **Ctrl/Cmd+V** with copied keyframes pastes them onto the selected item: the first at the
  playhead, the others keeping their spacing (converted to that item's own times: seconds from
  its start, or its clip's time for a scene).
  - They replace keyframes at the same moments, and the pasted keyframes end up selected.
  - With nothing suitable selected, a friendly message says what to select.
- **Onto a different kind of item** (`convertValues`):
  - Layers and words share every property.
  - With a scene's Custom framing they share position (the framing's offset from the centre:
    item x − 0.5) and size (scale ↔ zoom).
  - What isn't shared (rotation and opacity onto a layer from a scene, and so on) keeps the
    target's own value at that moment.
- **Tests** (`keyframes-copy.test.ts`):
  - Onto another layer: times relative to its start, values, easing; no new layer; pasted
    keyframes selected.
  - Onto words, then onto a Custom scene (x − 0.5, zoom = scale, only x/y/zoom).
  - From a scene onto a layer, keeping the layer's rotation.
  - Right-click Copy, and the message with nothing selected.

### 6. With other features

- **Entrance and exit animations play on top of keyframes** (built into `overlayRect` and
  `textDraw` in section 1). A fade multiplies the keyframed opacity, slide up offsets the
  keyframed position, and pop multiplies the keyframed scale.
- **Splitting layers and words** (new: S splits the selected layer or words; scenes and sounds
  as before). `splitItemAtPlayhead`:
  - It cuts the item in two that look exactly like the one did.
  - Entrances stay on the first half and exits on the second. A video layer's second half
    starts later in its clip.
  - Words get `exitFade: false` on the first half, so they don't fade out at the split.
- **Splitting keyframes** (`splitKeyframeList`, exact):
  - Both halves get a keyframe at the split point with the values there.
  - The stretch around it is cut into two curves that trace the original: bezier easings are
    subdivided with de Casteljau and renormalised (`splitBezier`), and Hold stays Hold.
  - Overshoot and Bounce can't be cut into two of themselves, so that half keeps the keyframe on
    the other side instead (hidden past its edge). The motion is still identical.
  - Before the first keyframe or after the last, a still keyframe at the split point is enough.
- **Scenes** already keep their framing keyframes on both halves of a split (they're in the
  clip's time, so they're exact).
- **Words that grow** are drawn from a larger sprite (section 1), independent of the font size
  setting.
- **Tests:**
  - Unit: the split keeps the motion within 1e-4 for all seven easings, on a keyframe and
    outside them; fade/pop/slide on keyframed values in `overlayRect`.
  - E2E (`keyframes-interplay.test.ts`):
    - A fade times a keyframed 50% opacity, checked in pixels; slide up below the keyframed
      position.
    - A layer split twice with S, once inside an eased stretch and once inside an overshoot:
      position, rotation and scale identical at 50 times, the boundary keyframes, and the same
      pixel on either side of the split.
    - Words split with the same motion, no fade at the split, and no entrance on the second
      half.

### 7. Volume points on audio

- **Model** (`model/volume.ts`):
  - Volume points are keyframes of one value, `gain` (a loudness multiplier: 1 = as it is,
    0 = silent, up to +6 dB).
  - They're stored as `volumePoints` on sounds, video layers and scenes, on the same times as
    the item's other keyframes: from the item's start, or the clip's time for scenes, so they
    stay with the content when the speed changes.
  - Easing choices: Linear, Ease in, Ease out, Ease in and out, Hold.
  - The line's height is a dB scale from −40 dB to +6 dB, with the very bottom silent
    (`gainToLevel` / `levelToGain`).
- **Same tools as keyframes:**
  - The store's keyframe functions take a `channel` ('motion' or 'volume'). `volumeTrack(id)`
    gives any audio item's points with time conversions.
  - So selection (click, Shift-click), Delete, easing from the right-click menu, snapping, and
    Ctrl/Cmd+C/V (onto the selected sound or video, first point at the playhead) work the same
    way. Volume and motion keyframes don't paste onto each other.
- **The line** (`VolumeLine.svelte`):
  - It's drawn across every song and voiceover, every video layer with its sound on, and every
    video scene card with sound.
  - It's sampled from the same function the mix uses, so it follows each easing exactly.
  - Clicking the line adds a point there at the line's level and starts dragging it. Dragging a
    point changes its gain (up/down) and its time (left/right, snapping; Alt to place freely),
    with a dB label.
  - The waveform takes a `gain` function, so quieter parts are drawn smaller.
  - Sound clips' fade dots sit above the line (at full volume it runs near their height).
- **The mix:**
  - `AudioClip.envelope` holds the points in timeline time. `clipGainAt` multiplies them with
    the clip's volume and fades.
  - `scheduleClipGain` follows a clip with points by ramping through samples every 20 ms plus
    its exact corners (point times, just before them for Hold, fade ends).
  - Live playback, `mixdown` and export all use it, so they sound the same. Changing points
    while playing retunes the playing sound.
- **Editing:**
  - Trimming a sound or video layer from the left shifts its points like keyframes, so the line
    stays put on the timeline.
  - Splitting a sound or video layer splits the line exactly (`splitKeyframeList`).
- **Tests:**
  - Unit: the dB mapping, holding, dB text, multiplying with volume and fades.
  - E2E (`volume-points.test.ts`):
    - Points added by clicking the line, and one dragged down with the "−x.x dB" label. The mix
      is much quieter there and halves with the clip volume; the waveform is smaller there; the
      saved MP4's loudness ratio matches (ffmpeg).
    - Hold and Ease in from the right-click menu; select, copy, delete, paste at the playhead.
    - A split keeps the line at 40 times and the loudness.
    - Video scenes and sound-on video layers have the line, and a point silences a scene's own
      sound.

### 8. Everywhere

- **One set of functions** gives keyframed values and volume, used by the preview, Watch (the
  same player), thumbnails and export: `itemValuesAt` / `sceneFrameAt` (in `overlayRect`,
  `textDraw`, `layerInput`) and `clipGainAt`.
- **The home picture** now shows the video's very first moment, layers included with their
  keyframes there (without their entrance). It used to draw layers a moment after they appeared,
  which no longer matches once they move.
- **Undo and autosave:** every keyframe, easing and volume-point change goes through `edit()`,
  so each is an undo step and autosaved. Collapsed tracks stay the exception (section on
  slimmer tracks).
- **`.scenes` files: format 3** (`FILE_FORMAT_VERSION`).
  - New fields: `keyframes` and `volumePoints` on layers, words, scenes and sounds, plus scale,
    rotation and opacity on layers and words.
  - The 2 → 3 step changes nothing (there were no keyframes).
  - `migrateProject` now runs `tidyKeyframes` for both files and stored projects: keyframe lists
    are sorted; entries without a time or values are dropped; an easing this version doesn't
    know becomes Linear; empty lists are removed. A damaged or hand-edited file can't break the
    editor.
  - Older apps refuse format 3 files ("made with a newer version") rather than open them and
    lose the animation.
- **Tests:**
  - Unit (`zip.test.ts`): keyframes and volume points round-trip; out-of-order, broken and
    unknown-easing keyframes are tidied; the manifest says format 3.
  - E2E (`keyframes-everywhere.test.ts`):
    - Watch shows the moving card where the preview does.
    - The home picture has the card at its 0 s keyframe position.
    - Diamond, undo and redo; a rotation keyframe, saved and still exact after a reload.
  - The saved MP4 matching the preview for keyframes and for volume is checked in sections 1
    and 7.

### 9. Save dialog structure

- **Two choices at the top:**
  - **What:** Whole video, or Range. Range is greyed out until a range is set; its tooltip says
    "Set a range first: I for its start, O for its end". It's chosen by default when there is one.
  - **Save as:** Video for now. GIF, Audio only, Current frame and Overlays only are added in the
    sections that build them.
  - Both are `ChipGroup`s, which can now have disabled options: skipped by the arrow keys and
    shown faded.
- **Below them**, the options for the kind chosen (the quality cards for a video), then a
  summary line: output size · length · about how big the file will be (`export-summary`). The
  estimates follow the chosen length.
- **One renderer for every kind of saving** (`export/renderer.ts`, `FrameRenderer`):
  - Frame drawing moved out of `exportVideo`: the same compositor, `compose`, keyframes,
    overlays and words, decoders prepared 2 s ahead and freed once behind, and the last good
    frame held.
  - It has an `overlaysOnly` mode (section 14), with a transparent compositor
    (`new Compositor(canvas, { transparent: true })`: an alpha canvas, premultiplied, cleared to
    transparent).
  - The video, GIF, frame and overlay exports all draw through it, so they all match the
    preview.
- **`exportVideo`** takes a `range` (`exportRange` keeps it within the video). Frames are drawn
  at timeline time `range.start + i / fps` but stamped from 0 in the file, and the sound is
  mixed for the same span.
- **Tests:**
  - `export-dialog.test.ts`: the What and Save as groups, Range disabled with its hint, and the
    summary line changing with the quality.
  - The existing save tests (MP4 vs preview, WebM fallback, keyframes, volume, transitions)
    pass unchanged on the new renderer.

### 10. Range

- **Setting it:**
  - **I** starts the range at the playhead, keeping its end if that's later, or else ending at
    the video's end. **O** ends it at the playhead, keeping its start if that's earlier, or else
    starting at 0.
  - **Alt/Option+X** clears it. It's matched by key position (`code === 'KeyX'`) because
    Option+X types a symbol on a Mac.
  - All three are in the shortcuts dialog.
  - Store: `setRange` keeps it inside the video, start before end (at least a frame), rounded
    to the millisecond. `setRangeStart`, `setRangeEnd`, `clearRange`, and `setRangeToSelection`
    (from the first selected item's or scene's start to the last one's end).
- **Saved with the project** (`project.range`), so it's undoable, autosaved and in `.scenes`
  files. `migrateProject` drops a range that makes no sense.
- **On the ruler:** a tinted area with dark edges.
  - Drag an edge (each has a small grip at the bottom, clear of the playhead's knob) to change
    it, snapping to the playhead and scene edges (Alt: no snapping). One undo step.
- **The storyboard toolbar** is now a slim row of its own above the ruler (28 px), rather than
  sitting on the ruler. With the range buttons it had grown wide enough to cover the playhead's
  knob near the end of the video.
  - The range buttons are icon-only: "Range start at the playhead" (I), "Range end at the
    playhead" (O), and a "…" menu with Set range to selection and Clear range (Alt+X).
  - The storyboard's height constants grew by the same 20 px.
- **Saving:** the dialog picks Range by default when one is set, and the length and estimate
  follow it. Every kind of saving takes the range; the video export from section 9 already
  does.
- **Tests** (`export-range.test.ts`):
  - I and O at 1 s and 3 s, with the area at the right place on the ruler. Alt+X, undo, and a
    reload keep it.
  - The toolbar buttons; dragging the end snaps onto the cut at 4 s (one undo step); Set range
    to selection on scene 2; Clear.
  - A 3–5 s range saved as video: Range preselected, "2 sec", and an MP4 of about 2 s that is
    red then green (ffmpeg).
- **Other tests:**
  - `text-style`'s MP4-versus-preview text check became sensitive to the slightly smaller
    preview (points on letter edges). It now accepts a match within 2 px in the saved frame.
  - An experiment with the old storyboard height confirmed the saved video itself hadn't
    changed.

### 11. Current frame

- **`exportFrame`** draws the frame at the playhead with the same `FrameRenderer` as the video
  export, at the project's own size. It's saved as PNG, or as JPG with a quality from 40% to
  100%.
  - At the very end of the video it saves the last frame.
  - File name: "Title 0-03.20.png" (minutes-seconds, no characters files can't have).
- **Three ways to save it:**
  - The Save dialog, Save as → Current frame. It has PNG/JPG and a quality slider for JPG. The
    What row is hidden (a frame is at the playhead), and the summary says "1280 × 720 · 1 frame
    at 0:03 · about …".
  - Right-click on the preview: "Save this frame as PNG / JPG".
  - **F** (it wasn't used), listed in the shortcuts.
  - The last two save straight away (`downloadFrame`) with a "Saved …" message.
- **The dialog** is now table-driven per kind (button, "Saving …" and "… is ready" headings),
  ready for the next three kinds. Video results keep their container and codecs
  (`ExportResult.format` is optional now).
- **Tests** (`export-frame.test.ts`):
  - PNG from the dialog: no What row, the summary, the file name, a real PNG at 1280 × 720.
    The card's pixel matches the preview, and the same moment of the saved MP4 matches the
    PNG (ffmpeg).
  - JPG at 60% is a real JPEG and smaller than the PNG.
  - The right-click menu, F, and the shortcuts dialog.

### 12. Audio only

- **`exportAudio`** saves just the sound from the same mix as the video export (`projectAudioClips`
  + `mixdown`, in 2 s chunks): scene sound, layers with sound, music, voiceovers, their volumes,
  fades and volume points. It respects the range.
- **Formats** (all through Mediabunny's writers):
  - **WAV:** always, 16-bit PCM, 48 kHz stereo.
  - **M4A:** AAC in an MP4 container, only when the browser can encode AAC (`canSaveAudio`).
    Otherwise the chip is greyed out with a note.
  - **MP3:** browsers can't encode it, so `@mediabunny/mp3-encoder` (Mediabunny's own extension:
    the LAME encoder in WebAssembly, from Mediabunny's author) is loaded on first use and
    registered, unless the browser can do MP3 itself.
  - M4A and MP3 offer 128, 192 or 320 kbps.
- **Dialog:** Save as → Audio only with Format and Bitrate, a summary "Sound · 48 kHz stereo ·
  length · about …", "Save audio", and "Your sound is ready" (no picture size shown).
- **New dependency:** `@mediabunny/mp3-encoder` (^1.61.0, same version as Mediabunny).
- **Tests** (`export-audio.test.ts`; a song with a −20 dB dip at 4–5 s, range 2–6 s):
  - WAV: RIFF, `pcm_s16le`, 48 kHz, 2 channels, 4 s long. The dip is at 2–3 s in the file, and
    its loudness ratio matches the app's own mix.
  - M4A at 128 kbps is AAC, 4 s long and under 170 kbps (or the chip is disabled where AAC
    isn't available).
  - MP3 at 320 kbps is MP3, 4 s long, above 280 kbps, with the dip.

### 13. GIF

- **`exportGif`** draws frames with the same `FrameRenderer` at the GIF's size and reads them
  back through a 2D canvas.
  - **GIF** (`gif.ts`, using `gifenc`):
    - Every frame gets its own 256-colour palette (gifenc's PnnQuant quantizer).
    - Optional Floyd–Steinberg dithering is ours (`ditherToPalette`, with a nearest-colour cache)
      because gifenc has none.
    - Loop forever writes the NETSCAPE2.0 block; once leaves it out.
  - **Animated WebP:** Chrome encodes each frame as a WebP picture (`convertToBlob`, quality
    0.82). `muxAnimatedWebp` packs them into one RIFF/WEBP file with VP8X (animation flag,
    canvas size), ANIM (loop count) and one ANMF per frame (duration, no blending).
    - It's offered only where the browser can encode WebP (`canMakeWebp`; the canvas needs a
      context first, or the check wrongly says no).
    - The dialog notes it's better and smaller but not shown everywhere.
- **Options:**
  - Width 320, 480 or 640 px (those under the project's width), or Full; the height keeps the
    shape (`gifSize`).
  - 10, 15 or 20 fps; plays over and over or once; dithering on or off (GIF only).
  - The range applies.
- **Estimate and warning:**
  - About a third of a byte per pixel per frame (half with dithering; WebP about a third of
    the GIF).
  - Over 15 seconds or 20 MB, a gentle note suggests a shorter range or smaller size; saving
    stays possible.
- The Save dialog now scrolls inside itself on short windows (GIF has the most options).
- **New dependency:** `gifenc` (^1.0.3), with type declarations in `src/gifenc.d.ts` (it ships
  none).
- **Tests:**
  - Unit (`gif.test.ts`): sizes, GIF89a with three frames and the loop block (or not),
    dithering a mid grey into about half white, and the WebP container layout.
  - E2E (`export-gif.test.ts`):
    - A 0.5–2.5 s range at 320 px and 10 fps is 320 × 180 with 20 frames; the card is where the
      video has it at frames 0 and 5 (ffmpeg).
    - "Once" has no loop block. The whole video at full size and 20 fps shows the warning, and
      Save stays enabled.
    - Animated WebP: Chrome's own ImageDecoder reads 20 frames at 320 × 180, with the card
      halfway at frame 5.

### 14. Overlays only (transparent)

- **`exportOverlays`** draws only the overlay tracks and words (`FrameRenderer` in `overlaysOnly`
  mode, so no scenes) on a transparent compositor, at the project's size and frame rate. The
  range applies, and there's no sound.
- **WebM with transparency:** VP9 with `alpha: 'keep'` in WebM (Mediabunny).
  - It's offered only when `VideoEncoder.isConfigSupported({ codec: 'vp09.00.10.08', …,
    alpha: 'keep' })` says yes (`canSaveTransparentWebm`) and is then the default.
  - Otherwise the WebM option is hidden, with one line: "This browser can't make transparent
    videos, so the frames are saved as PNG pictures."
- **ZIP of PNG frames:** always offered. `frame_00001.png` and so on, one transparent PNG per
  frame, stored without recompressing (zip.js).
- **Dialog:** "Overlays only", with the format and a summary "1280 × 720 · 30 fps ·
  transparent · length · about …".
- **The Save dialog** now picks what to run with a plain `switch` (`run()`) instead of a chain
  of conditions.
- **Tests** (`export-overlays.test.ts`):
  - ZIP: 30 frames for a 1 s range; a real PNG; fully transparent around the card and opaque
    blue on it.
  - WebM: where supported, a single VP9 stream with `alpha_mode` 1, about 1 s long, with
    transparent corners and an opaque card (decoded with libvpx). Where not, the option is
    hidden and the explanation shows.
- **Not verified here:** in this test Chrome (153), `isConfigSupported` refuses alpha for every
  VP9 and VP8 configuration. So only the "not supported" path ran; the WebM-with-alpha path
  is untested on a real encoder.

## Fix: stuttering trims and moves

### Measured, and the root causes (written before fixing)

`e2e/drag-smooth.test.ts` drags a photo layer's right edge in 1–2 px steps on a 10-track project
and records the width, label and snap line after each move. A CDP profile and call counts were
taken over 150 moves of a snapping drag.

**What it showed:**
- The width followed the cursor only with Alt held (no snapping).
- With snapping, the snap line was at **51 different positions** during one snapped stretch.
- The label only showed whole seconds ("0:03").
- 150 moves caused **148 seeks and 153 full preview re-renders**.
- **One autosave**, with a new home-screen picture, happened in the middle of the drag.

**Causes** (the checklist's suspects, in order):

1. **Expensive work on every pointermove: yes, through the playhead.**
   - Trimming and moving called `editor.seek()` on every move, so the playhead followed the
     edge.
   - Each seek re-drew the whole preview (decoding and compositing), and changed `editor.time`,
     which everything showing values "at the playhead" depends on: the settings column, the
     keyframe diamond, markers, scale and rotation fields. So all of that re-rendered on every
     move.
   - A seek can also schedule an autosave and a new home picture. That's the save in the middle
     of the drag.
   - The undo history was not touched during the drag: it's already one edit at the end.
   - Waveforms and filmstrips weren't recomputed (no `computePeaks`). But a sound clip's
     waveform canvas was redrawn on every width change, and a scene being trimmed re-laid out
     and refilled its filmstrip tiles on every move.
2. **Snapping to a moving target, with no hysteresis: the main cause of the jumps.**
   - The playhead is a snap target, and the playhead had just been moved to the dragged edge. So
     on the next move the edge snapped back to where it was a moment ago.
   - The snap line hopped along with it (51 places), and the edge lagged and jumped.
   - On top of that, snapping started and stopped at the same 8 px, so near a target it
     flickered on and off.
3. **Coarse rounding:** not for trims or moves (they weren't rounded at all). The label was
   coarse: `formatClock` shows whole seconds, so it sat at "0:03". Fade drags round to 0.1 s
   (kept: fades are set in tenths).
4. **Pointer to time:** consistent. Every drag goes through the storyboard's `map` (zoom, the
   minimum widths of short scenes) relative to the lane, so the header width and scroll don't
   enter into it.
5. **The shared drag helper:** all of these drags already use `DragScope` / `startDrag` from the
   earlier fix.
6. **Not batched:** every pointermove changed reactive state straight away (several moves can
   arrive per frame).

### The fix

The rule for every drag: show a light preview, at most once per animation frame, and change the
project (undo history, autosave, playhead) once, when the drag ends.

- **Once per frame** (`ui/frameBatch.ts`): pointermoves are queued and only the latest is applied,
  on the next animation frame. `flush()` applies a pending one when the drag ends, before
  committing. Used for:
  - trims, moves and fade drags of layers, words and sounds (`TrackLane`);
  - keyframe markers, and volume points;
  - scene-edge trims, scene reordering and range edges (`Storyboard`);
  - moving and resizing layers and words on the preview.
- **No seeking while dragging.** The playhead goes to the dragged edge (or item) once, at the
  drop. So nothing tied to the playhead re-renders during a drag, and the preview isn't redrawn.
  - On the 150-move measurement: 148 seeks → 1, and 153 preview renders → 4.
  - Scene trims still show the frame at the edge (their "peek"), once per frame.
- **Steady snapping** (`editor/snap.ts`, `Snapper`):
  - It snaps within 8 px and lets go only past 12 px.
  - Targets don't move during a drag, and there's one snap line, at the target actually snapped
    to.
  - Used by item trims and moves, keyframes, volume points and range edges. Alt still turns it
    off.
- **Whole frames:** dragged times round to the project's frame rate (`toFrame`), except when
  snapped exactly onto a target.
- **Live label:** "3.6 s" (the new length) while trimming, and "0:03.4" (the start,
  `formatTenths`) while moving.
- **One undo step and one autosave per drag:**
  - Track items, keyframes and range edges already committed once.
  - Volume points used to write the project on every move (merged into one undo step, but still
    saving and re-rendering each time), and a click on the line added a point as a separate step
    before the drag. Now the dragged or new point is a local preview, and one edit is made at
    the end.
- **Nothing is regenerated while dragging:**
  - A sound's waveform keeps its last drawing, stretched (`live={false}`), and is redrawn after
    the drop.
  - Scene filmstrips are frozen during storyboard drags (`frozen`, stretched) and refilled after.
  - Layer thumbnails were already a tiled background.
- **Tests:**
  - Unit (`snap.test.ts`): enter and release distances, the nearest single target, Alt, whole
    frames, tenths.
  - E2E (`drag-smooth.test.ts`, 10 overlay tracks with 27 cards plus a photo layer and three
    scenes):
    - A photo layer's right edge dragged 2 px at a time: the width never goes back, never jumps
      more than the move plus a frame, and ends 120 px wider. The label is live in tenths, the
      length is whole frames, and IndexedDB writes and undo steps each go up by exactly one.
      Undo restores it.
    - Snapping 1 px at a time past card edges and the cut: each target is held over a run of 8+
      moves with the width still and the line in one place; no target is snapped twice; the cut
      is among them.
    - Moving an item: smooth, the label shows the start, one save, one undo step.
    - A scene's end trimmed: the card shrinks smoothly to whole frames, one save, one undo step.
  - `sound-editing`'s label check now expects "10.0 s" instead of "0:10".
- **Not part of this fix:** a lint pass over `src/lib` found 25 older errors (unused imports,
  `goto` without `resolve`, plain Map/Set in the store), flagged as a separate cleanup task (since
  done). The files touched here lint clean.

## Objects outside the frame (the pasteboard)

Layers, cards and words can sit anywhere, also completely outside the frame, so they can slide
in from off-screen with keyframes.

### Limits removed

- Words were held between 4% and 96% of the frame (dragging and arrow keys in `TextOverlay`).
  That was the only limit: layers (`dragBox` with `bounded: false`), card rectangles and the
  position fields already took any value. Keyframe values were never clamped (only opacity, and
  scale above 0.01).

### The stage is a pasteboard

- **How it's drawn.** The preview canvas stays exactly the frame, as before. Behind it, a second,
  transparent canvas covers the whole stage (`canvas.pasteboard`, its own `Compositor`).
  - After each preview frame, the player draws on it only the pictures and words that reach
    outside the frame (`reachesOutside` in `render/visuals.ts`, counting rotation and shadows),
    at 30% of their opacity (`Player.PASTEBOARD_FADE`).
  - It uses the same draws as the preview, placed with a view transform (`uView` in the overlay
    and sprite shaders; `Compositor.renderPasteboard`).
  - The opaque frame canvas covers the middle, so what shows is the faded part outside.
  - When nothing is outside, it's cleared once and then left alone, so ordinary projects cost
    nothing extra.
- **Only in the editor.** Watch draws on its own canvas (the pasteboard is skipped while that's
  attached). Exports, GIFs, frames, overlays-only and home pictures are drawn on frame-sized
  canvases, so they show only what's inside the frame.
- **Pan and zoom** (`Stage.svelte`):
  - The view is Fit (`view = null`: the old CSS sizing, unchanged) or a zoom in screen pixels per
    project pixel plus the frame centre's offset.
  - Scroll pans; Ctrl/Cmd + scroll (or a pinch) zooms around the pointer. The wheel listener isn't
    passive, so the page doesn't scroll or zoom instead. The reframe view keeps its own
    scroll-to-zoom.
  - Space + drag (or the middle button) pans.
  - The zoom menu at the right of the play controls has Fit, 50%, 100%, Zoom in and Zoom out.
  - Zoom is limited to 1/8 of Fit up to 800%, and the frame can go about one frame-width past
    the stage's edges.
- **Space still plays.** Held over the stage, Space waits for the release: if there was no drag
  in between, it plays or pauses. Anywhere else (and in dialogs, text fields, crop mode or while
  recording) Space works as before.
- **Frame edge.** A thin outline marks the frame. The preview's corners are now nearly square
  (3 px), so the rounded corners don't hide what's at the frame's edge. The empty-project drop
  area keeps its round dashed look.
- **Clipping to the stage.** The preview, outline and the boxes, handles, motion path and card
  rectangle are cut off at the stage's edges (a `clip-path` from `StageView`,
  `editor/stageView.svelte.ts`).
  - Otherwise a box far outside the frame would sit over the storyboard or the side panels and
    catch their clicks. (Card rectangles overhanging the frame used to do this.)
  - Toolbars and popovers are not cut off. The words' toolbar moved out of the words' box, so it
    is also no longer scaled or turned with them.
  - A selected object's toolbar is pinned inside the stage, so it's reachable wherever the object
    is (`StageView.pin`).
- **Selecting outside the frame.** Boxes are positioned in frame coordinates and simply extend
  past the preview. So selecting, dragging, resizing, turning and the motion path work the same
  outside it. Clicking the empty pasteboard deselects.

### Snapping and "Move off-screen"

- **Snapping just outside each edge.**
  - Layers: moving already snapped any edge (left, middle or right) to the frame's edges. So the
    right edge also snaps onto the frame's left edge: the layer is then just outside.
  - Words: they now snap the same way (`snapOutside`), within 8 screen pixels, as well as to the
    centre.
  - Alt turns snapping off for both.
- **Move off-screen** (layer and words settings: Left, Right, Top, Bottom).
  - It puts the object just outside that edge, keeping its other coordinate
    (`EditorStore.moveOffscreen`, `model/offscreen.ts`).
  - "Just outside" uses the on-screen size at the playhead (`itemExtent`). That's the scale,
    the rotation's bounding box, and a layer's shadow or the words' outline and shadow, so
    nothing peeks in.
  - It's an ordinary `setItemValues`: with keyframes it sets the one at the playhead.

### Tests

- **Unit:**
  - `offscreen.test.ts`: the turned box, the off-screen centre, snapping just outside, and
    layers dragged anywhere with the far edge snapping onto the frame.
  - `visuals.test.ts`: `reachesOutside`.
  - The store: `moveOffscreen` on each side, turned, with a shadow, and with keyframes.
- **E2E (`pasteboard.test.ts`):**
  - Words dragged completely off the left edge: x < 0, about 30% opacity on the pasteboard,
    still selectable there.
    - Keyframed from there to the centre, they straddle the edge on the way.
    - In the saved MP4, the left edge is pure red at the start, the box arrives in the middle,
      and it crosses the edge in between.
  - A card (Right), a photo (Top) and a video (Bottom) moved off-screen with the buttons:
    - each keyframe at the playhead is updated, not added, and each shows faded outside;
    - in the saved MP4, nothing is visible at the start (right up to the edges), all three are
      in place at 2 s, and the card is half-way in at 1 s.
  - Snapping just outside the left and bottom edges (a card) and the right edge (words).
  - Pan and zoom:
    - Ctrl + scroll keeps the point under the pointer.
    - Scroll and Space + drag pan by exactly the drag, and Space alone still plays and pauses.
    - 50% and 100% are true sizes; at 100% the frame is cut off at the stage. Fit restores the
      exact original box.
  - A box past the stage's edge doesn't catch clicks there.
- **Existing tests changed:**
  - `selection.test.ts` clicks the visible corner of a card rectangle: it's been resized to
    reach past the stage, where it's now cut off.
  - The zoom button's name is "Stage zoom: …", so the storyboard's "Fit" button stays unique.

## Very large words (up to 2000 px)

- **Range:** 12–2000 px (was 400; `MAX_TEXT_PX`). Typed values outside it are brought into range,
  and the field shows the clamped value, even when the size itself doesn't change.
- **Arrow keys** in the number field: 1 px, or 10 with Shift (`TextSizeField`).
- **A curved slider.** Position p (0–1) maps to `12 × (2000/12)^(p^1.6)` px (`sliderToTextPx`,
  `textPxToSlider`).
  - Sizes up to 200 px take about two thirds of the slider, and each of its 1000 steps there
    changes the size by 2 px at most.
  - The far end is still 2000 px.
  - A plain logarithm would give 12–200 px only 55% of the slider.
  - Its value is read out as "48 px". `Slider` got `showValue={false}`, since the number field
    already shows it.
- **Sharp and within the GPU's limits.**
  - Words are drawn once into a sprite and kept (`TextSpriteCache`). They're redrawn only when
    the words, their style or the frame size change. Moving, turning, scaling and fading never
    redraw them.
  - Words that grow are drawn larger so they stay sharp (`textSharpness`, up to 4×). That
    factor is now capped by `spriteFactor`:
    - no side larger than the GPU's `MAX_TEXTURE_SIZE` (asked from each compositor, so the
      preview, pasteboard and export each use their own);
    - no more than 32 M pixels (about 128 MB) per sprite.
  - The factor is worked out once per sprite (cached), not every frame. The drawn size on
    screen doesn't depend on it: `TextDraw.scale` divides by it.
  - So 2000 px words growing 4× are drawn as large as fits, rather than failing to upload.
    - Typically about 1.4× the frame's resolution, so they're sharp at 1× and a little soft
      at 4×.
    - On a GPU with a small limit, they're drawn smaller and scaled up rather than missing.
  - Outlines, boxes, bands and shadows scale with the font size. They're inside the same
    sprite, with its margin (`bleed`), so they're capped together.
- **Thumbnails** (home pictures) still show only the pictures at 0 s, not words, so very large
  words don't affect them.
- **Tests:**
  - Unit: the slider curve (round trips, 200 px past two thirds, steps ≤ 2 px up to 200 px).
  - Unit: `spriteFactor` (small words get the full 4×; 2000 px words growing 4× fit 16384 px
    and the budget and are still sharper than the frame; a 4096 px GPU fits too).
  - E2E (`text-size-large.test.ts`):
    - typing 2000, 5000 (→ 2000) and 3 (→ 12);
    - arrows and Shift + arrows, stopping at 2000;
    - the slider's ends, 200 px past 0.6, and one step half-way changing it by at most 1 px;
    - 2000 px boxed words growing 1×→4×: every sprite canvas within the GPU limit and the
      budget, and the preview covered by the box;
    - 1.5 s of playback over 20 fps with no sprite redrawn;
    - the saved PNG frame has crisp letter edges (under 2% in-between pixels);
    - the saved MP4 shows them at the start and while growing.

## Text shadow

Words have an editable drop shadow (`TextShadowSettings`, below Color in the text settings).

- **Model** (`TextShadow` in `model/textStyle.ts`):
  - `on`, `color` (hex), `opacity`, `blur`, `distance` and `angle`. 0° points right and 90°
    down (clockwise).
  - Blur and distance are fractions of the font size. So a shadow looks the same at 40 px and
    2000 px.
  - The settings show (and take) pixels at the words' current size. The Blur and Distance
    sliders run to 100 px, or further if the value is already bigger.
- **Each style has its own shadow** (`StyleSpec.shadow`): Big title and Serif italic start with
  the soft one; Clean white, Bold box, Outlined and Highlighter without.
  - A shadow that's off still holds values (the Soft preset), so turning it on starts from
    something sensible.
  - The words' own shadow (`TextItem.shadow`) replaces the style's.
  - Picking a style clears it (like colours), so the new style's default applies. "Reset shadow"
    clears it too.
- **Clean white used to have a shadow.** Projects now record which defaults their words were
  made with (`Project.styleDefaults`, 2 for new ones).
  - `migrateProject` gives older Clean white words the old soft shadow explicitly, so they look
    as before. `.scenes` files go through the same migration.
- **Presets** (chips): Soft (the old built-in shadow), Hard (no blur), Long (far, at 45°) and Glow.
  Glow is white, distance 0 and a wide blur: a glow all around the letters. The chip for the
  matching preset shows as chosen (`shadowPreset`).
- **Angle:** a small dial (drag it, or use the arrow keys: 1°, Shift 15°) and a number field.
- **Drawing** (`drawTextSprite`):
  - The letters and outline go into their own layer. The shadow is cast once, by that layer:
    it's drawn far off the canvas, and its shadow brought back by the offset. So the shadow
    keeps its own opacity, translucent letters don't weaken it, and an outline casts a shadow
    with the letters instead of the fill's shadow landing on the outline.
  - Boxes and highlighter bands are drawn first, under the shadow. So the shadow falls on the
    box, and the box itself doesn't cast one.
  - The sprite's margin (`bleed`) includes the blur (3σ) plus the distance (`shadowReach`), so a
    long or wide shadow isn't cut off.
  - Typing on the preview uses the same values as a CSS `text-shadow`.
- **Same everywhere:**
  - The shadow is part of the cached text sprite, so the preview, the pasteboard, Watch and every
    export draw exactly the same thing. It turns and scales with the words' keyframes.
  - A large blur on very large words is drawn once per change, not per frame. (The sprite cache's
    key includes the resolved style.)
  - **Home pictures now include words.** Words showing at 0 s are drawn with the same sprite,
    fully shown, after loading their fonts. The picture's key includes them, so it's made again
    when they change.
- **Undo, autosave, files, copy:**
  - `setTextShadow` is an ordinary edit. Slider drags are merged into one step per control.
  - The shadow is part of the item, so it's saved, in `.scenes` files, and copied with
    copy/paste and track duplication.
- **Tests:**
  - Unit (`textShadow.test.ts`): style defaults, overrides, the offset at an angle relative to
    the font size, the reach, presets, the CSS, and the migration. Store: undo/redo, copy/paste,
    a new style resetting it, and Reset.
  - E2E (`text-shadow.test.ts`):
    - a Big title's shadow off and on;
    - colour, opacity (purple when half), blur (less solid), distance and angle via the field
      (left/right), the dial (down) and its arrow keys; undo;
    - presets, Glow's light ring on all four sides, Reset shadow, and Clean white bringing no
      shadow;
    - the same blue shadow in Watch, at the same points in the saved MP4, and on the home
      picture;
    - a 900 px glowing title, turning and growing, playing over 20 fps with no sprite redrawn.

## Typing words, live

Words change as they're typed, in the settings' Words field and on the preview. Nothing needs
confirming.

- **Live:** every input calls `EditorStore.typeTextWords`.
  - It keeps the words exactly as typed, trailing spaces and new lines too, so the field and the
    words don't fight.
  - The preview, the timeline's label and the other field follow straight away.
  - Only that text item's sprite is redrawn (the sprite cache is per item).
  - Words emptied while typing keep their last text until typing ends, then they're removed (as
    before).
- **Enter is a new line** on the preview too. It used to confirm; Shift + Enter made a new
  line.
- **Esc or a click elsewhere stops typing** and keeps what was typed. Esc used to cancel.
  - Focusing the Words field while typing on the preview stops the preview's typing. Typing on
    the preview updates the field.
  - So the two are always in step.
  - `finishTextWords` tidies the words (extra blank lines, trailing space) as part of the same
    undo step.
- **The preview's typing box** gets the words once, when it opens (`initialText`). After that only
  the typing changes them, so the live updates never move the caret.
- **Undo in bursts.**
  - Typing uses one undo key per item (`words:<id>`). Changes less than a second apart merge, as
    `History` already did.
  - A pause of over a second starts a new step.
  - So does ending typing: `History.seal` closes the run, on blur, Esc, a click elsewhere or
    selecting something else.
  - Inside the field itself, the browser's own undo still works letter by letter.
- **Composed characters:** input events with `isComposing` are skipped, and `compositionend`
  applies the result. So an input method never puts half a character (c before č) into the words.
- **Autosave is now debounced:** 500 ms after the last change, and at most 2 s after the first
  (`Autosaver`). It used to be 300 ms after the first.
  - A burst of typing is one or two saves, not one per keystroke.
  - Nothing is lost on an immediate reload: changes are in the project as they're typed, and
    leaving the page writes the synchronous emergency copy (`pagehide` → `flushSave`).
- **Tests:**
  - Unit:
    - `History.seal`;
    - typing applied as typed, one step per burst, tidied and removed when empty at the end;
    - the autosaver's debounce and its 2 s cap.
  - E2E (`text-live.test.ts`):
    - the field: the box widens per keystroke, the timeline label follows, Enter makes two
      lines, Esc keeps it;
    - the preview: live, Enter, the field and timeline follow, Esc and a click elsewhere keep it,
      and the field takes over;
    - undo by bursts (a 1.3 s pause splits them; Esc ends one) in both places;
    - at most one save during quick typing, then one shortly after, and reloading right after
      typing (field or preview) keeps it;
    - Croatian letters typed, and composed through the input method (CDP `imeSetComposition`):
      nothing halfway, the whole letter at the end.
  - `phase4-words.test.ts` now stops typing with Esc, since Enter makes a new line.

## Fix: typing on the preview looked different from the result

### Root cause

The on-preview editor was a separate HTML `contenteditable` laid over the words. The video's
renderer stopped drawing them while it was open (`player.hideText`). So what you saw while typing
was the browser's own text layout, which only approximated the renderer:

- **No wrapping.** It had `width: max-content` (with `white-space: pre-wrap`), so it never wrapped
  at the renderer's width (84% of the frame): one long line, far outside the frame.
- **A different shadow.** `textCss` gives a CSS `text-shadow`, with different blur maths, cast
  per glyph. The renderer casts one canvas shadow of the letters and outline together.
- **Its own line metrics.** CSS `line-height` and the font's ascent/descent, against the
  renderer's rows centred on `lineHeight`. Its centring included trailing spaces. It had no
  pasteboard fading (the hidden words weren't drawn faded outside the frame either).
- **Spellcheck:** `spellcheck="true"`, hence the red dotted underline.
- **The clean-up at the end changed the layout.** Leaving trimmed trailing spaces and blank
  lines, and collapsed three blank lines into two.
- **Wrapping wasn't the same at every size.** The renderer decided line breaks with
  measurements at the size being drawn: the preview, each export resolution and the HTML box
  could break a line in different places.

### The fix: the renderer draws the words while they're typed

- **The words stay on the video** (no more `hideText`).
  - While typing, the player draws the typing box's text (`showTyping`). That includes a
    character halfway through being composed, which the project only gets once it's whole.
  - So font, lines, shadow, outline, box, band, colours, turn, scale and the faded parts outside
    the frame are the real thing.
- **An invisible field takes the typing** (`TextTyping.svelte`). It's a `<textarea>` with
  opacity 0, and `spellcheck`, `autocorrect`, `autocapitalize` and `autocomplete` off (so is the
  settings' Words field).
  - It handles keys, input methods, Left/Right, Shift + arrows, select all and the browser's undo
    while typing.
  - Live updates, undo bursts and composed characters work as in the previous change.
- **Caret and selection** are drawn over the box from the renderer's own rows (`layout.rows`,
  `rowOffsets`): each row's place in the words and each character's measured x.
  - Clicks, drags, double-clicks (word) and triple-clicks (line) are mapped through the same
    rows. The pointer is turned back by the words' rotation and scale.
  - Up, Down, Home and End move by the lines as drawn, not the field's own lines.
  - Double-clicks are counted on `mousedown`. `pointerdown` isn't cancelled, since that would
    cancel the `mousedown` too, and its `preventDefault` keeps the focus in the field. They also
    stop there, so they don't reach the preview's "double-click to crop".
- **The same outline** (2 px accent, 4 px out) while typing as when selected: the box doesn't move
  or resize.
- **One layout, character-exact** (`wrapRows`, `layoutText`):
  - Lines keep every character and its index (spaces aren't collapsed any more).
  - Spaces at a wrap hang at the end of their line, and each line is centred by its width
    without them.
  - Empty lines at the very end hang below and don't count for the size.
  - So typing a space or pressing Enter, and the tidy-up when typing stops, never move anything.
    The tidy-up is now only trailing whitespace, which hangs anyway.
  - Upper-case styles map letter by letter; a letter that would become two, like ß, stays.
- **Line breaks are decided at a fixed 100 px reference** and then used at every size. The
  preview, the typing caret, exports at any resolution and the home picture all break lines at
  the same places.
- **Width modes:** this project has no Auto/Fixed width modes; words wrap at 84% of the frame, as
  before. Typing follows exactly that. (Width modes were left for a separate change.)
- **Tests:**
  - Unit (`wrap.test.ts`): wrapping between words with hanging spaces, every character's index
    kept, line breaks and empty lines, long words, widths without hanging spaces.
  - E2E (`text-wysiwyg.test.ts`), screenshot comparisons of the stage with the caret, toolbar and
    toasts hidden, before/while typing and while typing/after (under 0.05% of pixels differ by
    more than 24), plus the box's size and place. Cases:
    - several wrapped lines with a shadow;
    - a 220 px italic Big title;
    - an outline;
    - a box turned 15° and scaled 1.3×;
    - the highlighter;
    - words partly outside the frame.
  - Also:
    - Enter plus spaces at the end then leaving: no jump;
    - spellcheck and friends off, and no `contenteditable`;
    - a click between the words puts the caret there and typing goes in there;
    - a double-click selects a word, highlighted over it; Shift + Left; drag-selecting the first
      word;
    - Up/Down/Home/End over two lines;
    - a click on 30°-turned words lands on the right letter.

## Fix: the floating toolbar left the video frame

**Cause.** The toolbar of a selected layer or words was anchored to the object's box.
- It sat a fixed 40 px above it, or 12 px below when there wasn't 92 px of room.
- Since the pasteboard change, it was only nudged so that it touched the stage
  (`StageView.pin`).
- So a large object (big words, a card covering the frame) pushed it above or below the frame,
  out over the timeline or top bar.
- It was never measured, so nothing kept it inside on the sides, and it didn't shrink in narrow
  frames.

**Placement now** (`toolbarPlacement.ts`, `SelectionToolbar.svelte`, used by layers and words):
- **Region:** the video frame, limited to the part in view when zoomed in, minus an 8 px margin.
- **Bounds:** the object's on-screen box (`turnedBounds`), from its keyframed position, scale and
  rotation, at the preview's size, which follows stage zoom.
- **Order:**
  1. above the object, 40 px clear (its turn handle);
  2. else below it, 12 px clear;
  3. else pinned at the top of the frame.
- **Across:** centred on the object's visible part, then clamped inside the frame.
- **Entirely outside the frame:** at the nearest edge (the object's centre clamped into the frame).
- **Measured:** the toolbar (actions and keyframe buttons together) is measured and placed in
  frame coordinates. It's recomputed whenever the object, the stage or the preview size changes:
  moving, resizing, turning, animating, pan and zoom, the divider, the window. Svelte applies it
  once per update.
- **Hidden while dragging** (as before), and back in its new place when the drag ends.
- **Narrow frames (9:16):** when the toolbar with names doesn't fit, it shows icons only
  (`FloatingToolbar compact`, named by `aria-label` and tooltips). If even that is too wide, its
  width is capped to the frame, so the keyframe buttons wrap onto a second row, still one unit.
  The names come back when there's room.
- **Popovers:** Style and Animate open upwards when the toolbar is in the lower half of the frame.
- **Removed:** `StageView.pin` and `cramped`.

**Tests:**
- Unit (`toolbarPlacement.test.ts`):
  - above, centred; below; pinned for objects as large as 2000 px words;
  - clamped near both sides;
  - the nearest edge for objects outside;
  - turned bounds.
- E2E (`toolbar-placement.test.ts`). Every case checks that the toolbar's box is inside the video
  frame in view:
  - above small words (centred, keyframe buttons inside it), below near the top, pinned at the
    top for 600 and 2000 px words;
  - partly outside each edge, near corners, turned 30°, -40° and 90°;
  - entirely outside left and below: at that edge;
  - a card covering the frame (pinned), a card near the bottom (above), scaled 3× and turned;
  - 9:16: icons only, still named and with tooltips; names back in 16:9;
  - zoomed to 100% and panned, a smaller window, and hidden while dragging, then back inside.
- `keyframes-editing.test.ts` now drags the motion path at a point clear of the toolbar, which
  now stays inside the frame and can cover part of the path.

## The floating toolbar at a fixed spot

The selected object's toolbar (Edit words or Crop, Style, Animate, Remove, and the keyframe
buttons) no longer follows the object. It replaces the above/below placement from the previous
fix.

- **Where:** centred at the bottom of the video frame, 16 px in (`toolbarSpot`,
  `TOOLBAR_MARGIN`).
  - The frame here is the part in view, so when zoomed in it's the frame cut to the stage.
  - It stays put while the object is moved, resized, turned or animated, and stays visible during
    drags (it used to hide).
- **Top instead:** when the object's on-screen box covers the bottom spot (`toolbarSide`), for
  example a caption at the bottom, it moves to the same spot at the top.
  - The box is turned and scaled, with keyframed values.
  - The side is only decided when nothing is being dragged (`frozen` while moving, resizing or
    turning), so it switches once, when the drag ends.
- **Narrow frames:** icons only (with tooltips) when the bar with names is wider than the frame.
  The keyframe buttons wrap onto a second row if even that's too wide.
- **One bar:** the actions and the keyframe buttons share one dark background (their own pills'
  backgrounds and shadows are turned off inside it), with a thin divider between them.
  - A 1 px border (white at 15%) and a soft two-layer shadow keep it clear on black, white and
    colourful pictures.
- **Popovers:** Style and Animate open upwards from the bottom spot, downwards from the top one.
- **Removed:** `placeToolbar` and the above/below/pinned/edge logic.
- **Tests:**
  - Unit: the spot (bottom and top, centred, within the part in view), the side (a caption at the
    bottom, turned and huge objects, objects off the frame), turned bounds.
  - E2E (`toolbar-placement.test.ts`):
    - bottom centre, 16 px in, keyframe buttons inside the bar;
    - unmoved while dragging words around and after turning and scaling;
    - a caption at the bottom puts it at the top; dragging onto the bottom spot keeps it there
      until the drag ends, then it's at the top; 2000 px words: top;
    - layers (bottom, then top for a card near the bottom), and zoomed to 100% inside the part in
      view;
    - 9:16: icons only, bottom centre; names back in 16:9;
    - the border (1 px, white 15%) and shadow; the edge is lighter than a black card and the bar
      much darker than a white card;
    - a busy four-colour video.
  - `layers-edit.test.ts` now checks the toolbar stays in place while dragging (it used to check
    that it hid).
  - `selection.test.ts` moves the first caption up: the toolbar's spot at the bottom covers a
    caption there, and the test clicks it.

## Fix: handles on words (width and scale)

Selected words had only the turn handle, so their width couldn't be changed. They now have the
same handles as layers: four corners, left and right sides, and the turn handle. There are no top
or bottom handles, because the height always fits the lines.

- **Width modes** (`TextItem.width`):
  - **Fixed:** a fraction of the frame's width, set with the side handles.
  - **Auto:** `'auto'`, one line, broken only by Enter.
  - **Unset:** wraps at 84% of the frame (`DEFAULT_TEXT_WIDTH`), as words always did, so existing
    projects look the same.
  - `wrapWidth` gives the line width for `wrapRows`. The sprite cache's key includes the mode.
- **The selection box** is the area (`layout.areaWidth`).
  - In Fixed width it's the width set, with the words centred in it (never narrower than the
    widest word).
  - Otherwise it's just around the words.
  - The drawing (Bold box, highlighter band) still hugs the words, so boxed captions don't
    stretch.
  - Typing's caret positions use the same area.
- **Side handles:**
  - Dragging one turns the words into Fixed width at the new width. They re-wrap live (once per
    frame).
  - The other side stays put: the centre moves by half the change, along the words' turned axis,
    with keyframes as usual.
  - With Alt the centre stays.
  - The width never goes below the widest word (`layout.minWidth`).
  - The label shows the box width in project pixels.
- **Corner handles** scale around the centre, keeping proportions (scale values, keyframeable).
  The label shows the percentage.
- **Undo and saving:** each drag is one gesture (`beginGesture`/`endGesture`): one undo step and
  one autosave. The toolbar stays put during it.
- **On screen:** the handles stay a constant size whatever the words' scale (counter-scaled), sit
  above the words, and work outside the frame too (the box is only cut off at the stage's edge).
- **Settings:** a Width row says how the words wrap ("Auto", "Fixed: N px" or "Wraps at N px"),
  with an "Auto width" button. There's no keyboard shortcut (none existed).
- **Tests:**
  - Unit: the width modes (`wrap.test.ts`).
  - E2E (`text-handles.test.ts`):
    - the six handles and the turn handle, no top or bottom, constant size at 2× scale and on the
      scaled corner;
    - right side narrower: several lines live, left side fixed, a "px" label, then one line again;
      one undo step per drag;
    - squeezed: limited by the widest word; Alt keeps the centre; Auto width brings back one line;
    - a corner scales evenly with a percentage label, leaving the width mode alone;
    - the left handle on the pasteboard (words partly outside) still works, and the right side
      stays.
  - `text-wysiwyg.test.ts` hides all the words' handles in its screenshots (it hid the turn
    handle already): they show when the words are selected, not while typing.

## Playback: the clock and looping

### The clock

- **Hundredths:** "0:02.45 of 0:05.00" (`formatHundredths`); "1:02:03.45" from an hour on.
  - Always rounded down (with a hair of float tolerance), so it reads steadily frame to frame
    and never runs ahead.
- **Frames on click:** clicking the clock switches to seconds and frames at the project's frame
  rate (`formatFrames`): "0:02:14", "1:02:03:14".
  - The choice is remembered on this device (`EditorStore.timeFormat`, localStorage
    `scenes.timeFormat`).
- **Steady width:** tabular digits (`font-variant-numeric: tabular-nums`, on the mono font), so
  the clock never changes width while it runs.
- **Where the format is used:**
  - Watch's clock;
  - the timeline's live labels: the start while moving, the length while trimming (they were
    "0:03.4" and "3.6 s");
  - a scene's trim badge.
  - Fade labels stay in seconds ("Fade in 1.5 s").
  - `formatTenths` is gone.

### Looping

- **The button:** right of Play, with the repeat icon, in accent when on. Ctrl/Cmd+L toggles it,
  in the editor and in Watch (which has the button too). It's listed in the shortcuts.
- **What repeats:** the range when one is set (I/O), otherwise the whole video
  (`EditorStore.loopRange`). Pressing Play outside the range starts at the range's start.
- **Saved per project** (`Project.loop`). It's not an undo step: undo and redo keep it as it is,
  like collapsed tracks.
- **Seamless sound** (`AudioEngine`):
  - Playback is a series of passes on the audio clock: the rest of the first, then the loop
    again and again, each starting exactly where the last one ends.
  - Each pass is scheduled `LOOKAHEAD` (2 s) ahead, its clips cut at the loop's end.
  - Each pass has its own gain with a 4 ms fade out and in at the join, so the jump back doesn't
    click.
  - `now()` wraps the clock into the loop, so the picture follows the sound exactly.
  - Finished passes are disconnected.
  - Live volume changes (`retune`) reach every scheduled pass.
- **Seamless picture** (`Player`):
  - Within 2 s of the loop's end, the scenes and layers needed at its start are prepared, like a
    transition's incoming scene.
  - A clip that's free has its own decoder sent there.
  - A clip still in use near the end (the same clip at both ends, e.g. a one-scene video) gets a
    second, standby decoder opened at the start. It takes over when the clock wraps
    (`wrapped()`), so the first frames after the join are ready, with no pause or flash.
  - Standby decoders are dropped on pause, seek, or a change of loop.
- **At the end:** when looping, playback doesn't stop there, and Watch doesn't show "Watch again".

### Tests

- **Unit:**
  - hundredths, frames (30, 24, 25, 120 fps), hours, rounding down, constant length;
  - the loop range and its survival through undo and redo.
- **E2E (`playback-loop.test.ts`):**
  - The clock:
    - "0:00.00 of 0:04.00", "0:02.45";
    - frames on click ("0:02:13"), kept after a reload;
    - every frame while playing well formed, with a width varying under half a pixel;
    - the timeline's drag label in both formats.
  - The whole video looping. Recorded every animation frame across the join: exactly one wrap
    (end to start), never paused, the time advancing every frame (no step over 0.12 s), the
    picture at most a few frames behind after the join, and sound buffers playing after it.
  - A range with Ctrl/Cmd+L: play from outside starts at the range; several wraps; always inside
    the range; off again.
  - Per project: kept by undo and a reload. Listed in the shortcuts. Watch loops with no "Watch
    again".
- **Updated for the new format:** the clock in `phase1-layout` and `phase2-import-playback`, and
  the live labels in `drag-smooth` and `sound-editing`.

## The range, always on the ruler

**One range, always there.** `project.range` null now means "the whole video, following its
length" (it used to mean "no range"). A `{start, end}` means an edge has been set.
- `EditorStore.range` is always a range: the one set, kept within the video, or 0 to the video's
  length.
- `rangeIsPart` says whether it's shorter than the video.
- Existing projects (no range) start with the whole video, and `.scenes` files carry it as
  before: nothing to migrate.

**Following and clamping.** While it's the whole video, it follows scenes being added, removed or
trimmed (nothing is stored). Once an edge is moved it stays put. If the video then gets shorter
than its end, every edit clamps it (`clampRange` in `edit()`): the end to the video's end, and
the start if it has to.

**On the ruler:**
- **The band:** a light band, barely tinted while it's the whole video.
- **Edges:** thin lines with small grips, darker on hover, in 14 px-wide hit areas. Dragging one
  sets it, snapping to the playhead, item and scene edges, keyframe and volume markers, and the
  video's ends (`rangeTargets`; Alt: no snapping), with its time in a live label. It's one undo
  step.
- **Moving it:** when the range is part of the video, dragging inside it moves the whole range
  (either edge snaps), clamped to the video.
  - A click inside still moves the playhead, as anywhere on the ruler.
  - On the whole-video range, the ruler is just for the playhead.
- **Resetting:** a double-click inside resets it to the whole video. The double-click is counted
  by hand, because cancelling the drag's `pointerdown` swallows the browser's `dblclick`.
  Alt/Option+X resets it too.
- **Keys:** I and O set the start and end at the playhead, keeping the other end.
- **Removed:** the toolbar's three range buttons (start, end, "⋯").
- **Right-click on the ruler:** Set start here, Set end here (at the time clicked), Set range to
  selection, Reset to whole video.
  - The clicked time is captured when the items are built: the menu closes, and forgets it,
    before an item runs.

**Saving and looping:**
- The Save dialog's "What" only appears when the range is part of the video. It's then chosen,
  and its label shows the start and end ("Range 0:02.00 – 0:05.00").
- Otherwise the whole video is saved.
- Looping repeats the range only when it's part of the video.

**Tests:**
- Unit: following, kept once set, clamped as scenes go, I/O keeping the other end, reset.
- E2E (`range-always.test.ts`):
  - a new project's range over the whole video, growing with a scene;
  - dragging an edge: live label, snapping to the cut, Alt not snapping;
  - kept as the video grows, clamped when it shrinks;
  - moving it by dragging inside, a click inside moving the playhead, double-click resetting it;
  - the right-click menu's start and end where clicked, and I and O;
  - the Save dialog and the loop for the whole video and for part of it.
- Updated: `export-range.test.ts` (Alt+X keeps a whole-video range on the ruler; I/O and the
  right-click menu instead of the buttons) and `export-dialog.test.ts` (no "What" for the whole
  video; Range chosen for part of it).

## Fix: the playhead's handle scrolled away with the tracks

**Cause.** The playhead was one element in the tracks' scrolling content (`.grid`): a
full-height line with its round handle 6 px from the content's top.
- The ruler row is `position: sticky` (`top: 0`), so it stays at the top of the scroller while
  the content scrolls under it.
- When the tracks were scrolled down, the content's top, and with it the handle, went out of view
  above the ruler, leaving only the line.
- At the top, the line (z-index 16) was also drawn across the ruler (z-index 15).

**Fix:**
- **Handle on the ruler.** The handle (and a short stem down to the ruler's edge) is now part of
  the ruler (`.playhead-head` inside `.ruler`), positioned by time like the ticks and the range.
  So it never scrolls vertically, and it sits on top of the range and its edges (z-index 4 in the
  ruler).
- **The line stays in the content,** across the tracks, above track backgrounds and items. The
  ruler row is now above it (z-index 17), so the line passes under the ruler and the handle is
  always on top.
- **Kept the same:** both use the same `map.x(time)`, so they're aligned at any horizontal scroll,
  zoom and during playback. Menus, popovers and the toolbar are outside the scroller, above all of
  it.
- **Dragging** the handle uses the same `onRulerDown` (pointer x on the ruler), so it works the
  same at any scroll position.
- **Checked the others:**
  - The range's edges and the range's live label were already in the ruler.
  - The snap line is a full-height line like the playhead's (it also passes under the ruler now).
  - The items' live labels move with their items on purpose.
- **Tests (`playhead-scroll.test.ts`, with ten extra tracks so the tracks scroll):**
  - scrolled to the bottom and back: the handle stays inside the ruler, doesn't move on screen,
    is the topmost element at its centre (also over the range's start edge), and its centre is
    within 1.5 px of the line's;
  - dragging it while scrolled down moves the playhead (not the range);
  - zoomed in and scrolled sideways, and every frame while playing, it stays aligned (wherever
    it isn't under the track headers).

## The loop button matches Play

- **Same size and shape:** the loop toggle is now the same 44 px round icon button as Play
  (`IconButton size="lg"`), on the same centre line, with the same 20 px icon and stroke width.
  Its gap to Play is the controls' own gap.
- **Quieter than Play when off:** the `soft` variant, a light surface with the ink icon.
- **On:** the accent with a white icon, slightly darker on hover.
- **Shared states:** hover, pressed (scale) and the focus ring are the icon buttons' own, the same
  as Play's.
- **Test (`playback-loop.test.ts`):**
  - equal width and height, fully round, centres within half a pixel, the same icon size and
    stroke, the gap equal to the controls' gap;
  - off is a non-accent surface with the ink icon, on is the accent with white;
  - screenshots of both.

## Keyframe markers: red diamonds in a strip

**One shape.** Every keyframe on the timeline is the same red diamond, whatever its easing. The
per-easing shapes (diamond, circle, square, triangle, ring) are gone. `data-easing` still names
the kind, for tests.
- **Look:** accent fill with a thin white edge, so it reads on dark cards, thumbnails and white
  words.
- **Selected:** 20% larger, with a 2 px white edge and a soft shadow.
- Volume points keep their own style.

**Placement:**
- **In a strip.** Markers sit in a 12 px strip along the item's bottom edge (`.kf-strip`).
  - Items with keyframes keep room for it (`.keyed`): layers get padding below their name, and
    words' row ends above the strip. So the diamonds never cover the name, icon or length.
  - Scene cards with Custom framing keep their strip at the bottom of the picture, above the
    name.
- **At the edges.** A keyframe at the item's very start or end is drawn just inside the item
  (`drawnX` clamps by half a diamond), so it's whole and clickable.
  - The markers sit above the trim handles (z-index 4 against 2) only where they are, in the
    strip, so the rest of the edge still trims.
- **Close together:** markers may overlap; a click picks the one nearest the pointer
  (`nearestAt`), not just the one drawn on top. Zooming in separates them.

**Easing:**
- The tooltip says the time and easing ("0:02.40 · Ease in and out"). The right-click menu
  checks the current easing (as before).
- On the selected item only, a faint accent line between each keyframe and the next draws its
  easing across the strip, from low to high (`easingPath`): straight for Linear, curved for the
  eases, a step for Hold, wavy past the end for Overshoot and Bounce.

**Tests:**
- Unit (`easingPath.test.ts`): straight, step, curved and overshooting lines.
- E2E (`keyframe-diamonds.test.ts`):
  - the same diamond for linear, eased and hold (accent fill, white edge, 45° turn, same size);
  - selected: 1.2× with a 2 px edge and a shadow;
  - no overlap with the name on words and on a card layer;
  - start and end keyframes inside the item, each clickable (going to 0 s and 4 s), and the
    edge above the strip still trims;
  - tooltips;
  - three easing lines only when selected, the linear one straight;
  - the ✓ in the menu;
  - two overlapping keyframes: clicking at the one underneath selects it.

## Stage zoom centred, and a gray pasteboard

**Zoom:**
- **Centred.** Cmd/Ctrl + scroll and pinch zoom around the stage's centre, not the pointer: the
  point at the centre stays put, so a centred frame stays centred.
- **Steps:** 10% per scroll step (`ZOOM_STEP` 1.1 per 100 px of wheel; a pinch's small deltas
  zoom smoothly), from 1/8 of Fit to 800%.
- **Snapping to Fit:** within 2% of Fit, it is Fit.

**Panning only beyond Fit** (`beyondFit`, `clampView`):
- At Fit and below, the frame is always centred: scroll, Shift + scroll and Space + drag don't
  move it, and Space plays and pauses straight away.
- Zoomed in beyond Fit, scroll, Shift + scroll (sideways) and Space + drag (or the middle button)
  move it. It's clamped to whatever overflows the stage plus a quarter of the stage, so it's
  never out of view.
- **Back at Fit or below:** zooming back there re-centres the frame with a short (0.22 s)
  animation (`recentering`).
- **Fit itself:** Fit (from the menu, or double-clicking the percentage) settles there the same
  way, the label reading "Fit" throughout.
- **The menu** keeps Fit, 50% and 100%.

**Scroll over Custom framing:**
- Cmd/Ctrl + scroll always zooms the stage. The reframe view now ignores it, so it reaches the
  stage.
- Plain scroll over the picture zooms the picture in its frame only when the scene is in Custom
  framing and selected (the reframe view is only there then). Otherwise it does nothing at Fit,
  or pans beyond Fit.
- **The settings' hint:** "Drag the picture to move it. Scroll over it to zoom." It keeps the
  media's word, so a video scene says "Drag the video…", as the media labels change asked.

**Pasteboard:**
- A light gray background (`--pasteboard: #f4f4f5`) on the stage around the frame.
- The frame keeps a 1 px border in the border colour (`--color-border`) and its soft shadow, so a
  white card or white video stands clear of it.
- Faded objects outside the frame are drawn on it as before.

**Tests (`stage-zoom.test.ts`; the old pan/zoom test in `pasteboard.test.ts` is replaced by it):**
- **Centred zoom:** 1.1× and 1.1³× with the pointer in opposite corners, centred each time;
  centred below Fit.
- **No panning at or below Fit:** scroll, Shift + scroll and Space + drag move nothing, and Space
  plays.
- **Beyond Fit:**
  - scroll, Shift + scroll and Space + drag pan by exactly the drag;
  - a huge scroll still leaves over 20% of the stage covered;
  - zooming out re-centres with the animation class.
- **The menu:** 50% and 100% are true sizes; at 100% the frame is cut off at the stage;
  double-click gives Fit and the original box.
- **Custom framing:** plain scroll zooms the picture only with the scene selected; Cmd/Ctrl +
  scroll zooms the stage instead; the hint.
- **Pasteboard:** the token and background, the border colour and shadow, and pixels of a white
  card against it (white inside, a darker border, the gray outside).
- `media-labels.test.ts` has the new hint text.

## Fix: the flaky storyboard auto-scroll test

`storyboard-layout.test.ts` › "dragging near the top or bottom edge scrolls…" failed now and then
in full runs only. The errors were `Cannot read properties of undefined (reading 'start')`, or
the card on the wrong track.

**Cause (in the test, not the app).** The test held a dragged card at the tracks' bottom edge
until Overlay 1 was just in view, then dropped it on the lane's centre. How far auto-scroll had
gone by then depends on timing:
- On a slow run it stopped as soon as Overlay 1 appeared, with the lane straddling the bottom
  edge (lane 858–920 px against tracks ending at 884 px).
- Its centre was then below the visible tracks, in the auto-scroll zone. So dropping there, or
  the later sideways drag along it, kept scrolling under the pointer.
- The card then landed on another track, or on Scenes, where it becomes a scene. That's why
  `overlays[0]` was undefined.
- The app behaves as intended (holding in the edge zone scrolls).

**Reproduced deterministically:** stopping the hold the moment Overlay 1 shows (an in-page
animation-frame loop) failed 3 out of 3 with the same error. CPU throttling alone (6× and 20×)
didn't, because the hold then still ran on long enough.

**Fix (the test):**
- After moving away from the edge, it waits until the tracks haven't scrolled for five frames
  (`scrollSettled`).
- Still dragging, it brings Overlay 1 to the middle of the tracks, and checks that it's at least
  60 px from both edges.
- Then it drops, and checks the card by its id (`layerOf`): its track, and its start after the
  sideways drag. A wrong drop now fails clearly ("not a layer any more") instead of with a
  TypeError.
- Everything it checked is still checked: the edge scrolls, Overlay 1 comes into view, the card
  follows the pointer, the drop onto a track after scrolling, a sideways drag while scrolled, and
  scrolling back up at the top edge.

**Confirmed:**
- the early-stop reproduction now passes 4 out of 4, also at 20× CPU throttling;
- the test passes 4 out of 4 on its own;
- two full suites: it passed in both. The second passed completely. The first had one unrelated
  failure: `phase5-sound` › "a recorded voiceover plays back…", a separate intermittent test,
  noted under Known issues.

## Drops that aren't allowed, and where messages appear

### Prevent instead of explain

- **Before the drop.** While dragging over somewhere an item can't go, the drop target is
  `{ kind: 'blocked', trackId, reason }` (`DropTarget` in `lanes.ts`):
  - the track dims (with faint stripes);
  - the cursor is "not allowed" everywhere (`html.drop-blocked`, since a drag's pointer is
    captured);
  - no drop marker shows;
  - a hint next to the pointer (`drop-hint`) says why, in plain words (`BLOCKED`).
- **On release** there, nothing changes: the item goes back where it was, with no message after
  (the hint already said why).
- **Covered:**
  - the only scene up onto an overlay track or a gap: "Your video needs at least one scene, so
    this stays a scene.";
  - a scene down onto an audio track;
  - a sound onto a picture track or the Scenes track;
  - a layer or words onto an audio track;
  - words onto the Scenes track;
  - anything onto a locked track;
  - from outside: "Your media", cards or files over an audio or locked track, and sound files
    over any track (`dragIsOnlySound`). These are refused with `dropEffect: 'none'` and the same
    hint, and a drop there does nothing.
- **Where it's decided:** `targetAt` returns the blocked target, `showTarget` shows it, and
  `TrackLane.onend` and `Storyboard.onCardDragEnd` cancel the move on release. `sceneToOverlay`
  still refuses the only scene (now with a bubble) for any other path that might call it.

### One message helper (`state/messages.svelte.ts`, replacing `toasts.svelte.ts`)

`messages.show(text, { tone, item, ms })` picks the place:
- **About an item** (`item`): a bubble next to it in the storyboard (`ItemBubble.svelte`), with a
  small pointer toward it.
  - Above the item if there's room under the ruler, so never over the playhead's handle;
    otherwise below. Always inside the storyboard.
  - Placed every frame while shown. It goes when the item scrolls out of view, after 4 s, on any
    click (so also when a drag starts), on Esc, or with its × button.
  - One at a time: a new one replaces it, and an old one's timer can't close a newer one.
  - Used for: the 4-video limit when moving or resizing a layer (or an edit that would go over
    it); adding a keyframe or splitting with the playhead outside the item; splitting a sound
    there; the only scene.
- **Anything else:** a toast at the bottom centre of the window, just above the storyboard's
  lower edge, never over the video. Information goes after 5 s; errors stay until closed.

### Wording

Every message was reviewed and kept to one short, plain sentence, saying what to do instead
where that helps. For example:
- "Only 4 videos can play over the scenes at once, so this one can’t go there."
- "Move the playhead onto it to split it."
- "One clip is missing from this device, so it was left out."
- "Saved “frame.png”."
- "Added 3 scenes."
- "Drop a .scenes project file here to open it, or start a New video to add photos and videos."

The import, microphone, project-file and export errors were already plain and are kept.

### Tests

- **Unit (`messages.test.ts`):** bubbles (one at a time, 4 s, a newer one not closed by an
  older timer); toasts (info 5 s, errors staying until dismissed).
- **E2E (`drop-feedback.test.ts`):**
  - **The only scene over Overlay 1:** the hint, the dimmed track, the not-allowed cursor, no
    marker; on release, still one scene and no layer, and no message.
  - **The other cases:** a song onto Overlay 1, a card onto Audio 1 and onto a locked track,
    and words onto Scenes. Each shows its hint, and on release everything is exactly where it
    was.
  - **From outside:** "Your media" over an audio track and a sound file over Overlay 1 are
    refused, and nothing is added.
  - **The bubble:**
    - next to the layer and pointing at it, inside the storyboard, under the ruler, not on the
      video;
    - replaced by a new one, gone after 4 s, on a click, on Esc and with ×;
    - below an item on the top track;
    - gone when it's scrolled out of view.
  - **Toasts:** a general message is centred at the bottom, below the video, and goes by
    itself; an unusable file's error stays until dismissed.
- `layers-render` and `tracks-render` have the new 4-video wording.

**Also fixed on the way:** going back to Fit used two 240 ms timers, one ending the re-centring
move and one switching the view to Fit. When the first fired first, the zoom label showed "47%"
for a moment (seen once in a full run of `stage-zoom.test.ts`). One timer now does both, in
order.

## No more "pinned to the end of the video"

- **Removed:** items that ended exactly at the video's end used to stretch or shrink with it
  whenever the scenes changed (in `reconcileTimeline`), and showed an "end" marker.
  - Both are gone: items keep the start and length they were given.
  - `reconcileTimeline` only moves items with the scenes when ripple is on; its `maxDuration`
    argument, `MIN_ANCHORED` and `EditorStore.endsWithVideo` are removed.
- **Existing projects:** being "pinned" was never stored, only worked out from the end time. So
  items that were pinned simply keep their current position and length.
- **Extend to end of video:** a new right-click menu on items on overlay and audio tracks
  (layers, words, sounds) has "Extend to end of video" (`EditorStore.extendToEnd`).
  - It stretches the item once to end at the video's current end, as far as its clip allows: a
    video layer's clip, a sound's file.
  - It's one undo step ("Extend to end").
  - If the item already starts at the end, a bubble says so.
- **Snapping** to the video's end when trimming or moving is unchanged.
- **Tests:**
  - Unit: an item ending at the end keeps its length when scenes are added or removed (ripple on
    or off).
  - `tracks-ripple.test.ts`: the logo snapped to the end has no marker and keeps its length when
    scenes are added. Extend to end then stretches it, it's at the end in the preview, and
    deleting a scene doesn't shrink it.
  - `extend-to-end.test.ts`:
    - words go to 24 s;
    - a 3 s video layer only to its clip's end;
    - a 12 s song only to its own end;
    - undo is one step each;
    - adding a scene afterwards doesn't move them.

## Fix: the video's length counts overlays

- **The bug:** the video's length only counted the Scenes track. So a card going on after the
  last scene (a 3 s scene, a card to 5 s) was cut off at 3 s in the player, the time display,
  the range and the saved file.
- **One function for the length:** `videoLength(project)` in `model/timeline.ts` is the latest
  end of anything on the Scenes track or on an overlay track (layers and words).
  - Hidden tracks count too, so hiding a track doesn't change the length.
  - Sound doesn't make the video longer.
  - Used everywhere: `EditorStore.duration` (time display, top bar, ruler and its end, range,
    loop, playback end, Watch mode), the player, the export (renderer and all of `exporter.ts`),
    project thumbnails, the home page, and the audio mix.
- **After the last scene:** `compose()` returns no scene there (the very end of the last scene
  still shows it). Overlays are drawn over the background (black) in the preview, Watch mode and
  the saved file. The player's "frame ready" check no longer waits for a scene that isn't there.
- **Sound past the end:**
  - In playback and the saved file it's cut at the end with a short fade-out (`END_FADE`, 0.5 s,
    or its own fade-out if that's longer).
  - In the storyboard it's drawn at its full length, dimmed past the end. Trimming its end works
    from its real end.
- **Words and layers may run past the last scene:** the words' timing no longer stops at the
  video's end (`setTextTiming`, `resizeTextTiming`; adding words still fits them in). The
  inspectors' Start and Length fields allow it too.
- **Live while dragging:** while a layer or words are moved or trimmed, `EditorStore.draftTiming`
  holds where they'd go, so the length (ruler, striped region, time display) follows the drag.
  The Fit scale uses the saved length, so the storyboard doesn't rescale under the pointer.
- **Storyboard:** from the last scene's end to the video's end, the Scenes track shows an empty,
  lightly striped region. The "+ Scene" card stays right after the last scene, and Fit zoom
  includes the region.
- **Tests:**
  - Unit: `videoLength`; `compose` after the last scene; the end fade-out for sounds.
  - `video-length.test.ts`:
    - a 3 s scene plus a card to 5 s makes a 5 s video: time display, range 0–5, Watch mode,
      the striped region, card over black at 4 s, and playback stopping at 5 s;
    - trimming and moving the card change the length live, during the drag;
    - a longer song keeps the video at 5 s and is dimmed past 5 s;
    - the saved file is 5 s, with the card over black after 3 s and the song fading out at the
      end.

## Renaming in place: one quiet outline

- **Before:** renaming the video's title showed two outlines. The field's dark border had the
  app's focus ring on top, because text fields always count as keyboard-focused. The text also
  moved by a pixel, since the field had a border and the shown title didn't.
- **Now:** one shared style, `.inline-edit` in `styles/global.css`:
  - a 1px `--color-border` border on `--color-surface`, with the inputs' 8px corners;
  - no outline and no focus ring.
  - Used by the video's title (top bar), track names (double-click), and video names on the
    home page. Scene names can't be renamed in place, so there's nothing to change there.
- **Nothing moves:** the shown title has a transparent 1px border, so it has the same box as the
  field. Track and video names line up with their padding and border. The title's font, size and
  position are the same in both states.
- **Keyboard focus** on the shown title (not editing) is still the app's single `--focus-ring`.
- **Selected text** everywhere uses a light accent tint (`--color-text-selection`, via
  `::selection`) instead of the browser's blue.
- **Tests:** `inline-edit.test.ts` covers the title, a track name and a video name on the home
  page. It checks the one outline, no ring while editing, the text not moving, the single ring
  for keyboard focus, and the selection tint. It waits for fonts before measuring, because the
  names around the title change width until the fonts load.

## Renaming scenes and items

- **What:** scenes and every item on overlay and audio tracks (videos, photos, cards, words,
  music, voiceovers) can be renamed, in this project only.
- **How:**
  - double-click the name on the storyboard;
  - click the title in the settings ("Scene 1", "Layer", "Words", "Music"…);
  - or right-click › Rename, on scenes (a new menu) and on items (above "Extend to end of
    video").
  - Enter or clicking elsewhere saves; Esc cancels. The field uses the same quiet outline as
    renaming the video (`.inline-edit`, see `NameEditor.svelte`).
- **Stored as `label`** (optional) on scenes, overlays, words and sounds. The default stays in
  `name` (the file's name, "Card") or is the words. So:
  - `displayName()` shows the label or else the default; clearing a name, or typing the
    default, removes the label (`labelFor()`, in `model/items.ts`);
  - words keep showing their words until renamed, and follow edits to them;
  - the file and its name in Your media never change;
  - a scene that becomes a layer (or back) keeps its name.
- **Scenes** show as "1 · Intro": the number stays automatic and follows reordering. Their
  settings title is "Scene 1 · Intro", with the file's name in the line under it.
- **Settings titles** (`NameTitle.svelte`): the heading's text is unchanged (with " · Name" once
  renamed). The click target is a "Rename …" button behind it, so headings and existing button
  names don't change.
- **Storyboard:** the field opens over the name, outside the item's button. A double-click is
  heard on the item and checked against the name's box, because pressing an item captures the
  pointer for dragging. `EditorStore.renamingId` says which one is open (set by double-click
  and the menus).
- **Undo, autosave, files:** `EditorStore.rename()` is one undo step ("Rename"). Labels are
  part of the project, so they're autosaved and in `.scenes` files.
- **Also:** removed unused imports left by the video-length fix, and one unused variable in
  `tracks-moving.test.ts`, so lint is clean.
- **Tests:**
  - Unit (`names.test.ts`): default names, clearing restores the default, labels survive
    opening a project.
  - `rename-items.test.ts`:
    - a scene renamed from the storyboard and the settings; its number follows a reorder;
      Esc cancels; clearing restores the file's name; undo; Your media keeps "red.mp4"; saved
      across a reload;
    - a layer renamed by double-click (clicking elsewhere saves), from the settings and from
      right-click; words show their words until renamed and again once cleared; a song
      renamed from its settings keeps its file's name.

## Renaming in the settings heading: the whole heading

- **Before:** clicking the heading kept a fixed "Scene 2 ·" in front of a wide gray field. The
  selected text was a strong pink.
- **Now** (`NameTitle.svelte`, prop `plain`):
  - Clicking the heading turns the whole heading into the field, with its text selected, so
    typing replaces it.
  - Renamed, the heading is just the name ("Intro"). Which one it is moves to the line
    underneath:
    - scenes: "Scene 2 · Green · starts at 0:04" (cards: "Scene 2 · Card · starts at…");
    - layers: "Layer · Video · beach · starts at 0:01 · on Overlay 1" (the file's name is left
      out when it's the same as the type, like "Card");
    - words: "Words · starts at…" above the typing hint;
    - sounds: "Music · song · starts at… · plays for…".
  - Not renamed, the heading is "Scene 2" / "Layer" / "Words" / "Music" as before. Typing that
    back, or clearing the field, removes the name.
  - On the storyboard, scenes still show "2 · Intro".
- **The field** uses the same `.inline-edit` look as renaming the video. It has the heading's
  font, size and place (the shown heading has a transparent border and the same padding), and
  it's as wide as its text: `NameEditor`'s `fit` mode puts an invisible copy of the text in the
  same grid cell, with a little room for the caret and italic letters. The heading's hover
  area is sized to the text, instead of the whole row.
- **Selected text** (everywhere) is a lighter accent tint: `--color-text-selection` is now 13%
  accent (was 22%).
- **Tests** (`rename-items.test.ts`):
  - a new test: click "Scene 2", the whole heading is the field with it all selected; same
    font and text position; as wide as its text; the same border, background and selection
    tint as the video-title field. Then "Intro" makes the heading "Intro", with "Scene 2 · Green"
    underneath and "2 · Intro" on the storyboard. Typing "Scene 2" back removes the name.
  - the earlier tests now expect the name as the heading and the position in the line
    underneath.

## One right-click menu for everything on the storyboard, with Delete

- **One menu** (`editor/itemMenu.ts`) for scenes and every item on overlay and audio tracks.
  It shows only what applies, in this order, each with its shortcut if it has one:
  - Rename;
  - Copy (⌘C) and Cut (⌘X), for items on tracks (scenes aren't copied that way);
  - Paste (⌘V), once something is copied;
  - Duplicate;
  - Split here (S);
  - Extend to end of video (items on tracks);
  - then a divider and **Delete** (⌫, or Delete on Windows and Linux), in red (a new
    `--color-danger` token, kept apart from the accent).
- **Several selected items:** if the right-clicked item is one of them, the menu applies to all
  ("Duplicate 3 items", "Delete 3 items"). The options for one item only (Rename, Split here,
  Extend) aren't shown. Right-clicking anything else selects just that first.
- **Delete** (`EditorStore.deleteItems`): scenes and items go together, in one undo step.
  - Scenes close their gap, as the Scenes track always does, and the other tracks follow the
    Ripple setting. Items on other tracks leave a gap.
  - `deletable()` decides what can go. The last scene stays: Delete is disabled with "Your
    video needs at least one scene." The Delete key now keeps it too, and says the same in a
    bubble.
  - Items on locked tracks can't be selected, so their menu only has Delete, disabled, with
    "This track is locked."
- **Duplicate** for items (`duplicateItems`): copies go right after the originals, on their
  own track (or a new track above where they'd overlap). It shares `placeCopies()` with
  Paste. Scenes use `duplicateScene` as before.
- **Split here** moves the playhead to where you right-clicked, then splits there (as S does).
- **The menu** (`ui/Menu.svelte`):
  - at a right-click, it opens with its corner at the pointer, flipped up or left when there
    isn't room, and always inside the window;
  - disabled options can show a hint under them (`MenuItem.hint`); `danger` makes an option
    red;
  - Esc, clicking elsewhere or choosing an option closes it.
  - "Rename" no longer has an icon, so every option lines up.
- **Tests** (`context-menu.test.ts`):
  - the options for a scene, a layer, words (with Paste after a Copy) and a song; Delete last,
    red, with its shortcut and a divider; the menu at the pointer and inside the window near
    the bottom-right corner; Esc, clicking elsewhere and choosing close it;
  - deleting a scene (the gap closes), a layer, words and a song from the menu; one undo each
    brings everything back, and the words didn't move;
  - three selected items: the options for several, "Delete 3 items", one undo; right-clicking
    an unselected item selects just it;
  - the last scene and a locked track: Delete disabled with why; the Delete key keeps the last
    scene;
  - Duplicate (right after), Split here (where right-clicked), duplicating a scene.

## Your media: select, right-click, rename, delete, Remove unused

- **Sounds are in Your media now:** songs and voiceovers join `project.library` when added.
  When a project opens, everything it uses is added to Your media, so older projects get their
  sounds too. Audio tiles show a music note.
- **Selecting:** a click selects a file (accent outline); Shift- or Cmd/Ctrl-click adds or
  removes more. **Double-click** adds it: a picture as a scene at the end, a sound on an audio
  track. Before, a single click added it. Dragging is unchanged (pictures only). Each tile's
  name is shown under it.
- **Right-click** (the shared `Menu`, at the pointer):
  - Add as scene (pictures; "Add 2 as scenes" for several);
  - Add as layer at playhead (one picture);
  - Add to audio track (a sound, or a video with sound);
  - Show in timeline: selects every scene and item using it, and shows the first. Disabled
    with "Not used" when nothing uses it;
  - Rename (one file);
  - a divider and Delete, in red, with ⌫ or Delete. The Delete key on a selected tile deletes
    the file, not what's selected on the storyboard.
- **Show in timeline** can select scenes along with items: `extraSelected` may now hold
  scenes, and scene cards show as selected when they're in `selectedIds`. Deleting several
  goes through `deleteItems`, so scenes and items go together, and never the last scene.
- **Rename** in Your media is for this project only: `project.mediaNames`, an undo step. The
  stored file keeps its name; clearing the name brings the file's back. New scenes and layers
  made from it take the given name.
- **Delete** (`deleteMediaFiles`):
  - an unused file goes right away (one undo step);
  - a used one asks first: "This is used in 2 places in your video. Deleting it removes them
    too.", with Show in timeline, Cancel and Delete. Its scenes (the gap closes) and items go
    with it, in one undo step;
  - when that would remove every scene, it's blocked: "Your video needs at least one scene."
- **Freeing storage:** a deleted file's stored copy goes once nothing needs it: this project,
  its undo history in this session (`History.states()`), or any other saved project. Undo could
  bring it back while editing, so it's freed when you leave the project (`EditorStore.close`).
- **Remove unused** (at the top of Your media, only when something's unused) asks first, saying
  how many files and how much storage it frees. It's for good, so it's not an undo step:
  - the files go from Your media, and from Your media in every undo step
    (`History.map()`);
  - each file nothing needs any more is deleted from storage. A file an earlier step still
    uses (a deleted scene undo could bring back) is kept for now.
- **Tests:**
  - Unit: `History.states()` and `map()`.
  - `media-library.test.ts`:
    - the menu for a video and a song; add as scene, as layer at the playhead, to an audio
      track; Show in timeline selects all three uses, the first in view; Shift and Cmd/Ctrl
      selection with the menu for several; rename in Your media only (the file and scenes
      keep their names), clearing it, undo;
    - deleting an unused file (undo; the Delete key), a used one (the question, Show in
      timeline, Cancel, Delete removing its scene, one undo for both), and blocked when it
      would remove every scene;
    - Remove unused (the question with the storage it frees; the files gone from storage);
      a used file deleted while editing stays stored until you leave the project.
  - Updated for the new tile behaviour (double-click to add; tiles named after the file):
    `stage-media`, `crop`, `layers-add`, `tracks-moving`, `rename-items`.

## The Casa Rossa demo

A 23-second TV-style ad for a fictional tomato sauce, with a voiceover, shipped with the app as a
demo. **The editor isn't changed for it.** Where the editor can't do exactly what the ad asks, the
closest thing is used (listed below). One earlier fix to the editor is kept (agreed): transparent
PNG layers.

### How it's made
- **`node scripts/build-demo.ts`** (Node 23 runs TypeScript directly). Add `--no-export` to skip
  the MP4 and stills. Running it again regenerates everything.
- **It drives the real app** in Chrome (a Vite dev server on port 4319, with Playwright):
  - imports `demo-assets/` the way a person would: the clips, photo and tomato through "Choose
    photos & videos", and the music and the six voice lines through the Sound panel's Music
    button;
  - builds every scene, layer, word, keyframe, transition and volume point with the editor's
    own functions (`window.__scenes`);
  - saves with the app's own "Save to file", as a download.
- **Outputs:**
  - `static/demo/casa-rossa.scenes` (about 24 MB, with all twelve files used; the full
    voiceover isn't);
  - `static/demo/casa-rossa.jpg`, the Demo card's picture (the frame at 14.45 s: the tomatoes
    and the badge in, before "TOMATOES.");
  - `demo-review/` (git-ignored): the exported MP4 and the stills to review.
- **Home screen:** a "Demo" card ("Casa Rossa · 23 sec ad", with its picture) after New video.
  Opening it fetches the file and stores it as a new project every time (`projectOpener.openCopy`
  → `storeOpenedFile` in `copy` mode, titled "Casa Rossa ad", with the demo picture as its
  thumbnail). The file in `static/` is never changed or linked.

### Where the editor does it differently (the closest alternative used)
- **Transition lengths:** `setTransition` always uses each kind's usual length (slide 0.6,
  crossfade 0.8, zoom 0.7 s). The ad's 0.4 and 0.5 s are set on the scenes' `transition.duration`
  with the editor's own `edit()`; the renderer uses that length.
- **Voiceover lines:** files can only be added as sounds through the Music button (voiceovers
  come from recording). So each line is added there, placed at its time, set to 100% with no
  fades, and its kind set to `voice` with `edit()`.
- **The music's dip:** made with volume points, as asked: 100% at 0.0, 35% at 0.2 and 22.0, 0% at
  23.0, all Linear. The music file itself is silent for its first ~0.15 s, so the 100% start isn't
  heard.
- **Text alignment:** there's none, so left-aligned lines are centred half their measured width
  in from x = 120. Widths are measured in the page with the same font files the editor draws
  with.
- **Letter spacing:** there's no setting, so "SINCE 1962" and "Tomato sauce · Available now"
  have thin spaces (U+2009) between their letters.
- **Geist medium:** only 400, 600 and 700 are built in, so "Taste the sun." is 600.
- **Hollow outlined text:** a fill's opacity also fades the outline, so the letters can't be
  see-through. "100%" is filled with the card's ink and outlined in white, which reads as
  hollow, then fades to 25%.
- **Style fonts:** the Outlined style is Geist and Big title is Instrument Serif. Both are
  switched to Anton.
- **Entrances with Overshoot:** the built-in Pop has its own easing. "10" and "MINUTES" are
  animated with keyframes instead: 30% → 100% and fading in over 0.35 s, Overshoot. The same
  goes for the opening words, "Casa Rossa", the badge and "NEW". "Ready in" and "Sun-ripened
  tomatoes" use the built-in Pop.
- **Fade and slide-up last 0.5 s** (built in), so "SINCE 1962" fades in over 3.95–4.45, not 4.25.
  Words with an entrance also fade out over their last 0.25 s (built in).
- **Scale 0%:** scale goes down to 1% (`MIN_SCALE`), so the bar, badge and tomatoes start at 1%.
- **Scene 3 is the tomato field** (`demo_video3`, from 1.0 s, muted), no longer the terrace photo.
  The picture-in-picture is gone with it.
- **Split screen, "filled and cropped":** layers always fill their box (cover), so the 960 ×
  1080 box crops it with no crop setting needed.
- **Muted clips:** scene clips have volume 0. Video layers have their sound off, which is the
  default.
- **Transparent PNG layers** were drawn on a solid (black) rectangle (the overlay shader ignored
  the picture's alpha). This fix from the first version of the demo is kept, as agreed. A layer's
  drop shadow is still the box's shape, not the picture's. (The first version's other editor
  changes, an optional length for `setTransition` and a shorter Your media hint, were undone.)

### The tomato field (scene 3) and the terrace outro
- **Scene 3** (8.9–13.4) is `demo_video3`, the farmer's hands cutting tomatoes off the vine,
  from 1.0 s in the clip, muted. It uses Custom framing that zooms from 100% to 110%, Ease in
  and out. A video's framing keyframes are in its own seconds, so they're at 1.0 and 5.5 s in
  the clip. The picture-in-picture (the slicing clip) and its track are removed.
- **Its words moved up:** at y = 760 and 870 (their old places), "Sun-ripened tomatoes" sat over
  the tomatoes and the farmer's fingers in every checked frame. The hands, knife and tomatoes
  stay below about 45% of the height and right of about 28% of the width. So both lines are
  higher on the left, over the leaves and soft background, with the same left edge (120), sizes
  and timing:
  - "Sun-ripened tomatoes" at y = 290;
  - "Hand-cut. Every time." at y = 395.
- **The clip near its end:** only 1.0–5.5 s of it is used, so its end (a basket appears from
  about 8 s) never shows. The last frames before the cut (13.35, 13.39) are clean.
- **The outro** (19.8–23.0) is the terrace photo (`demo_image1`) in place of the white card.
  It uses Custom framing that zooms from 105% to 112%, Ease out.
- **Shade:** a black card over the whole frame at 35%, on its own "Shade" track (just above the
  scenes, under the words). It fades in across the whole crossfade into the outro (19.55–20.05),
  as the split screen fades out.
- **Outro words for the photo:** "Casa Rossa" white with a soft shadow, "Taste the sun." white,
  and "Tomato sauce · Available now" white at 80%. Fonts, sizes, places and timing are kept.
- **Checked:** stills at 9.5, 11.5, 13.0, 19.5 and 21.5 s, plus the crossfade into the outro
  (19.5–20.1). Everything reads, and the split screen now fades out with that crossfade
  (see below).

### A longer split screen, and everything leaving with its transition
- **The split screen is 3 s** (16.8–19.8, was 2 s). The hands clip now starts at 3.5 s, so its
  6 s at 2× (3.5–9.5) stay inside the 10 s clip. The kitchen half (from 3.0 s) runs 3.25 s.
  "Ready in", "10" and "MINUTES", the kitchen half and the divider keep their entrance times.
- **Everything after it moved by +1.0 s:**
  - the outro is 19.8–23.0;
  - the sixth voice line is at 19.85;
  - "Casa Rossa" is at 19.93 (its keyframes 19.93–20.35), "Taste the sun." at 21.45, and the
    tagline at 21.9;
  - the project is 23.0 s, with the music trimmed to 23.0, at 35% until 22.0 and out by 23.0;
  - the Demo card says "Casa Rossa · 23 sec ad".
- **The uneven fade into the outro:** a transition runs half before and half after the scene
  change (cut − d/2 to cut + d/2), and only the Scenes track takes part. The layers and words on
  the split screen ended at the change and vanished halfway through the crossfade, while the
  picture under them was still fading.
- **The fix, for every transition:** whatever ends at a scene change now runs on to the
  transition's end and does what the outgoing scene does, on the same curve (the renderer's
  smoothstep), sampled every eighth of the transition:
  - **crossfade** (2 → 3 and 5 → 6): it fades out with the picture. That's "SINCE 1962" and the
    garden line; and the kitchen half, the divider, "Ready in", "10" and "MINUTES";
  - **slide** (1 → 2): "Italian." and its bar move off to the left with the red card;
  - **zoom** (4 → 5): "100%", the tomatoes, "TOMATOES.", "Nothing else.", the badge and "NEW"
    grow and fade with the dark card;
  - 3 → 4 is a cut, so there's nothing to do there.
  The words' built-in 0.25 s fade-out is off for these (`exitFade: false`, set with the
  editor's `edit()`: there's no setter), so only this one applies. The outro's shade fades in
  across the same crossfade (19.55–20.05).
- **Checked:** frames every 0.1 s across each transition, and stills at 18.5, 19.5 and 21.0 s.
  The whole frame changes together, with no half-faded frames and no text left over.

### The split screen ("Speed and looks", 16.8–19.8)
- **Left half:** the kitchen clip (from 3.0 s) as a layer filling exactly the left half: 960 ×
  1080 at (480, 540), no rounded corners, no border, sound off. It slides in from x = −480 at
  16.8 to x = 480 at 17.15 (Ease out), on "Split screen".
- **Right half:** the scene itself (the hands, 2×, Golden), in Custom framing at 150% zoom,
  moved right by a quarter of the frame (x = 0.25). That puts the clip's middle, where the
  knife and hands are throughout, at x = 1440. At 150% the moved picture still covers the
  whole frame, so no bars or background show anywhere, even before the left half has slid in.
- **Divider:** a white card, 6 × 1080 at (960, 540), on its own "Divider" track above the left
  half. Width and height are unlinked; its height grows from 1% (the smallest scale) to 100%
  over 17.0–17.3 (Ease out).
- **Words:** "Ready in", "10" and "MINUTES" are centred on x = 1440, as before (no size
  changes needed). The "10 MINUTES" group spans about x = 1138–1742: clear of the divider at
  960, and about 120 px from the right edge.
- **The 4 → 5 zoom transition** was checked frame by frame (16.60–16.92). The hands come in
  zoomed, but always covering the whole frame, and no edges or background show around either
  half. So the zoom transition stays.

### Text and voice timing
- **How it was checked:** each voice line's speech was located with ffmpeg's silence detection
  (at −35, −42 and −50 dB) and a 10–20 ms loudness envelope. The voiceover files have no
  transcript, and no speech-to-text model was on this machine.
- **On a speech onset:** "Simple." (1.442), "Italian." (2.614), "From our garden" (6.30),
  "Hand-cut" (11.03), "Nothing else." (15.76) and "Taste the sun." (20.46) all start within
  0.05 s of the voice. "Fresh." (0.28) is right as the line starts (its soft "F" begins at
  ~0.2–0.28).
- **"TOMATOES." (14.5), "10" (17.85) and "MINUTES" (18.15)** fall inside continuous speech, so
  they can't be confirmed word by word. "TOMATOES." and "10" sit exactly where a "t" sound
  starts (a brief silence just before it), and every checkable time in the spec matched the
  voice. So the spec's times are kept: no text was moved.
- **The voice over the music:** the music bed alone (in the gaps between lines) is about −25 to
  −27 dB, and speech with the music under it about −17 to −21 dB. That puts the voice about
  5–6 dB above the music: clearly audible, though a deeper dip (for example 25%) would make it
  stand out more.

### Review (stills at 0.8, 2.0, 3.2, 5.0, 7.0, 9.5, 10.0, 11.5, 12.0, 13.0, 15.0, 17.0, 17.5, 18.5, 19.5, 21.0, 22.5 s, from the exported MP4)
- **"SINCE 1962"** would sit on the kitchen's bright window at the top left, where it's hard to
  read (seen in the first version). It's at the top right instead, over the dark cabinets
  (right edge at x = 1800, y = 110), with a soft shadow.
- **"10" and "MINUTES"** at (1300, 590) and (1560, 610) overlap. They're one group centred at
  x = 1440 (the right half's middle) with a 36 px gap, and "MINUTES" is at y = 625 so its
  bottom lines up with "10"'s.
- **The split screen:**
  - 17.0: the kitchen is sliding in, the divider is just starting, and the hands fill the rest
    with no edges;
  - 17.5: a true split, with the white line in the middle and "Ready in" centred on the right;
  - 18.5: "10 MINUTES" is inside the right half.
- Everything else reads cleanly: nothing overlaps awkwardly or sits too close to the edges. Each
  text shows at its moment: "Ready in" is popping in at 17.0, and "Taste the sun." isn't in yet
  at 20.0 (it's at 20.45).
- **Playback in the editor:** 23.45 s of wall time for the 23 s, about 60 frames a second, and
  the picture never paused for more than 23 ms (from the demo test).
- **Export:** 1920 × 1080, 24 fps, H.264 + AAC. The video stream is 23.000 s (552 frames); the
  audio is 23.08 s, from AAC's end padding. The music is down to about −39 dB in the last 0.2 s.
  The frames match the preview.

### Tests
- **Unit:** `scripts/demo.test.ts` checks the built file against the spec:
  - the twelve files;
  - format, scene changes at 3.8, 8.9, 13.4, 16.8, 19.8 and 23.0, and transitions with their
    lengths;
  - the clips: muted, framed and keyframed; the hands clip from 3.5 s at 2× in Golden, framed
    into the right half;
  - the split screen: the left half's box, its slide in, and the divider (its size,
    unlinked height keyframes, and track above the left half);
  - whatever ends at a scene change leaves through the transition: it ends at the transition's
    end, gone (faded, or off to the left for the slide), with no built-in fade-out of its own;
  - the tomato field (from 1.0 s, muted, 100% → 110%) with its words high on the left, and no
    picture-in-picture; the terrace outro (105% → 112%), its 35% shade under the words, and
    the white outro words;
  - the named tracks, layers and fonts;
  - the music's volume points, and the six voice lines at their times on "Voiceover".
  `vite.config.ts` includes `scripts/**` tests.
- **`e2e/demo.test.ts`:**
  - the Demo card and its picture; opening it gives an editable copy with everything in it
    (the sounds and their times included), and the tomatoes are drawn transparent;
  - each open is a new copy, and the demo is unchanged;
  - it plays through in real time without stalls and stops at 23 s.

## Fix: Your media scrolled sideways

- **The cause:** each tile's name (and the field for renaming it) had negative side margins
  (−5 px), so its text lined up with the field's. The last name in each row stuck out 3 px past
  the grid's right edge, which the grid's 2 px padding didn't absorb. The grid scrolls (down),
  so it scrolled sideways too: content 207 px wide in 204 px (at 1440 px). The grid columns were
  already `repeat(2, minmax(0, 1fr))`, and long names were already cut with an ellipsis. It
  wasn't the names' length.
- **The fix** (`MediaLibrary.svelte`):
  - no negative margins: the name and its rename field are one box (block, `width: 100%`,
    `min-width: 0`, `box-sizing: border-box`, the same padding and a 1 px border, transparent
    on the name), so the text doesn't move when renaming;
  - long names stay one line, cut with "…" (`white-space: nowrap`, `overflow: hidden`,
    `text-overflow: ellipsis`), with the full name in the tile's tooltip, as before;
  - tiles are `box-sizing: border-box`;
  - `overflow-x: hidden` on the grid, as a safety net only.
- **The other side panels** were checked at 900, 1100 and 1440 px wide: the Add column, the
  Settings column (with a clip, then words selected), and the font picker's list. None
  overflowed, so they're unchanged.
- **Test** (`panel-overflow.test.ts`): two very long file names (with and without spaces) and a
  long name given in Your media. At three window widths it checks:
  - the media grid, Your media, the Add and Settings columns and the font picker: their
    `scrollWidth` equals their `clientWidth`;
  - each name stays inside its tile, on one line, cut with "…", with the full name as the
    tooltip.
  With the old code it fails (207 vs 204).

## More compact Add buttons

- **Buttons** (`AddButton.svelte`):
  - 64 → 53 px tall (8 px top and bottom padding, was 10);
  - the icon box 42 → 34 px, with the icon still 22 px at the same stroke;
  - label and hint at the same sizes, with no gap between them and tighter line heights (1.2,
    1.25).
  - Below 1280 px wide: 58 → 46 px (6 px padding, a 32 px icon box).
  - The corner radius, border and hover and active states are unchanged.
- **Spacing** (`AddColumn.svelte`): 6 px between the buttons (was 8), and 10 px from "Add" to the
  first button (was 16).
- **The space goes to Your media** (measured with five files in it):
  - at 1100 × 900, two tiles now show without scrolling (none did);
  - at 1440 × 1080 the list grows from 162 to 218 px;
  - at 1440 × 900 everything moves up 57 px, but the first row of tiles is still just below
    the fold. The column has more to show than fits in a short window, and it scrolls.

## One heading style for the left column

- **"Add" and "Your media"** share one global class, `.column-heading` (`global.css`): the serif
  italic, regular weight, 22 px (`--text-column-heading`, Your media's size; "Add" was 28 px),
  line height 1, on one line.
- **The space under each** is `--space-under-column-heading` (8 px). Each column sets it against
  its own gap: the Add column's is 16 px, Your media's is 6 px.
- **"Remove unused"** sits beside the "Your media" heading, centred on it, so it never makes the
  row taller. In a narrow column (about 1100 px windows) it goes on its own line under the
  heading. Before, both wrapped onto two lines there.
- **The Settings column's section headings** ("Position and size", "Timing", "Keyframes",
  card fields…) already looked the same. Their style was defined three times, and it's now one
  global class, `.section-title`.
- The panel titles ("Scene 1", "Clips", "Crop"…) are a level above, at 28 px, and stay as they
  are.
- **Tests** (`column-headings.test.ts`):
  - at 1440 and 1100 px, both headings have the same computed font, style, weight, size and
    line height, at 22 px, on one line, with 8 px under each (with "Remove unused" showing);
  - every section heading in Settings (a card layer selected) has the same style.

## Fix: the stage zoom said "47%" after going back to Fit (and a flaky test)

- **What failed:** `stage-zoom.test.ts` › "plain scroll zooms the picture only in Custom
  framing…" sometimes failed in full runs. The zoom label read "47%" where "Fit" was expected,
  though the test passed on its own.
- **The cause was a real bug, not just test timing.** Double-clicking the zoom percentage (or
  choosing Fit) glides the frame back to Fit over 240 ms. The label shows "Fit" during the
  glide. At its end, `fit()` checks that the view is still the one it set (`view === fitted`)
  before going back to "follow the stage" (no fixed zoom). But `view` was a deep `$state`, which
  wraps the object it's given in a proxy. So the check was never true and the view was never
  cleared. After the 240 ms:
  - the label switched to the fit zoom as a percentage ("47%");
  - the frame stopped resizing with the stage.
  The test passed whenever it read the label inside those 240 ms, which a busy full run
  sometimes missed.
- **The fix** (`Stage.svelte`): `view` is `$state.raw`. The view is only ever replaced whole,
  never changed in place, so a plain (unproxied) value is right, and the identity check works.
  Nothing else changes.
- **The test** is now deterministic and covers the bug:
  - it waits for the zoom to show a percentage after Cmd/Ctrl + scroll (instead of reading
    once);
  - after the double-click, it checks "Fit" right away and again once the glide is over (after
    400 ms), with the frame centred at its Fit size.
  With the old code it now fails every time ("47%"); with the fix it passed 60 of 60 runs
  (`--repeat-each=10`) and two full runs.

## Fix: replacing a project from its file could bring back the old version

- **What failed:** `project-files.test.ts` › "save to a file, delete from the app, open it
  again…" sometimes failed in full runs. After renaming the project to "Changed" and replacing it
  with the one in the file, the editor showed "Changed" instead of "Summer trip".
- **The cause was a real bug.** Every change is saved half a second later (the autosave). When a
  project is replaced from a file, its open editor is frozen so it stops saving. But `freeze()`
  only stopped new saves: a save already waiting still went ahead. In the test, Replace is
  clicked 150–360 ms after the rename, so the rename's save was still waiting:
  1. the replace stored "Summer trip";
  2. the old editor's waiting save then wrote "Changed" over it;
  3. the new editor usually saved "Summer trip" again soon after, so it mostly looked fine. When
     it read the project in between, it showed "Changed".
  A person renaming and quickly replacing could lose the replace the same way.
- **The fix:**
  - `Autosaver.cancel()` drops the waiting save, and waits for one that had already started;
  - `freeze()` calls it;
  - the file opener waits for the freeze (`beforeReplace` may return a promise) before storing
    the file.
  So nothing from the old editor is written after the replace.
- **Tests:**
  - **Project files:** the test now records every project written to storage. After Replace,
    nothing may write "Changed" after the replace's own write. It also checks "Summer trip"
    after 1.5 s and after a reload. With the old code this fails every time; with the fix it
    passed 10 of 10 (`--repeat-each=10`) and two full runs.
  - **Unit:** `Autosaver.cancel()` drops the waiting save and waits for the one under way.

## Known issues / ideas

- Layers: their timing is at normal speed (no speed setting). Scenes at 0.5× or 2× become
  layers with their used part of the clip at 1×. The home picture shows layers that start at
  0 s. Waveforms of sounds spanning several short scenes are stretched slightly by the
  storyboard's minimum widths.

- Tablet landscape: the preview gets small at 1024×768 because the storyboard is fixed height. Phase 8.
- Stepper hold-to-repeat works with a pointer; keyboard users press repeatedly.
- The Words, Sound and Looks panels are still placeholders (Phases 4–6). Clips works.
- Mood swatches are stored per scene but only change the picture from Phase 6.
- Very large words: they're drawn from one sprite. Splitting it into tiles would keep them sharp at
  4× too (now about 1.4× the frame's resolution at most for 2000 px words).
- Pasteboard: white words without a shadow, faded to 30%, are nearly invisible on the white
  stage outside the frame (a tinted pasteboard, or an outline for faded parts, would help).
- Flaky test: `phase5-sound.test.ts` › "a recorded voiceover plays back where it was recorded"
  fails now and then in full runs only ("Get ready to speak…" not visible). It hasn't been looked
  into yet.
- Shadow ideas: a shadow for the box itself (not only the letters), several shadows, an inner
  shadow.
- Pasteboard ideas: guides at the frame's edges while snapping words, a "show everything" zoom
  that fits all objects, and keeping the zoom per project.
- Framing ideas: rotate, "follow the subject" pan over time (Ken Burns), per-scene background colour.
- The reframe ghost uses the preview-quality frame (≤1280px); fine for positioning, soft when
  zoomed far in.
- Crop ideas: rotate/straighten, crop presets remembered per clip, keyboard resizing of the crop box.
- Card ideas: gradients, several shapes, images on cards, saving a card as a reusable style.
- Font ideas: letter spacing and line height controls, text alignment, per-word colours, more
  subsets (Cyrillic/Greek) for the built-in fonts, cleaning up stored fonts nobody uses.
- Undo history isn't persisted across reloads.
- Project files: media sliced from a file is checked by size, not checksum (to keep opening
  fast). Replacing a project from a file keeps the fonts its old version used (they stay in
  the font list); deleting a project does remove fonts no other project uses.

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
  place, with fade / slide-up / pop entrances, timed on the Text track.
- Add background music with waveform, volumes per scene and for music, automatic fades, and
  record voiceovers at the playhead.
- Pick transitions between scenes (cut, crossfade, fade to black, slide, zoom) and colour moods for
  the whole video or per scene — all WebGL shaders.
- Save an MP4 (H.264/AAC; WebM fallback) in three presets, rendered through the same compositor
  as the preview, streamed to disk with progress, time left and cancel.
- Undo/redo everything; projects autosave continuously on the device.
- Put videos, photos, cards and words on overlay tracks above the scenes, and music and
  voiceovers on audio tracks below: picture-in-picture at any size and position, with crop,
  rounded corners, border, shadow, opacity, entrance/exit animations and optional sound. Tracks
  can be added, renamed, reordered, hidden or muted, locked, duplicated and deleted. Items move
  between tracks, snap, multi-select and copy/paste; an optional ripple keeps them with their
  scenes, and anything ending at the video's end stays there. Overlays turn into scenes (and
  back) by dragging. The storyboard zooms (slider, Ctrl/Cmd+scroll, Fit), and short items stay
  easy to click.
- Keep any number of projects: a home screen with pictures, rename, duplicate, delete, and
  `.scenes` project files to save, move and reopen a whole project (media and fonts included).
- Animate layers, words and Custom-framed scenes with keyframes, the usual way:
  - a diamond adds one at the playhead, and moving, scaling, rotating or fading an animated
    item sets the keyframe there;
  - easing presets with a curve editor (Linear, eases, Hold, Overshoot, Bounce);
  - a motion path on the preview that can be dragged to move the whole animation;
  - markers on the timeline to select, drag, delete, ease and copy/paste;
  - volume points (a rubber band) on anything with sound, shaping the mix and the waveform.
- Put layers and words anywhere, also outside the frame: the stage around the preview is a
  pasteboard showing them faded, it pans and zooms, edges snap just outside the frame, and "Move
  off-screen" sets up slide-ins. Saved videos show only the frame.
- Save the whole video or a range (I/O) as a video, a GIF (or animated WebP), just the sound
  (WAV, M4A, MP3), the current frame (PNG/JPG, also with F or a right-click), or only the
  overlays on a transparent background (WebM with alpha where possible, or PNG frames). Every
  kind is drawn by the same renderer as the preview.

How to run: see "How to run" at the top (`npm install`, `npm run dev`; `npm test` and
`npm run test:e2e` for the tests — the e2e suite uses installed Google Chrome, and the save-video
tests use ffmpeg/ffprobe to inspect the output if they're installed).

Round 2 added real filmstrips, a project format (shape, resolution, frame rate), per-scene
framing (fill / fit with bars / custom reframe on the preview), a "Your media" library, and a preview
that fills the stage in any shape.

Tests: ~140 unit/component tests (editing model, history, timing, text animation, moods,
transition composition, audio clips, export presets, autosave) and ~37 Playwright tests in real
Chrome covering every phase's and round's "done when" scenario, plus automated accessibility checks.
