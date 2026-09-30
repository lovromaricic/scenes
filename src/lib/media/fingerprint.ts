/**
 * A content fingerprint for deduplicating imported files. Hashing a whole multi-gigabyte video
 * would mean reading all of it into memory (WebCrypto can't hash a stream), so this hashes the
 * size plus three 1 MB samples (start, middle, end). Files under 3 MB are hashed completely.
 * Two different real media files matching on all of that is practically impossible.
 */
const SAMPLE = 1024 * 1024;

export async function fingerprint(blob: Blob): Promise<string> {
	const parts: BlobPart[] = [new TextEncoder().encode(`size:${blob.size};`)];
	if (blob.size <= SAMPLE * 3) parts.push(blob);
	else {
		const mid = Math.floor(blob.size / 2 - SAMPLE / 2);
		parts.push(blob.slice(0, SAMPLE), blob.slice(mid, mid + SAMPLE), blob.slice(blob.size - SAMPLE));
	}
	const bytes = await new Blob(parts).arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
