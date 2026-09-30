import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { infoFromFileName, readSfntInfo } from './fontFile';

describe('font files', () => {
	it('reads the family and style from a TrueType file', () => {
		const buf = readFileSync('e2e/fixtures/Pacifico-Regular.ttf');
		const info = readSfntInfo(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
		expect(info).toEqual({ family: 'Pacifico', weight: 400, italic: false });
	});
	it('rejects files that aren’t fonts', () => {
		expect(readSfntInfo(new Uint8Array(64).buffer)).toBeNull();
	});
	it('guesses from the file name for WOFF2', () => {
		expect(infoFromFileName('Open_Sans-SemiBoldItalic.woff2')).toEqual({
			family: 'Open Sans',
			weight: 600,
			italic: true
		});
		expect(infoFromFileName('Pacifico.woff2')).toEqual({
			family: 'Pacifico',
			weight: 400,
			italic: false
		});
		expect(infoFromFileName('MyFont-Bold.woff2')).toEqual({
			family: 'My Font',
			weight: 700,
			italic: false
		});
	});
});
