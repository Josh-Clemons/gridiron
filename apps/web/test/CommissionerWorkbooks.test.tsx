import type { Workbook } from '@gridiron/contracts';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CommissionerWorkbooks } from '../src/components/CommissionerWorkbooks';
import { theme } from '../src/theme';
import { ToastProvider } from '../src/components/Toast';

const applyWorkbook = vi.hoisted(() => vi.fn());

vi.mock('../src/api/mutations', () => ({
  uploadWorkbook: vi.fn(),
  applyWorkbook,
}));
vi.mock('../src/api/queries', () => ({
  adminWorkbooksQuery: (leagueId: number) => ({
    queryKey: ['workbooks', leagueId],
    queryFn: () => Promise.resolve(WORKBOOKS),
  }),
  seasonsQuery: () => ({
    queryKey: ['seasons'],
    queryFn: () => Promise.resolve([{ year: 2026, weekCount: 18, hasGames: true, hasPicks: true }]),
  }),
}));

/** Two uploads: the newest has findings, the older one is clean. */
let WORKBOOKS: Workbook[];

function workbook(id: number, name: string, report: Workbook['report']): Workbook {
  return {
    id,
    originalName: name,
    season: 2026,
    report,
    appliedAt: null,
    uploadedAt: '2026-09-01T12:00:00Z',
  };
}

const CLEAN_REPORT = {
  file: 'workbook.xlsx',
  leagueName: 'Grid Iron',
  year: 2026,
  weekCount: 18,
  playerCount: 72,
  picksInSheet: 100,
  importable: 100,
  written: { inserted: 0, updated: 0, unchanged: 0 },
  membersCreated: [],
  rejections: [],
  conflicts: [],
  crossCheck: [],
  scoring: [],
  removals: [],
  applied: false,
};

const FINDINGS_REPORT = {
  ...CLEAN_REPORT,
  importable: 98,
  rejections: [
    {
      playerName: 'Ben Hoy',
      week: 2,
      slot: 'win' as const,
      teamToken: 'PHI',
      reasons: ['already used at Win in week 1'],
    },
  ],
  conflicts: [
    {
      playerName: 'Kara Swan',
      week: 3,
      slot: 'show' as const,
      sheetTeam: 'KC',
      appTeam: 'BUF',
    },
  ],
};

function renderWorkbooks(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ThemeProvider theme={theme}>
          <CommissionerWorkbooks leagueId={1} />
        </ThemeProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('CommissionerWorkbooks', () => {
  it('shows each workbook its own report, not just the newest one', async () => {
    WORKBOOKS = [workbook(1, 'old.xlsx', CLEAN_REPORT), workbook(2, 'new.xlsx', FINDINGS_REPORT)];
    const user = userEvent.setup();

    renderWorkbooks();
    await screen.findByText('old.xlsx');
    expect(screen.queryByText('Latest validation report')).toBeNull();

    const reportButtons = await screen.findAllByRole('button', { name: 'Report' });
    await user.click(reportButtons[0]!);
    await screen.findByText('Validation report');
    // The older workbook's report is the clean one — one clean upload for each.
    expect(screen.getByText(/Clean — everything in the workbook would import/)).toBeVisible();
  });

  it('confirms before applying, and restates what validation found', async () => {
    WORKBOOKS = [workbook(2, 'new.xlsx', FINDINGS_REPORT)];
    const user = userEvent.setup();
    applyWorkbook.mockReset();

    renderWorkbooks();
    await user.click(await screen.findByRole('button', { name: 'Apply' }));

    // The findings are the confirmation: rejections and conflicts, with their cost.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('98 picks from 72 players');
    expect(dialog).toHaveTextContent('1 rejected (score 0)');
    expect(dialog).toHaveTextContent('1 conflict(s) (skipped)');
    expect(applyWorkbook).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply workbook' }));
    expect(applyWorkbook).toHaveBeenCalledWith(1, 2);
  });

  it('does not apply when the confirmation is cancelled', async () => {
    WORKBOOKS = [workbook(2, 'new.xlsx', FINDINGS_REPORT)];
    const user = userEvent.setup();
    applyWorkbook.mockReset();

    renderWorkbooks();
    await user.click(await screen.findByRole('button', { name: 'Apply' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(applyWorkbook).not.toHaveBeenCalled();
  });
});
