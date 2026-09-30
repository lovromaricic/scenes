import { getContext, setContext } from 'svelte';
import type { EditorStore } from './editor.svelte';

const KEY = Symbol('editor');

export function provideEditor(store: EditorStore): EditorStore {
	return setContext(KEY, store);
}

export function useEditor(): EditorStore {
	const store = getContext<EditorStore | undefined>(KEY);
	if (!store) throw new Error('useEditor() must be used inside the editor');
	return store;
}
