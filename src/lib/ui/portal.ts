/**
 * Move an element to the end of <body>, so a popover opened from inside a scrolling or stacked
 * area (like the storyboard's tracks) is never clipped or covered by what's around that area.
 */
export function portal(node: HTMLElement) {
	document.body.appendChild(node);
	return {
		destroy() {
			node.remove();
		}
	};
}
