import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GuidedTour, type TourStep } from '../src/components/GuidedTour';
import { theme } from '../src/theme';

const steps: TourStep[] = [
  { title: 'First step', body: 'First body.' },
  { title: 'Second step', body: 'Second body.' },
];

function renderTour(onDone: () => void): void {
  render(
    <ThemeProvider theme={theme}>
      <GuidedTour steps={steps} onDone={onDone} />
    </ThemeProvider>,
  );
}

describe('GuidedTour', () => {
  it('walks the steps, back and forward, and finishes once', async () => {
    const onDone = vi.fn<() => void>();
    renderTour(onDone);

    expect(screen.getByText('First step')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Second step')).toBeInTheDocument();
    expect(screen.queryByText('First step')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('First step')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('skips straight to done', async () => {
    const onDone = vi.fn<() => void>();
    renderTour(onDone);

    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('spotlights an anchored step, and falls back to a dialog when the anchor never appears', async () => {
    // jsdom does not implement scrollIntoView; the tour calls it on a found anchor.
    Element.prototype.scrollIntoView = vi.fn<() => void>();

    const onEnter = vi.fn<() => void>();
    const anchored: TourStep[] = [
      { anchor: 'present', title: 'Anchored step', body: 'Spotlight.', onEnter },
      { anchor: 'absent', title: 'Missing step', body: 'Falls back.' },
    ];

    render(
      <ThemeProvider theme={theme}>
        <div id="present">the target</div>
        <GuidedTour steps={anchored} onDone={vi.fn<() => void>()} />
      </ThemeProvider>,
    );

    expect(onEnter).toHaveBeenCalledTimes(1);
    // The anchor exists (on the desktop layout jsdom answers with), so the
    // spotlight card replaces the dialog.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Anchored step')).toBeInTheDocument();

    // A step whose anchor never appears stays a plain dialog — the tour must not
    // break when the page changes shape.
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Missing step')).toBeInTheDocument();
  });
});
