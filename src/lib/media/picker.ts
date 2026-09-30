/** Opens the system file picker. Must be called from a click. Resolves with [] if cancelled. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.multiple = multiple;
		input.style.display = 'none';
		input.addEventListener('change', () => {
			resolve(Array.from(input.files ?? []));
			input.remove();
		});
		input.addEventListener('cancel', () => {
			resolve([]);
			input.remove();
		});
		document.body.append(input);
		input.click();
	});
}

/** Whether a drag carries files (as opposed to text or an element being dragged). */
export function dragHasFiles(event: DragEvent): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
