import Blend from '@lucide/svelte/icons/blend';
import Moon from '@lucide/svelte/icons/moon';
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import ZoomIn from '@lucide/svelte/icons/zoom-in';
import Plus from '@lucide/svelte/icons/plus';
import Scissors from '@lucide/svelte/icons/scissors';
import type { TransitionKind } from '$lib/model/types';
import type { Icon } from '$lib/ui';

/** Icon on the round button between cards (a cut shows "+", inviting you to add one). */
export const TRANSITION_BUTTON_ICONS: Record<TransitionKind, Icon> = {
	cut: Plus,
	crossfade: Blend,
	'fade-black': Moon,
	slide: ArrowRight,
	zoom: ZoomIn
};

/** Icon in the picker list. */
export const TRANSITION_ICONS: Record<TransitionKind, Icon> = {
	...TRANSITION_BUTTON_ICONS,
	cut: Scissors
};
