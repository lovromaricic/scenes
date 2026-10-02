import type { LucideIcon } from '@lucide/svelte';

export type Icon = LucideIcon;

export interface Choice<T extends string | number = string> {
	value: T;
	label: string;
	/** Optional longer description, read by screen readers. */
	description?: string;
	/** Shown but can't be chosen (its description says why). */
	disabled?: boolean;
}

export interface Swatch<T extends string = string> extends Choice<T> {
	/** Any CSS background value, normally a mood token such as `var(--mood-golden)`. */
	background: string;
}

export interface ToolbarAction {
	id: string;
	label: string;
	icon: Icon;
	onclick?: () => void;
}

export interface MenuItem {
	label: string;
	icon?: Icon;
	/** Keyboard shortcut shown on the right, e.g. "⌘S". */
	shortcut?: string;
	/** Draw a line above this item, to group it with the ones after it. */
	separator?: boolean;
	disabled?: boolean;
	/** Why it can't be chosen, shown under it while it's disabled. */
	hint?: string;
	/** Removes something (shown in red). */
	danger?: boolean;
	onselect: () => void;
}
