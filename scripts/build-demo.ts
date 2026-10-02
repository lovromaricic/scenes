/**
 * Builds the demo project that ships with the app: "Casa Rossa", a 22-second TV-style ad for a
 * (fictional) tomato sauce, with a voiceover. Run it with:
 *
 *     node scripts/build-demo.ts            (add --no-export to skip the MP4 and stills)
 *
 * It drives the real app in Chrome (a Vite dev server and Playwright), so the project is made the
 * way a person would make it: the files are imported through the file picker and the Sound panel,
 * and every scene, layer, word, keyframe, transition and volume point is made with the editor's
 * own functions (`window.__scenes`). Nothing in the editor is changed for it; where the editor
 * can't do exactly what the ad asks, the closest thing is used (see NOTES.md, "The Casa Rossa
 * demo"). The project is saved with the app's own "Save to file" to
 * `static/demo/casa-rossa.scenes`.
 *
 * Then the app exports it as an MP4 (`demo-review/casa-rossa.mp4`), stills are taken from that
 * at the moments to review (`demo-review/still-*.png`), and a frame at 14.45 s becomes the home
 * screen's Demo card picture (`static/demo/casa-rossa.jpg`).
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSETS = path.join(ROOT, 'demo-assets');
const OUT = path.join(ROOT, 'static', 'demo');
const REVIEW = path.join(ROOT, 'demo-review');
const PORT = 4319;
const LENGTH = 22;
const STILLS = [0.8, 2.0, 3.2, 5.0, 7.0, 10.0, 12.0, 15.0, 17.0, 18.5, 20.0, 21.5];
const CARD_PICTURE_AT = 14.45;
const MUSIC = 'the_mountain-italian-485568.mp3';
/** The voiceover, one file per line, and where each starts. */
const VOICE: [string, number][] = [
	['voiceover_line1.wav', 0.2],
	['voiceover_line2.wav', 3.9],
	['voiceover_line3.wav', 9.0],
	['voiceover_line4.wav', 13.5],
	['voiceover_line5.wav', 16.9],
	['voiceover_line6.wav', 18.85]
];
const exportVideo = !process.argv.includes('--no-export');

/** The editor, as the page has it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Editor = any;

async function chooseFiles(page: Page, button: RegExp | string, files: string[]) {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: button }).first().click();
	await (await chooser).setFiles(files.map((f) => path.join(ASSETS, f)));
}

/** Add a sound file through the Sound panel's Music button (as a person would), at time `at`. */
async function addSound(page: Page, file: string, at: number) {
	const before = await page.evaluate(() => (window as unknown as { __scenes: Editor }).__scenes.project.sounds.length);
	await page.evaluate((t) => (window as unknown as { __scenes: Editor }).__scenes.seek(t), at);
	await page.getByRole('button', { name: /^Sound Music/ }).click();
	await chooseFiles(page, /^Music Add a song/, [file]);
	await page.waitForFunction((n) => (window as unknown as { __scenes: Editor }).__scenes.project.sounds.length > n, before, { timeout: 120_000 });
	await page.keyboard.press('Escape');
}

/**
 * Runs in the page, with the editor (`window.__scenes`): the scenes, layers and words.
 * Self-contained (no imports). Positions are project pixels (1920 × 1080), the item's centre
 * unless `left`/`right` is given.
 */
