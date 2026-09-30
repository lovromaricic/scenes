import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const FIXTURES = path.resolve('e2e/fixtures');
export const fixture = (name: string) => path.join(FIXTURES, name);

/** Import files through the real file picker. */
export async function importViaPicker(page: Page, names: string[], buttonName: RegExp | string) {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: buttonName }).first().click();
	await (await chooser).setFiles(names.map(fixture));
}

/** Import files by simulating a drag-and-drop of real files onto the page. */
export async function importViaDrop(page: Page, names: string[]) {
	const files = names.map((name) => ({
		name,
		type: name.endsWith('.jpg')
			? 'image/jpeg'
			: name.endsWith('.webm')
				? 'video/webm'
				: name.endsWith('.mp4')
					? 'video/mp4'
					: 'text/plain',
		data: readFileSync(fixture(name)).toString('base64')
	}));
	await page.evaluate((files) => {
		const dt = new DataTransfer();
		for (const f of files) {
			const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
			dt.items.add(new File([bytes], f.name, { type: f.type }));
		}
		const target = document.querySelector('main') ?? document.body;
		for (const type of ['dragenter', 'dragover', 'drop']) {
			target.dispatchEvent(
				new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })
			);
		}
	}, files);
}

type Scenes = {
	time: number;
	playing: boolean;
	duration: number;
	seek(t: number): void;
	player: {
		readPixel(x: number, y: number): [number, number, number, number] | null;
		isFrameReady(): boolean;
		audioStats(): { state: string; scheduled: number };
	};
};

/** Evaluate against the editor store exposed on window.__scenes. */
export function scenes<T>(page: Page, fn: (s: Scenes) => T): Promise<T> {
	return page.evaluate(`(${fn.toString()})(window.__scenes)`) as Promise<T>;
}

/** Colour at the centre of the preview once the exact frame is decoded. */
export async function centerColor(page: Page): Promise<[number, number, number]> {
	await expect
		.poll(() => scenes(page, (s) => s.player.isFrameReady()), { timeout: 10_000 })
		.toBe(true);
	// One more animation frame so the compositor has drawn it.
	await page.evaluate(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
	);
	return page.evaluate(() => {
		const canvas = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
		const s = (window as unknown as { __scenes: Scenes }).__scenes;
		const px = s.player.readPixel(Math.floor(canvas.width * 0.6), Math.floor(canvas.height * 0.6))!;
		return [px[0], px[1], px[2]] as [number, number, number];
	});
}

export function dominant([r, g, b]: [number, number, number]): string {
	if (r > 180 && g > 180 && b < 100) return 'yellow';
	if (r > 180 && g > 180 && b > 180) return 'white';
	if (r < 60 && g < 60 && b < 60) return 'black';
	if (r > 150 && g < 90 && b < 90) return 'red';
	if (g > 150 && r < 90 && b < 90) return 'green';
	if (b > 150 && r < 90 && g < 90) return 'blue';
	return `rgb(${r},${g},${b})`;
}

export async function seekTo(page: Page, t: number) {
	await page.evaluate((t) => (window as unknown as { __scenes: Scenes }).__scenes.seek(t), t);
}

/**
 * Sample the preview pixels inside the on-screen box of the first `.text-box` (the words' area),
 * after the compositor has drawn the current frame. Returns RGB triples.
 */
export async function textAreaPixels(page: Page, index = 0): Promise<[number, number, number][]> {
	await page.evaluate(
		() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
	);
	return page.evaluate((index) => {
		const canvas = document.querySelector('canvas[data-testid="preview"]') as HTMLCanvasElement;
		const box = document.querySelectorAll('.text-box')[index] as HTMLElement;
		const c = canvas.getBoundingClientRect();
		const b = box.getBoundingClientRect();
		const sx = canvas.width / c.width;
		const sy = canvas.height / c.height;
		const s = (window as unknown as { __scenes: Scenes }).__scenes;
		const out: [number, number, number][] = [];
		for (let i = 1; i < 12; i++) {
			for (let j = 1; j < 6; j++) {
				const x = Math.floor((b.left - c.left + (b.width * i) / 12) * sx);
				const y = Math.floor((b.top - c.top + (b.height * j) / 6) * sy);
				const p = s.player.readPixel(x, y)!;
				out.push([p[0], p[1], p[2]]);
			}
		}
		return out;
	}, index);
}

export const isInkish = ([r, g, b]: [number, number, number]) => r < 70 && g < 70 && b < 70;
export const isYellowish = ([r, g, b]: [number, number, number]) => r > 200 && g > 190 && b < 140;

/** Open the Project format panel from the top bar. */
export async function openFormat(page: Page) {
	await page.getByRole('button', { name: /^Project format:/ }).click();
	const panel = page.getByRole('dialog', { name: 'Project format' });
	await expect(panel).toBeVisible();
	return panel;
}

/** Set the project format through the panel: a shape, and optionally a size and frame rate. */
export async function setFormat(page: Page, shape: string, size?: string, fps?: number) {
	const panel = await openFormat(page);
	await panel
		.getByRole('radiogroup', { name: 'Shape' })
		.getByRole('radio', { name: new RegExp(`^${shape}`) })
		.click();
	if (size)
		await panel
			.getByRole('radiogroup', { name: 'Size' })
			.getByRole('radio', { name: size })
			.click();
	if (fps)
		await panel
			.getByRole('radiogroup', { name: 'Frame rate' })
			.getByRole('radio', { name: `${fps} fps` })
			.click();
	await page.keyboard.press('Escape');
	await expect(panel).toHaveCount(0);
}
