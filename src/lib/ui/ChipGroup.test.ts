import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ChipGroup from './ChipGroup.svelte';

const options = [
	{ value: 0.5, label: '0.5×' },
	{ value: 1, label: '1×' },
	{ value: 2, label: '2×' }
];

describe('ChipGroup', () => {
	it('is a radio group with one checked chip', () => {
		render(ChipGroup, { props: { options, value: 1, label: 'Speed' } });
		expect(screen.getByRole('radiogroup', { name: 'Speed' })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: '1×' })).toHaveAttribute('aria-checked', 'true');
		expect(screen.getByRole('radio', { name: '2×' })).toHaveAttribute('tabindex', '-1');
	});

	it('selects on click and with arrow keys', async () => {
		const onchange = vi.fn();
		render(ChipGroup, { props: { options, value: 1, label: 'Speed', onchange } });
		await fireEvent.click(screen.getByRole('radio', { name: '2×' }));
		expect(onchange).toHaveBeenLastCalledWith(2);
		await fireEvent.keyDown(screen.getByRole('radio', { name: '2×' }), { key: 'ArrowRight' });
		expect(onchange).toHaveBeenLastCalledWith(0.5);
		expect(screen.getByRole('radio', { name: '0.5×' })).toHaveFocus();
	});
});