async function buildPicture(): Promise<void> {
	const s = (window as unknown as { __scenes: Editor }).__scenes;
	const W = 1920;
	const H = 1080;
	const LENGTH = 22;
	const newId = () => crypto.randomUUID();
	const E = {
		linear: { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 },
		in: { kind: 'bezier', x1: 0.42, y1: 0, x2: 1, y2: 1 },
		out: { kind: 'bezier', x1: 0, y1: 0, x2: 0.58, y2: 1 },
		inOut: { kind: 'bezier', x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
		overshoot: { kind: 'overshoot' },
		bounce: { kind: 'bounce' }
	};
	const RED = '#d63f1f';
	const INK = '#141417';
	const WHITE = '#ffffff';
	const MUTED = '#6b6b72';
	const F = {
		anton: { family: 'Anton', source: 'builtin', weight: 400, italic: false, id: 'anton' },
		serif: { family: 'Instrument Serif', source: 'builtin', weight: 400, italic: true, id: 'instrument-serif' },
		geist: (weight: number) => ({ family: 'Geist', source: 'builtin', weight, italic: false, id: 'geist' })
	};
	const SOFT = { on: true, color: '#000000', opacity: 0.45, blur: 0.25, distance: 0.04, angle: 90 };
	/** Wide letter spacing (there's no setting for it): thin spaces between the letters. */
	const spaced = (text: string) => [...text].join(' ');

	const media = (name: string) => s.project.library.find((id: string) => s.media[id].name === name);
	const box = (cx: number, cy: number, w: number, h: number) => ({ x: (cx - w / 2) / W, y: (cy - h / 2) / H, w: w / W, h: h / H });
	type V = { x: number; y: number; scale?: number; scaleX?: number; opacity?: number; rotation?: number };
	const values = (v: V) => ({
		x: v.x / W,
		y: v.y / H,
		scaleX: Math.max(0.01, v.scaleX ?? v.scale ?? 1),
		scaleY: Math.max(0.01, v.scale ?? 1),
		rotation: v.rotation ?? 0,
		opacity: v.opacity ?? 1
	});
	/** Keyframes at timeline times (stored from the item's start), each easing into the next. */
	const animate = (id: string, start: number, list: [number, V, object?][]) =>
		s.updateKeyframes(id, 'Animate', () =>
			list.map(([t, v, easing]) => ({ id: newId(), time: Math.round((t - start) * 1000) / 1000, values: values(v), easing: easing ?? E.linear }))
		);
	const seekInto = (start: number) => s.seek(Math.min(start + 0.02, s.duration - 0.6));

	/** Width in pixels of one line of words, in one of the built-in fonts, at a size. */
	async function measure(words: string, font: { id: string; weight: number; italic: boolean }, px: number) {
		// The same file the editor draws with, loaded here under its own name.
		const style = font.italic ? 'italic' : 'normal';
		const family = `measure-${font.id}-${font.weight}-${style}`;
		if (![...document.fonts].some((f) => f.family === family)) {
			const face = new FontFace(family, `url(/fonts/${font.id}/${font.weight}-${style}.woff2)`, { weight: String(font.weight), style });
			document.fonts.add(await face.load());
		}
		const ctx = document.createElement('canvas').getContext('2d')!;
		ctx.font = `${style} ${font.weight} ${px}px "${family}"`;
		return ctx.measureText(words).width;
	}

	// ── Format and title ──
	s.setTitle('Casa Rossa ad');
	s.setFormat({ preset: 'landscape', width: W, height: H, fps: 24 });

	// ── Tracks (top to bottom; each new one goes on top) ──
	const trackNames = [
		'Badge text',
		'Badge',
		'Headlines',
		'Captions',
		'Labels',
		'Shapes',
		'Picture-in-picture',
		'Split screen',
		'Tomato · small',
		'Tomato · medium',
		'Tomato · large',
		'Background text'
	];
	const tracks: Record<string, string> = {};
	for (const name of [...trackNames].reverse()) tracks[name] = s.addTrack('overlay', 0, name);

	// ── Scenes ──
	// Imported: kitchen, terrace, hands, tomato. The tomato is only a layer; three cards go in.
	const sceneIds = () => s.project.scenes.map((x: { id: string }) => x.id);
	s.deleteScene(sceneIds()[3]);
	s.addCard(0);
	s.addCard(3);
	s.addCard(5);
	const [red, kitchen, terrace, ink, hands, white] = sceneIds();
	s.setCard(red, { background: RED, rect: null });
	s.setCard(ink, { background: INK, rect: null });
	s.setCard(white, { background: WHITE, rect: null });
	s.rename(red, 'Fresh, simple, Italian');
	s.rename(kitchen, 'Kitchen');
	s.rename(terrace, 'Terrace');
	s.rename(ink, 'Tomatoes');
	s.rename(hands, 'Ready in 10');
	s.rename(white, 'Casa Rossa');

	const changes = [3.8, 8.9, 13.4, 16.8, 18.8];
	const lengths = [3.8, 8.9 - 3.8, 13.4 - 8.9, 16.8 - 13.4, 18.8 - 16.8, LENGTH - 18.8];
	// The hands clip: from 4.0 s, twice as fast.
	s.trimScene(hands, 'start', 4.0);
	s.setSceneSpeed(hands, 2);
	[red, kitchen, terrace, ink, hands, white].forEach((id: string, i: number) => s.setSceneLength(id, lengths[i]));
	for (const id of [kitchen, hands]) s.setSceneVolume(id, 0);
	s.setSceneMood(hands, 'golden');

	// Kitchen: a slow push in (100% → 115%).
	s.setSceneFrame(kitchen, { mode: 'custom', bars: 'black', zoom: 1, x: 0, y: 0 });
	s.updateKeyframes(kitchen, 'Push in', () => [
		{ id: newId(), time: 0, values: { x: 0, y: 0, zoom: 1 }, easing: E.inOut },
		{ id: newId(), time: lengths[1], values: { x: 0, y: 0, zoom: 1.15 }, easing: E.inOut }
	]);
	// Terrace: 112%, panning from the picture's left side to its right side.
	const pan = (1.12 - 1) / 2;
	s.setSceneFrame(terrace, { mode: 'custom', bars: 'black', zoom: 1.12, x: pan, y: 0 });
	s.updateKeyframes(terrace, 'Pan', () => [
		{ id: newId(), time: 0, values: { x: pan, y: 0, zoom: 1.12 }, easing: E.linear },
		{ id: newId(), time: lengths[2], values: { x: -pan, y: 0, zoom: 1.12 }, easing: E.linear }
	]);

	// Transitions. setTransition always uses each kind's usual length (slide 0.6, crossfade 0.8,
	// zoom 0.7 s); the ad's shorter ones are set on the scenes with the editor's own edit().
	const transitions: [string, string, number][] = [
		[red, 'slide', 0.4],
		[kitchen, 'crossfade', 0.5],
		[terrace, 'cut', 0],
		[ink, 'zoom', 0.4],
		[hands, 'crossfade', 0.5]
	];
	for (const [id, kind] of transitions) s.setTransition(id, kind);
	s.edit('Transition lengths', (p: { scenes: { id: string; transition: { kind: string; duration: number } }[] }) => ({
		...p,
		scenes: p.scenes.map((scene) => {
			const t = transitions.find(([id]) => id === scene.id);
			return t ? { ...scene, transition: { kind: t[1], duration: t[2] } } : scene;
		})
	}));

	// ── Words ──
	interface Words {
		track: string;
		words: string;
		start: number;
		end: number;
		x: number;
		y: number;
		/** The words' left edge at `x` (else centred on it). */
		left?: boolean;
		/** The words' right edge at `x`. */
		right?: boolean;
		style?: string;
		font: { id: string; family: string; weight: number; italic: boolean };
		px: number;
		color?: string;
		shadow?: object;
		animation?: string;
	}
	async function words(w: Words): Promise<string> {
		seekInto(w.start);
		s.addText('caption');
		const id = s.selectedId;
		s.stopEditingText();
		s.setTextWords(id, w.words);
		s.setTextStyle(id, w.style ?? 'clean');
		s.setTextFont(id, w.font);
		s.setTextSize(id, w.px / H);
		if (w.color) s.setTextColors(id, { fill: { color: w.color, opacity: 1 } });
		if (w.shadow) s.setTextShadow(id, w.shadow);
		s.setTextWidth(id, 'auto');
		s.setTextAnimation(id, w.animation ?? 'none');
		s.setTextTiming(id, w.start, w.end - w.start);
		// Left- or right-aligned: there's no alignment setting, so the centre goes half the width in.
		let x = w.x;
		if (w.left || w.right) {
			const pad = w.style === 'highlight' ? 0.28 * w.px : w.style === 'boxed' ? 0.5 * w.px : 0;
			const half = pad + (await measure(w.words, w.font, w.px)) / 2;
			x = w.left ? w.x + half : w.x - half;
		}
		seekInto(w.start);
		s.setTextPosition(id, x / W, w.y / H);
		s.moveItems([id], 0, tracks[w.track]);
		s.rename(id, w.words.replaceAll(' ', ''));
		return id;
	}

	// Opening: three words, each on the voice's word, punching in (160% → 100%, fading in,
	// 0.25 s, overshoot).
	const punch = (id: string, start: number) =>
		animate(id, start, [
			[start, { x: 960, y: 500, scale: 1.6, opacity: 0 }, E.overshoot],
			[start + 0.25, { x: 960, y: 500 }]
		]);
	const opening: [string, number, number][] = [
		['Fresh.', 0.28, 1.44],
		['Simple.', 1.44, 2.61],
		['Italian.', 2.61, 3.8]
	];
	for (const [text, start, end] of opening) {
		const id = await words({ track: 'Headlines', words: text, start, end, x: 960, y: 500, font: F.anton, px: 260, color: WHITE });
		punch(id, start);
	}
	// The white bar under "Italian.", drawing itself out from the middle.
	const bar = s.addCardOverlay(2.61, tracks['Shapes']);
	s.setOverlayCard(bar, { background: WHITE, rect: null });
	s.setOverlayBox(bar, box(960, 680, 640, 10));
	s.setOverlayTiming(bar, 2.61, changes[0] - 2.61);
	s.setScaleLinked(bar, false);
	animate(bar, 2.61, [
		[2.7, { x: 960, y: 680, scaleX: 0 }, E.out],
		[3.1, { x: 960, y: 680 }]
	]);
	s.rename(bar, 'Underline');

	// Kitchen. "SINCE 1962" top right, over the dark cabinets (top left is the bright window).
	await words({ track: 'Labels', words: spaced('SINCE 1962'), start: 3.95, end: changes[1], x: 1800, y: 110, right: true, font: F.geist(600), px: 34, color: WHITE, shadow: SOFT, animation: 'fade' });
	await words({ track: 'Captions', words: 'From our garden to your table.', start: 6.25, end: changes[1], x: 120, y: 900, left: true, font: F.serif, px: 96, color: WHITE, shadow: SOFT, animation: 'slide-up' });

	// Terrace: the hands clip, in a framed picture-in-picture, sliding in and out.
	const pip = s.addOverlayFromMedia(media('demo_video2.mp4'), 9.1, tracks['Picture-in-picture']);
	s.setOverlayTiming(pip, 9.1, 13.3 - 9.1, 0);
	s.setOverlayBox(pip, box(1460, 740, 730, 410));
	s.setOverlayStyle(pip, { radius: 24 / 205, borderColor: WHITE, borderWidth: 6, shadow: 'strong', opacity: 1 });
	animate(pip, 9.1, [
		[9.1, { x: 2400, y: 740, scale: 0.95 }, E.out],
		[9.6, { x: 1460, y: 740, scale: 0.95 }, E.inOut],
		[12.8, { x: 1460, y: 740 }],
		[12.95, { x: 1460, y: 740 }, E.in],
		[13.3, { x: 2400, y: 740 }]
	]);
	s.rename(pip, 'Hands (picture-in-picture)');
	await words({ track: 'Headlines', words: 'Sun-ripened tomatoes', start: 9.1, end: changes[2], x: 120, y: 760, left: true, style: 'highlight', font: F.geist(600), px: 72, animation: 'pop' });
	await words({ track: 'Captions', words: 'Hand-cut. Every time.', start: 11.0, end: changes[2], x: 120, y: 870, left: true, font: F.serif, px: 56, color: WHITE, shadow: SOFT, animation: 'fade' });

	// Tomatoes: a big outlined "100%" behind, three tomatoes bouncing in and floating.
	const hundred = await words({ track: 'Background text', words: '100%', start: 13.55, end: changes[3], x: 960, y: 480, style: 'outline', font: F.anton, px: 520 });
	// Hollow letters: the fill is the card's ink (a see-through fill would hide the outline too).
	s.setTextColors(hundred, { fill: { color: INK, opacity: 1 }, outline: { color: WHITE, width: 0.02 } });
	animate(hundred, 13.55, [
		[13.55, { x: 960, y: 480, scale: 0.9, opacity: 0 }, E.out],
		[13.9, { x: 960, y: 480, opacity: 0.25 }]
	]);
	const tomatoes: [string, number, number, number, number, number, number][] = [
		// track, enters, size, x, y, rotation, float phase (0 up first, 1 down first, 0.5 half way)
		['Tomato · large', 13.6, 520, 760, 560, -10, 0],
		['Tomato · medium', 13.85, 380, 1180, 620, 12, 1],
		['Tomato · small', 14.1, 260, 980, 320, 25, 0.5]
	];
	for (const [track, start, size, x, y, rotation, phase] of tomatoes) {
		const id = s.addOverlayFromMedia(media('tomato_transparent.png'), start, tracks[track]);
		s.setOverlayTiming(id, start, changes[3] - start);
		s.setOverlayBox(id, box(x, y, size, size));
		const keys: [number, V, object?][] = [
			[start, { x, y, scale: 0, rotation }, E.bounce],
			[start + 0.5, { x, y, rotation }, E.inOut]
		];
		// Then a gentle float, ±12 px, a keyframe every 0.8 s.
		let t = start + 0.5 + (phase === 0.5 ? 0.4 : 0.8);
		let up = phase !== 1;
		while (t < changes[3] + 0.8) {
			keys.push([t, { x, y: y + (up ? -12 : 12), rotation }, E.inOut]);
			up = !up;
			t += 0.8;
		}
		animate(id, start, keys);
		s.rename(id, track.replace('Tomato · ', 'Tomato, '));
	}
	await words({ track: 'Headlines', words: 'TOMATOES.', start: 14.5, end: changes[3], x: 960, y: 870, style: 'title', font: F.anton, px: 140, color: WHITE, animation: 'slide-up' });
	await words({ track: 'Captions', words: 'Nothing else.', start: 15.75, end: changes[3], x: 960, y: 975, font: F.serif, px: 56, color: WHITE, animation: 'fade' });
	// The "NEW" badge: a red circle and its word, spinning in together.
	const spin = (id: string) =>
		animate(id, 14.3, [
			[14.3, { x: 1660, y: 210, scale: 0, rotation: -180 }, E.overshoot],
			[14.8, { x: 1660, y: 210 }]
		]);
	const badge = s.addCardOverlay(14.3, tracks['Badge']);
	s.setOverlayCard(badge, { background: RED, rect: null });
	s.setOverlayBox(badge, box(1660, 210, 200, 200));
	s.setOverlayStyle(badge, { radius: 1, borderColor: WHITE, borderWidth: 0, shadow: 'off', opacity: 1 });
	s.setOverlayTiming(badge, 14.3, changes[3] - 14.3);
	spin(badge);
	s.rename(badge, 'Badge');
	spin(await words({ track: 'Badge text', words: 'NEW', start: 14.3, end: changes[3], x: 1660, y: 210, font: F.anton, px: 64, color: WHITE }));

	// Speed and looks: the kitchen as a split-screen panel, and "Ready in 10 MINUTES".
	const split = s.addOverlayFromMedia(media('demo_video1.mp4'), 16.85, tracks['Split screen']);
	s.setOverlayTiming(split, 16.85, changes[4] - 16.85, 3.0);
	s.setOverlayBox(split, box(480, 540, 880, 1000));
	s.setOverlayStyle(split, { radius: 24 / 440, borderColor: WHITE, borderWidth: 0, shadow: 'off', opacity: 1 });
	animate(split, 16.85, [
		[16.85, { x: -440, y: 540 }, E.out],
		[17.2, { x: 480, y: 540 }]
	]);
	s.rename(split, 'Kitchen (split screen)');
	await words({ track: 'Headlines', words: 'Ready in', start: 16.95, end: changes[4], x: 1420, y: 400, style: 'boxed', font: F.geist(600), px: 72, animation: 'pop' });
	// "10" and "MINUTES" side by side, centred together in the right half (see NOTES).
	const gap = 36;
	const wTen = await measure('10', F.anton, 220);
	const wMin = await measure('MINUTES', F.anton, 120);
	const left = 1420 - (wTen + gap + wMin) / 2;
	const pop = (id: string, start: number, x: number, y: number) =>
		animate(id, start, [
			[start, { x, y, scale: 0.3, opacity: 0 }, E.overshoot],
			[start + 0.35, { x, y }]
		]);
	const tenX = left + wTen / 2;
	const minX = left + wTen + gap + wMin / 2;
	pop(await words({ track: 'Labels', words: '10', start: 17.85, end: changes[4], x: tenX, y: 590, font: F.anton, px: 220, color: WHITE, shadow: SOFT }), 17.85, tenX, 590);
	// Its bottom on the same line as "10"'s.
	pop(await words({ track: 'Captions', words: 'MINUTES', start: 18.15, end: changes[4], x: minX, y: 625, font: F.anton, px: 120, color: WHITE, shadow: SOFT }), 18.15, minX, 625);

	// Outro.
	const name = await words({ track: 'Headlines', words: 'Casa Rossa', start: 18.93, end: LENGTH, x: 960, y: 470, font: F.serif, px: 200, color: INK });
	animate(name, 18.93, [
		[18.93, { x: 960, y: 470, scale: 0.8, opacity: 0 }, E.overshoot],
		[19.35, { x: 960, y: 470 }]
	]);
	await words({ track: 'Captions', words: 'Taste the sun.', start: 20.45, end: LENGTH, x: 960, y: 640, font: F.geist(600), px: 56, color: RED, animation: 'fade' });
	await words({ track: 'Labels', words: spaced('Tomato sauce · Available now'), start: 20.9, end: LENGTH, x: 960, y: 980, font: F.geist(400), px: 28, color: MUTED, animation: 'fade' });

	// The music: from the start of the file, 22 s.
	const music = s.project.sounds[0];
	s.setSoundTiming(music.id, { start: 0, sourceStart: music.sourceStart, duration: LENGTH });
}

/** Runs in the page, after the voice lines are in: the music's levels and the voiceover. */
function buildAudio(voice: [string, number][]): void {
	const s = (window as unknown as { __scenes: Editor }).__scenes;
	const [music, ...lines] = s.project.sounds;
	// The music: full volume, no fades; volume points take it from 100% down to 35% by 0.2 s
	// (under the voice) until 21.0 s, then to nothing at 22.0 s.
	s.setSoundVolume(music.id, 1);
	s.setSoundFades(music.id, 0, 0);
	s.setDefaultEasing('linear');
	for (const [t, gain] of [
		[0, 1],
		[0.2, 0.35],
		[21.0, 0.35],
		[22.0, 0]
	])
		s.addVolumePoint(music.id, t, gain);
	s.setDefaultEasing('ease-in-out');
	s.rename(music.id, 'Casa Rossa theme');
	s.renameTrack(music.trackId, 'Music');
	// The voiceover: each line where it's said, full volume, no fades.
	lines.forEach((line: { id: string; sourceStart: number; duration: number }, i: number) => {
		s.setSoundTiming(line.id, { start: voice[i][1], sourceStart: line.sourceStart, duration: line.duration });
		s.setSoundVolume(line.id, 1);
		s.setSoundFades(line.id, 0, 0);
		s.rename(line.id, `Voiceover, line ${i + 1}`);
	});
	// Added through the Music button, they're "music"; they're voiceovers (as a recording would be).
	const ids = lines.map((l: { id: string }) => l.id);
	s.edit('Voiceover', (p: { sounds: { id: string; kind: string }[] }) => ({
		...p,
		sounds: p.sounds.map((x) => (ids.includes(x.id) ? { ...x, kind: 'voice' } : x))
	}));
	const voiceTrack = s.project.sounds.find((x: { id: string }) => x.id === ids[0]).trackId;
	s.renameTrack(voiceTrack, 'Voiceover');
	// The voice above the music.
	s.moveTrack(voiceTrack, s.project.tracks.findIndex((t: { id: string }) => t.id === music.trackId));

	// The tracks it started with, now empty.
	for (const t of [...s.project.tracks]) {
		const used = [...s.project.overlays, ...s.project.texts, ...s.project.sounds].some((i: { trackId: string }) => i.trackId === t.id);
		if (t.kind !== 'main' && !used) s.deleteTrack(t.id);
	}
	s.deselect();
	s.seek(15);
}

// ─── Main ────────────────────────────────────────────────────────────────────────────────────

async function main() {
	mkdirSync(OUT, { recursive: true });
	mkdirSync(REVIEW, { recursive: true });

	const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
	await server.listen();
	const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
	try {
		const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
		const page = await context.newPage();
		page.on('pageerror', (e) => console.error('Page error:', e.message));

		await page.goto(`http://127.0.0.1:${PORT}`);
		await page.getByRole('button', { name: /^New video/ }).click();
		await page.waitForFunction(() => !!(window as unknown as { __scenes?: unknown }).__scenes);
		await page.evaluate(() => (window as unknown as { __scenes: Editor }).__scenes.setFormat({ preset: 'landscape', width: 1920, height: 1080, fps: 24 }));
		console.log('Importing…');
		await chooseFiles(page, 'Choose photos & videos', ['demo_video1.mp4', 'demo_image1.jpeg', 'demo_video2.mp4', 'tomato_transparent.png']);
		await page.getByRole('button', { name: /^Scene 4, / }).waitFor({ timeout: 120_000 });
		await page.keyboard.press('Escape');
		// The music first (from 0, on the first audio track).
		await addSound(page, MUSIC, 0);

		console.log('Building…');
		await page.evaluate(buildPicture);
		// The voice lines where they're said (the music is in the way, so they go on a track of
		// their own).
		for (const [file, at] of VOICE) await addSound(page, file, at);
		await page.evaluate(buildAudio, VOICE);
		const summary = await page.evaluate(() => {
			const s = (window as unknown as { __scenes: Editor }).__scenes;
			return {
				duration: s.duration,
				scenes: s.project.scenes.length,
				overlays: s.project.overlays.length,
				texts: s.project.texts.length,
				sounds: s.project.sounds.map((x: { start: number; duration: number; kind: string }) => `${x.kind} ${x.start}+${x.duration.toFixed(2)}`),
				tracks: s.project.tracks.map((t: { name: string }) => t.name)
			};
		});
		console.log(summary);
		if (Math.abs(summary.duration - LENGTH) > 1e-3) throw new Error(`The video is ${summary.duration} s, not ${LENGTH} s.`);
		await page.evaluate(() => (window as unknown as { __scenes: Editor }).__scenes.flushSave());

		// Save with the app's own "Save to file" (as a download: no file picker in a script).
		console.log('Saving the project file…');
		const download = page.waitForEvent('download', { timeout: 180_000 });
		await page.evaluate(() => {
			delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
			return (window as unknown as { __scenes: Editor }).__scenes.saveToFile();
		});
		const file = path.join(OUT, 'casa-rossa.scenes');
		await (await download).saveAs(file);
		console.log(`  ${path.relative(ROOT, file)}`);

		if (exportVideo) {
			console.log('Exporting the MP4…');
			await page.getByRole('button', { name: 'Save video' }).click();
			const dialog = page.getByRole('dialog', { name: 'Save video' });
			const video = page.waitForEvent('download', { timeout: 600_000 });
			await dialog.getByRole('button', { name: 'Save video' }).click();
			const mp4 = path.join(REVIEW, 'casa-rossa.mp4');
			await (await video).saveAs(mp4);
			console.log(`  ${path.relative(ROOT, mp4)}`);
			for (const t of STILLS) {
				const still = path.join(REVIEW, `still-${t.toFixed(1).padStart(4, '0')}.png`);
				execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', still]);
			}
			// The tomatoes and the badge in, just before "TOMATOES." (the card's name goes at the bottom).
			const card = path.join(REVIEW, 'card.jpg');
			execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(CARD_PICTURE_AT), '-i', mp4, '-frames:v', '1', '-vf', 'scale=800:-2', '-q:v', '3', card]);
			copyFileSync(card, path.join(OUT, 'casa-rossa.jpg'));
			console.log(`  stills in ${path.relative(ROOT, REVIEW)}/, card picture static/demo/casa-rossa.jpg`);
		}
	} finally {
		await browser.close();
		await server.close();
	}
}

await main();
