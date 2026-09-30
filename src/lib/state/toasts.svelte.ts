/** Short friendly messages shown at the bottom of the screen. */

export interface Toast {
	id: number;
	message: string;
	tone: 'info' | 'error';
}

let nextId = 1;

class Toasts {
	items = $state<Toast[]>([]);

	show(message: string, tone: Toast['tone'] = 'info', ms = tone === 'error' ? 7000 : 3500): void {
		const id = nextId++;
		this.items.push({ id, message, tone });
		setTimeout(() => this.dismiss(id), ms);
	}

	clear(): void {
		this.items = [];
	}

	dismiss(id: number): void {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toasts();
