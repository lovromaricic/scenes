# Scenes

Scenes is an easy-to-use video editor in the browser. Build videos as a storyboard of scenes, add
text, layers, keyframe animation and music, all processed locally on your device.

![The Scenes editor: the Casa Rossa demo's outro on the stage, its settings, and the storyboard's tracks with keyframes](docs/screenshots/editor.png)

![The home screen: New video, the Casa Rossa demo, and projects made from it](docs/screenshots/home.png)

## Run it locally

You need [Node.js](https://nodejs.org) 23 or newer (the demo build script runs TypeScript
directly) and Google Chrome (for the end-to-end tests).

```sh
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Tests

```sh
npm run check      # type check
npm run lint       # formatting and lint
npm test           # unit tests (Vitest)
npm run test:e2e   # end-to-end tests in Chrome (Playwright; builds and serves the app itself)
```

## Build

```sh
npm run build      # a static site in build/
npm run preview    # serve that build locally
```

## The demo project

The home screen has a demo, "Casa Rossa", a short ad made with the app. To regenerate it from
the files in `demo-assets/`:

```sh
node scripts/build-demo.ts              # add --no-export to skip the MP4 and review frames
```

It writes `static/demo/casa-rossa.scenes` and its picture, plus an exported MP4 and review frames
in `demo-review/` (not committed). It needs `ffmpeg` installed.

## Screenshots

```sh
npm run screenshots
```

Regenerates `docs/screenshots/editor.png` and `home.png` (2560 × 1440, in a fresh browser profile,
compressed with `ffmpeg`), e.g. after a design change.

The demo assets (music, video and images in `demo-assets/`) are for the built-in demo only.

## More

`NOTES.md` has the architecture, the decisions made along the way, and what each change did.
