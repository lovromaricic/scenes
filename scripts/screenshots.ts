/**
 * The README's screenshots: `npm run screenshots` (or `node scripts/screenshots.ts`).
 *
 * Starts the app (a Vite dev server) and opens it in Chrome with Playwright, in a fresh profile,
 * at 1280 × 720 with a device scale factor of 2 (so the pictures are 2560 × 1440):
 *
 * - docs/screenshots/home.png: the home screen with the Demo card, New video, and two projects
 *   made from the demo (opened, then duplicated), so the grid isn't empty;
 * - docs/screenshots/editor.png: a fresh copy of the Casa Rossa demo with its outro selected, the
 *   playhead at 22.6 s (all three outro lines fully in: the tagline fades in from 21.9 s) and the
 *   storyboard scrolled to tracks with keyframes. The outro is Custom-framed, so selecting it
 *   shows the "Drag to move · Scroll to zoom" hint over the bottom of the picture, where the
 *   tagline is: that one hint is hidden for the picture (the app itself is unchanged).
 *
 * Each is made smaller with ffmpeg (a 256-colour PNG with dithering), to stay well under 1 MB.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { createServer } from 'vite';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 4320;
const BASE = `http://127.0.0.1:${PORT}`;

/** Close any messages, move the pointer out of the way, and let everything settle. */
async function tidy(page: Page) {
	for (const close of await page.getByRole('status').getByRole('button', { name: 'Close' }).all()) await close.click().catch(() => {});
	for (const close of await page.locator('.toasts button, [data-testid="toast"] button').all()) await close.click().catch(() => {});
	await page.mouse.move(1279, 719);
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(800);
}

/** A screenshot, made smaller (256 colours, dithered) with ffmpeg. */
async function shoot(page: Page, name: string) {
	const raw = path.join(OUT, `${name}.raw.png`);
	const file = path.join(OUT, `${name}.png`);
	await page.screenshot({ path: raw });
	execFileSync('ffmpeg', [
		'-v', 'error', '-y', '-i', raw,
		'-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a',
		'-compression_level', '100', file
	]);
	rmSync(raw);
	console.log(`  ${path.relative(ROOT, file)} (${Math.round(statSync(file).size / 1024)} KB)`);
}

/** Open the demo from the home screen (a new copy each time) and wait for the editor. */
async function openDemo(page: Page) {
	await page.getByRole('button', { name: /^Demo: Casa Rossa/ }).click();
	await page.waitForURL(/\/edit\//);
	await page.getByRole('button', { name: /^Scene 6, / }).waitFor({ timeout: 60_000 });
}

async function main() {
	mkdirSync(OUT, { recursive: true });
	const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: PORT, strictPort: true, host: '127.0.0.1' } });
	await server.listen();
	const browser = await chromium.launch({ channel: 'chrome' });
	try {
		// A fresh profile: nothing stored yet.
		const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
		const page = await context.newPage();
		page.on('pageerror', (e) => console.error('Page error:', e.message));

		// ── Home: the demo opened once, then duplicated ──
		await page.goto(BASE);
		await openDemo(page);
		await page.getByRole('link', { name: 'Projects' }).click();
		await page.getByRole('article', { name: 'Casa Rossa ad' }).waitFor();
		await page.getByRole('button', { name: 'More for Casa Rossa ad' }).click();
		await page.getByRole('menuitem', { name: 'Duplicate' }).click();
		await page.getByRole('article').nth(1).waitFor();
		// Every picture loaded.
		await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
		await tidy(page);
		console.log('Home screen');
		await shoot(page, 'home');

		// ── Editor: a fresh copy, the outro selected, the playhead at 21.5 s ──
		await openDemo(page);
		await page.getByRole('button', { name: /^Scene 6, / }).click();
		await page.evaluate(() => (window as unknown as { __scenes: { seek(t: number): void } }).__scenes.seek(22.6));
		await page.addStyleTag({ content: '.hint:has(svg) { visibility: hidden; }' });
		await page.waitForFunction(() => (window as unknown as { __scenes: { player: { isFrameReady(): boolean } } }).__scenes.player.isFrameReady(), null, { timeout: 30_000 });
		// The storyboard from the words' tracks down (their keyframes show on the items).
		await page.evaluate(() => {
			const tracks = document.querySelector('.tracks') as HTMLElement;
			const headlines = [...document.querySelectorAll('[data-track-header]')].find((h) => h.textContent?.includes('Headlines')) as HTMLElement;
			const ruler = document.querySelector('.ruler-row') as HTMLElement;
			if (tracks && headlines && ruler) tracks.scrollTop += headlines.getBoundingClientRect().top - ruler.getBoundingClientRect().bottom - 8;
		});
		await tidy(page);
		console.log('Editor');
		await shoot(page, 'editor');
	} finally {
		await browser.close();
		await server.close();
	}
}

await main();
