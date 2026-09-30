/** Drag-and-drop type for dragging something from "Your media" onto the storyboard. */
export const MEDIA_DRAG_TYPE = 'application/x-scenes-media';

export function dragHasMedia(event: DragEvent): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes(MEDIA_DRAG_TYPE);
}

/** Drag-and-drop type for dragging the Cards button onto the storyboard. */
export const CARD_DRAG_TYPE = 'application/x-scenes-card';

export function dragHasCard(event: DragEvent): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes(CARD_DRAG_TYPE);
}
