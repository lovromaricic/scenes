/** Features Scenes needs. Checked once at start-up so unsupported browsers get a friendly page. */
export function missingFeatures(): string[] {
	const missing: string[] = [];
	if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined')
		missing.push('WebCodecs');
	if (typeof AudioContext === 'undefined') missing.push('Web Audio');
	if (typeof indexedDB === 'undefined') missing.push('IndexedDB');
	try {
		if (!document.createElement('canvas').getContext('webgl2')) missing.push('WebGL2');
	} catch {
		missing.push('WebGL2');
	}
	return missing;
}
