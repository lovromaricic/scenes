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

/** Files dragged in from the computer. */
export function dragHasFiles(event: DragEvent): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/** Anything that can become a scene or a layer: "Your media", the Cards button, or files. */
export function dragHasVisual(event: DragEvent): boolean {
	return dragHasMedia(event) || dragHasCard(event) || dragHasFiles(event);
}

/** Photos and videos among dropped files (project files and other things are left out). */
export function droppedVisualFiles(event: DragEvent): File[] {
	return Array.from(event.dataTransfer?.files ?? []).filter(
		(f) => /^(image|video)\//.test(f.type) || /\.(jpe?g|png|webp|gif|heic|avif|mp4|mov|m4v|webm|mkv)$/i.test(f.name)
	);
}

/**
 * Put what was dropped where it belongs, via the given handlers. Returns false if the drop
 * carried nothing usable.
 */
export function handleVisualDrop(
	event: DragEvent,
	to: { media: (id: string) => void; card: () => void; files: (files: File[]) => void }
): boolean {
	const id = event.dataTransfer?.getData(MEDIA_DRAG_TYPE);
	if (id) {
		to.media(id);
		return true;
	}
	if (dragHasCard(event)) {
		to.card();
		return true;
	}
	const files = droppedVisualFiles(event);
	if (files.length) {
		to.files(files);
		return true;
	}
	return false;
}
