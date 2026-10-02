import { expect, test, type Page } from '@playwright/test';
import { importViaPicker, openNewVideo, setFormat } from './helpers';

/**
 * Tall and decorative words are never cut off: each word's picture (its sprite, drawn once and
 * placed on the video in the preview, the home picture and the saved file) is as big as the
 * letters really are, plus their outline and shadow. A clipped letter would leave ink on the
 * sprite's edge, so every sprite's outer pixels must be fully transparent.
 */

const api = <T>(page: Page, fn: string): Promise<T> => page.evaluate(`(${fn})(window.__scenes)`) as Promise<T>;

type Font = { family: string; source: 'builtin'; weight: number; italic: boolean; id: string };
const ANTON: Font = { family: 'Anton', source: 'builtin', weight: 400, italic: false, id: 'anton' };
const SERIF: Font = { family: 'Instrument Serif', source: 'builtin', weight: 400, italic: true, id: 'instrument-serif' };
const SCRIPT: Font = { family: 'Caveat', source: 'builtin', weight: 700, italic: false, id: 'caveat' };
const SOFT = { on: true, color: '#000000', opacity: 0.6, blur: 0.25, distance: 0.06, angle: 90 };

interface Case {
	name: string;
	words: string;
	font: Font;
	style: string;
	shadow?: object;
	outline?: boolean;
}

const CASES: Case[] = [
	{ name: 'Anton outlined', words: '100%', font: ANTON, style: 'outline', outline: true },
	{ name: 'Anton with accents and a shadow', words: 'ÉÅ Ügly', font: ANTON, style: 'clean', shadow: SOFT },
	{ name: 'Instrument Serif italic, shadow', words: 'Ffjord ÅÉ', font: SERIF, style: 'serif', shadow: SOFT },
	{ name: 'Caveat script, boxed', words: 'Hello þjqy', font: SCRIPT, style: 'boxed' },
	{ name: 'Caveat script, highlighter', words: 'Fresh fyg', font: SCRIPT, style: 'highlight' }
];

/** Every text sprite's edge: the most opaque pixel in its outer 2 pixels (0 = nothing touches it). */
const edges = (page: Page) =>
	page.evaluate(() => {
		const player = (window as unknown as { __scenes: { player: { sprites: { sprites: Map<string, { sprite: { canvas: OffscreenCanvas } }> } } } }).__scenes.player;
		return [...player.sprites.sprites.values()].map(({ sprite }) => {
			const c = sprite.canvas;
			const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
			let edge = 0;
			for (let y = 0; y < c.height; y++)
				for (let x = 0; x < c.width; x++)
					if (x < 2 || y < 2 || x >= c.width - 2 || y >= c.height - 2) edge = Math.max(edge, d[(y * c.width + x) * 4 + 3]);
			return { width: c.width, height: c.height, edge };
		});
	});

test.describe('Tall and decorative words', () => {
	test.setTimeout(180_000);

	for (const px of [520, 2000]) {
		test(`are never cut off at ${px} px: outline, shadow, box and highlighter`, async ({ page }) => {
			await openNewVideo(page);
			await importViaPicker(page, ['red.mp4'], 'Choose photos & videos');
			await expect(page.getByRole('button', { name: /^Scene 1, / })).toBeVisible();
			await setFormat(page, 'Landscape', '1080p');
			await page.keyboard.press('Escape');
			for (const c of CASES) {
				await api(page, `s => {
					for (const t of [...s.project.texts]) s.deleteText(t.id);
					s.seek(1);
					s.addText('caption');
					const id = s.selectedId;
					s.stopEditingText();
					s.setTextWords(id, ${JSON.stringify(c.words)});
					s.setTextStyle(id, ${JSON.stringify(c.style)});
					s.setTextFont(id, ${JSON.stringify(c.font)});
					s.setTextSize(id, ${px} / 1080);
					s.setTextWidth(id, 'auto');
					s.setTextAnimation(id, 'none');
					${c.outline ? "s.setTextColors(id, { fill: { color: '#141417', opacity: 1 }, outline: { color: '#ffffff', width: 0.03 } });" : ''}
					${c.shadow ? `s.setTextShadow(id, ${JSON.stringify(c.shadow)});` : ''}
					s.seek(1.5);
					s.select(null);
				}`);
				// Drawn with its own font (not the fallback), then the sprite checked.
				await page.evaluate((f) => document.fonts.load(`${f.italic ? 'italic ' : ''}${f.weight} 100px "sv-${f.id}"`), c.font);
				await expect.poll(() => api<boolean>(page, 's => s.player.isFrameReady()'), { timeout: 15_000 }).toBe(true);
				await page.waitForTimeout(400);
				const sprites = await edges(page);
				expect(sprites.length, c.name).toBeGreaterThan(0);
				for (const s of sprites) expect(s.edge, `${c.name}: ink on the sprite's edge (${s.width} × ${s.height})`).toBe(0);
				await page.getByTestId('preview').screenshot({ path: test.info().outputPath(`${px}-${c.name.replace(/\W+/g, '-')}.png`) });
			}
		});
	}
});
