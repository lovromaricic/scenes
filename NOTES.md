# Scenes — build notes

A beginner-friendly, fully in-browser video editor. This file records decisions, simplifications,
known issues and ideas, phase by phase.

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
- **Not yet persistent.** Media is stored on import, but the project itself is only saved from
  Phase 3 (autosave), so a reload currently starts a new project.

## Known issues / ideas

- Tablet landscape: the preview gets small at 1024×768 because the storyboard is fixed height. Phase 8.
- Stepper hold-to-repeat works with a pointer; keyboard users press repeatedly.
- The Words, Sound and Looks panels are still placeholders (Phases 4–6). Clips works.
- The Inspector controls don't edit the scene yet (Phase 3).
- Imported media is never deleted from IndexedDB yet; cleanup of unused files comes with autosave (Phase 3).
