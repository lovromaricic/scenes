import { listFontFaces, putFontFace, type FontFaceRecord } from '$lib/media/db';
import { isFontFile, readFontFile } from '$lib/media/fontFile';
import { ensureFont, fontStatus, onFontsChange, type FontStatus } from '$lib/render/fonts';
import {
	BUILTIN_FONTS,
	faceLabel,
	parseStyleName,
	type FontSource,
	type TextFont
} from '$lib/model/textStyle';
import { newId } from './project';

/** A face on this computer, from the Local Font Access API. */
export interface LocalFace {
	family: string;
	fullName: string;
	postscriptName: string;
	weight: number;
	italic: boolean;
	data: FontData;
}

export type StoredFace = Omit<FontFaceRecord, 'blob'>;

export interface FaceChoice {
	weight: number;
	italic: boolean;
	label: string;
}

const RECENT_KEY = 'scenes:recent-fonts';
const MAX_RECENT = 6;

/**
 * Fonts the picker can offer: built in, on this computer (after permission), uploaded, and the
 * recently used ones. Also tracks loading so text boxes re-measure when a font arrives.
 */
export class FontLibrary {
	/** Bumps whenever a font finishes loading or fails; read it to react to font changes. */
	version = $state(0);
	/** Local and uploaded faces saved on this device. */
	stored = $state<StoredFace[]>([]);
	/** Families on this computer, once the user has allowed access. */
	localFamilies = $state.raw<Record<string, LocalFace[]>>({});
	localState = $state<'unsupported' | 'idle' | 'asking' | 'ready' | 'denied'>('idle');
	recent = $state<TextFont[]>([]);

	constructor() {
		if (typeof window === 'undefined') return;
		if (!('queryLocalFonts' in window)) this.localState = 'unsupported';
		onFontsChange(() => this.version++);
		try {
			this.recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
		} catch {
			this.recent = [];
		}
	}

	async init(): Promise<void> {
		this.stored = await listFontFaces().catch(() => []);
	}

	status(font: TextFont): FontStatus | undefined {
		void this.version;
		return fontStatus(font);
	}

	/** Ask for the fonts installed on this computer (shows the browser's permission prompt). */
	async requestLocal(): Promise<void> {
		if (this.localState === 'unsupported') return;
		this.localState = 'asking';
		try {
			const all = await window.queryLocalFonts!();
			const families: Record<string, LocalFace[]> = {};
			for (const data of all) {
				const { weight, italic } = parseStyleName(data.style);
				(families[data.family] ??= []).push({
					family: data.family,
					fullName: data.fullName,
					postscriptName: data.postscriptName,
					weight,
					italic,
					data
				});
			}
			this.localFamilies = families;
			this.localState = 'ready';
		} catch {
			this.localState = 'denied';
		}
	}

	/** Save a computer font's face so the project keeps working after a reload. */
	async useLocalFace(face: LocalFace): Promise<TextFont> {
		const existing = this.stored.find(
			(s) => s.source === 'local' && s.postscriptName === face.postscriptName
		);
		let id = existing?.id;
		if (!id) {
			id = newId();
			const record: FontFaceRecord = {
				id,
				family: face.family,
				source: 'local',
				weight: face.weight,
				italic: face.italic,
				postscriptName: face.postscriptName,
				blob: await face.data.blob(),
				createdAt: Date.now()
			};
			await putFontFace(record);
			const { blob: _blob, ...meta } = record;
			this.stored = [...this.stored, meta];
		}
		const font: TextFont = {
			family: face.family,
			source: 'local',
			weight: face.weight,
			italic: face.italic,
			id
		};
		await ensureFont(font);
		return font;
	}

	/** Store uploaded font files. Returns the first one as a font to use (or null if none worked). */
	async upload(files: File[]): Promise<{ font: TextFont | null; rejected: string[] }> {
		let first: TextFont | null = null;
		const rejected: string[] = [];
		for (const file of files) {
			if (!isFontFile(file.name)) {
				rejected.push(file.name);
				continue;
			}
			const info = await readFontFile(file);
			const id = newId();
			const record: FontFaceRecord = {
				id,
				...info,
				source: 'upload',
				blob: file,
				createdAt: Date.now()
			};
			const font: TextFont = {
				family: info.family,
				source: 'upload',
				weight: info.weight,
				italic: info.italic,
				id
			};
			await putFontFace(record);
			// Make sure it's really a font before keeping it in the list.
			if (!(await ensureFont(font))) {
				rejected.push(file.name);
				continue;
			}
			const { blob: _blob, ...meta } = record;
			this.stored = [...this.stored, meta];
			first ??= font;
		}
		return { font: first, rejected };
	}

	/** Families in a section, for the picker. */
	families(source: FontSource): string[] {
		if (source === 'builtin') return BUILTIN_FONTS.map((b) => b.family);
		if (source === 'upload')
			return unique(this.stored.filter((s) => s.source === 'upload').map((s) => s.family));
		return Object.keys(this.localFamilies).sort((a, b) => a.localeCompare(b));
	}

	/** The weights and styles a family has, for the chips under the font. */
	faces(font: TextFont): FaceChoice[] {
		let list: { weight: number; italic: boolean }[] = [];
		if (font.source === 'builtin') list = BUILTIN_FONTS.find((b) => b.id === font.id)?.faces ?? [];
		else if (font.source === 'upload')
			list = this.stored.filter((s) => s.source === 'upload' && s.family === font.family);
		else {
			list = [
				...(this.localFamilies[font.family] ?? []),
				...this.stored.filter((s) => s.source === 'local' && s.family === font.family)
			];
		}
		return list
			.filter((f, i) => list.findIndex((g) => g.weight === f.weight && g.italic === f.italic) === i)
			.sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight)
			.map((f) => ({ weight: f.weight, italic: f.italic, label: faceLabel(f.weight, f.italic) }));
	}

	/**
	 * The font for another face of the same family: built-in faces just change weight/italic;
	 * local and uploaded faces each have their own stored file.
	 */
	async faceFont(font: TextFont, weight: number, italic: boolean): Promise<TextFont | null> {
		if (font.source === 'builtin') return { ...font, weight, italic };
		const stored = this.stored.find(
			(s) =>
				s.source === font.source &&
				s.family === font.family &&
				s.weight === weight &&
				s.italic === italic
		);
		if (stored) return { ...font, id: stored.id, weight, italic };
		if (font.source === 'local') {
			const face = this.localFamilies[font.family]?.find(
				(f) => f.weight === weight && f.italic === italic
			);
			if (face) return this.useLocalFace(face);
		}
		return null;
	}

	addRecent(font: TextFont): void {
		const same = (a: TextFont) => a.family === font.family && a.source === font.source;
		this.recent = [font, ...this.recent.filter((f) => !same(f))].slice(0, MAX_RECENT);
		try {
			localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
		} catch {
			// Only a convenience.
		}
	}
}

function unique(list: string[]): string[] {
	return list.filter((v, i) => list.indexOf(v) === i).sort((a, b) => a.localeCompare(b));
}
