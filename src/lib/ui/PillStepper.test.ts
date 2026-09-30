import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import PillStepper from './PillStepper.svelte';

describe('PillStepper', () => {
	it('steps up and down and reports changes', async () => {
		const onchange = vi.fn();
		render(PillStepper, {
			props: { value: 4, step: 0.5, min: 0.5, max: 5, label: 'Length', onchange }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'More length' }));
		expect(screen.getByRole('status').textContent).toBe('4.5');
		expect(onchange).toHaveBeenLastCalledWith(4.5);
		await fireEvent.click(screen.getByRole('button', { name: 'Less length' }));
		expect(onchange).toHaveBeenLastCalledWith(4);
	});

	it('clamps to the limits and disables the button at the edge', async () => {
		render(PillStepper, { props: { value: 5, step: 1, min: 0, max: 5, label: 'Length' } });
		expect(screen.getByRole('button', { name: 'More length' })).toBeDisabled();
	});
});
