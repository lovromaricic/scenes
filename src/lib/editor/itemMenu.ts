/**
 * The right-click menu of anything on the storyboard (a scene, or an item on an overlay or audio
 * track), the same everywhere: Rename, Copy, Cut, Paste, Duplicate, Split here, Extend to end of
 * video, then Delete (in red). Only what applies is shown, with its shortcut. With several items
 * selected (and the right-clicked one among them), it applies to all of them.
 */

import type { EditorStore } from '$lib/state/editor.svelte';
import type { MenuItem } from '$lib/ui';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`);
export const DELETE_SHORTCUT = isMac ? '⌫' : 'Delete';

/**
 * The menu for right-clicking `id` at time `t`. Call it after selecting what was right-clicked
 * (an item on a locked track can't be selected: its menu only says why it can't be deleted).
 * The items keep what they need: the menu closes (and forgets) before an item runs.
 */
export function itemMenu(editor: EditorStore, id: string, t: number): MenuItem[] {
	const p = editor.project;
	const ids = editor.selectedIds.includes(id) ? [...editor.selectedIds] : [id];
	const several = ids.length > 1;
	const scene = p.scenes.some((s) => s.id === id);
	const sound = p.sounds.some((s) => s.id === id);
	const locked = !!editor.trackOfItem(id)?.locked;
	const items: MenuItem[] = [];

	if (!locked) {
		if (!several) items.push({ label: 'Rename', onselect: () => (editor.renamingId = id) });
		if (!scene) {
			items.push({ label: 'Copy', shortcut: mod('C'), onselect: () => editor.copySelection() });
			items.push({ label: 'Cut', shortcut: mod('X'), onselect: () => editor.cutSelection() });
		}
		if (editor.canPaste) items.push({ label: 'Paste', shortcut: mod('V'), onselect: () => editor.paste() });
		items.push({
			label: several ? `Duplicate ${ids.length} items` : 'Duplicate',
			onselect: () => (scene ? editor.duplicateScene(id) : editor.duplicateItems(ids))
		});
		if (!several)
			items.push({
				label: 'Split here',
				shortcut: 'S',
				onselect: () => {
					editor.seek(t);
					if (scene) editor.splitAtPlayhead();
					else if (sound) editor.splitSoundAtPlayhead(id);
					else editor.splitItemAtPlayhead(id);
				}
			});
		if (!several && !scene)
			items.push({ label: 'Extend to end of video', onselect: () => editor.extendToEnd(id) });
	}

	const can = editor.deletable(ids);
	const count = can.ids.length || ids.length;
	items.push({
		label: count > 1 ? `Delete ${count} items` : 'Delete',
		shortcut: DELETE_SHORTCUT,
		separator: items.length > 0,
		danger: true,
		disabled: !can.ids.length,
		hint: can.reason,
		onselect: () => editor.deleteItems(can.ids)
	});
	return items;
}
