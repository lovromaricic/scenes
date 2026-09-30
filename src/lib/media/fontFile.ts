import { parseStyleName } from '$lib/model/textStyle';

/**
 * Reads the family name, weight and italic from a font file. TrueType/OpenType (.ttf/.otf) files
 * are read from their 'name' and 'OS/2' tables. WOFF2 files are compressed (Brotli), so for those
 * the file name is used ("Pacifico-BoldItalic.woff2" → Pacifico, Bold Italic).
 */

export interface FontFileInfo {
	family: string;
	weight: number;
	italic: boolean;
}

export const FONT_FILE_ACCEPT = '.ttf,.otf,.woff2,font/ttf,font/otf,font/woff2';

export function isFontFile(name: string): boolean {
	return /\.(ttf|otf|woff2)$/i.test(name);
}

/** Family and style from a file name like "Open_Sans-SemiBoldItalic.ttf". */
export function infoFromFileName(name: string): FontFileInfo {
	const base = name.replace(/\.[^.]+$/, '');
	const [familyPart, stylePart = ''] = base.split(/[-_](?=[^-_]*$)/);
	const style = parseStyleName(stylePart);
	const knownStyle = /regular|italic|oblique|thin|light|medium|bold|black|heavy/i.test(stylePart);
	const family = (knownStyle ? familyPart : base)
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.trim();
	return {
		family: family || 'Uploaded font',
		...(knownStyle ? style : { weight: 400, italic: false })
	};
}

function readName(view: DataView, tableOffset: number, wanted: number[]): string | null {
	const count = view.getUint16(tableOffset + 2);
	const stringOffset = tableOffset + view.getUint16(tableOffset + 4);
	for (const nameId of wanted) {
		for (let i = 0; i < count; i++) {
			const rec = tableOffset + 6 + i * 12;
			const platform = view.getUint16(rec);
			const encoding = view.getUint16(rec + 2);
			const id = view.getUint16(rec + 6);
			if (id !== nameId) continue;
			const length = view.getUint16(rec + 8);
			const offset = stringOffset + view.getUint16(rec + 10);
			if (platform === 3 || platform === 0) {
				// UTF-16 big-endian.
				let s = '';
				for (let j = 0; j < length; j += 2) s += String.fromCharCode(view.getUint16(offset + j));
				if (s.trim()) return s.trim();
			} else if (platform === 1 && encoding === 0) {
				let s = '';
				for (let j = 0; j < length; j++) s += String.fromCharCode(view.getUint8(offset + j));
				if (s.trim()) return s.trim();
			}
		}
	}
	return null;
}

/** Read a TrueType/OpenType font's names and style; null if it isn't one. */
export function readSfntInfo(buffer: ArrayBuffer): FontFileInfo | null {
	const view = new DataView(buffer);
	if (buffer.byteLength < 12) return null;
	const tag = view.getUint32(0);
	// 0x00010000 = TrueType, 'OTTO' = CFF OpenType, 'true' = old Apple TrueType.
	if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;
	const numTables = view.getUint16(4);
	const tables = new Map<string, number>();
	for (let i = 0; i < numTables; i++) {
		const rec = 12 + i * 16;
		const name = String.fromCharCode(
			view.getUint8(rec),
			view.getUint8(rec + 1),
			view.getUint8(rec + 2),
			view.getUint8(rec + 3)
		);
		tables.set(name, view.getUint32(rec + 8));
	}
	const nameTable = tables.get('name');
	if (nameTable === undefined) return null;
	// 16/17 = typographic family/subfamily; 1/2 = legacy family/subfamily.
	const family = readName(view, nameTable, [16, 1]);
	const subfamily = readName(view, nameTable, [17, 2]) ?? 'Regular';
	if (!family) return null;
	let { weight, italic } = parseStyleName(subfamily);
	const os2 = tables.get('OS/2');
	if (os2 !== undefined) {
		const w = view.getUint16(os2 + 4);
		if (w >= 100 && w <= 900) weight = w;
		const fsSelection = view.getUint16(os2 + 62);
		italic = italic || (fsSelection & 1) === 1;
	}
	return { family, weight, italic };
}

export async function readFontFile(file: File): Promise<FontFileInfo> {
	if (/\.(ttf|otf)$/i.test(file.name)) {
		const info = readSfntInfo(await file.arrayBuffer());
		if (info) return info;
	}
	return infoFromFileName(file.name);
}
