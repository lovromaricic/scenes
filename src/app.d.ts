// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

/** Local Font Access API (Chrome and Edge). */
declare global {
	interface FontData {
		family: string;
		fullName: string;
		postscriptName: string;
		style: string;
		blob(): Promise<Blob>;
	}
	interface Window {
		queryLocalFonts?: (options?: { postscriptNames?: string[] }) => Promise<FontData[]>;
	}
}

export {};
