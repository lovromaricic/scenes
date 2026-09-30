import type { LucideIcon } from '@lucide/svelte';

export type Icon = LucideIcon;

export interface Choice<T extends string | number = string> {
	value: T;
	label: string;
	/** Optional longer description, read by screen readers. */
	description?: string;
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
