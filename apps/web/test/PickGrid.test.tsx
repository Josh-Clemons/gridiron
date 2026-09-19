import type { Board, Team } from '@gridiron/contracts';
import type { Pick, Slot } from '@gridiron/rules';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PickGrid } from '../src/components/PickGrid';
import { theme } from '../src/theme';

/**
 * Week 3 of 2026, mid-Sunday-morning: the Thursday game is long over and the rest of
 * the week hasn't started. That single instant exercises both halves of rule 9.
 */
const NOW = new Date('2026-09-27T14:00:00Z');

const TEAMS = new Map<string, Team>(
  [
    ['KC', 'Kansas City Chiefs', 'Chiefs'],
    ['DEN', 'Denver Broncos', 'Broncos'],
    ['BUF', 'Buffalo Bills', 'Bills'],
    ['NYJ', 'New York Jets', 'Jets'],
    ['SF', 'San Francisco 49ers', '49ers'],
    ['SEA', 'Seattle Seahawks', 'Seahawks'],
  ].map(([code, name, shortName]) => [
    code ?? '',
    { code: code ?? '', name: name ?? '', shortName: shortName ?? '' },
  ]),
);

const board: Board = {
  season: { id: 1, year: 2026, weekCount: 18 },
  week: 3,
  now: NOW.toISOString(),
  games: [
    {
      id: 1,
      week: 3,
      homeTeam: 'DEN',
      awayTeam: 'KC',
      kickoff: '2026-09-25T00:15:00Z',
      status: 'final',
      winner: 'KC',
      locked: true,
    },
    {
      id: 2,
      week: 3,
      homeTeam: 'NYJ',
      awayTeam: 'BUF',
      kickoff: '2026-09-27T17:00:00Z',
      status: 'scheduled',
      winner: null,
      locked: false,
    },
    {
      id: 3,
      week: 3,
      homeTeam: 'SEA',
      awayTeam: 'SF',
      kickoff: '2026-09-27T20:05:00Z',
      status: 'scheduled',
      winner: null,
      locked: false,
    },
  ],
  picks: [
    {
      slot: 'win',
      week: 3,
      teamId: 'BUF',
      source: 'app',
      outcome: 'pending',
      points: 0,
      locked: false,
      updatedAt: NOW.toISOString(),
    },
  ],
  weekScore: { week: 3, base: 0, trifecta: 0, total: 0, settled: false },
  seasonPoints: 9,
  standings: [],
  seasonComplete: false,
};

/** SF is already spent at Win, back in week 1 — rule 6. */
const seasonPicks: Pick[] = [
  { week: 1, slot: 'win', teamId: 'SF' },
  { week: 3, slot: 'win', teamId: 'BUF' },
];

function renderGrid(overrides: Partial<Parameters<typeof PickGrid>[0]> = {}) {
  const onSelect = vi.fn<(slot: Slot, teamId: string) => void>();
  const onClear = vi.fn<(slot: Slot) => void>();

  render(
    <ThemeProvider theme={theme}>
      <PickGrid
        board={board}
        seasonPicks={seasonPicks}
        teams={TEAMS}
        now={NOW}
        onSelect={onSelect}
        onClear={onClear}
        {...overrides}
      />
    </ThemeProvider>,
  );

  return { onSelect, onClear, user: userEvent.setup() };
}

describe('PickGrid', () => {
  it('shows all three slots and the pick already made', () => {
    renderGrid();

    expect(screen.getByRole('button', { name: 'Win slot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place slot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show slot' })).toBeInTheDocument();

    expect(screen.getByText('BUF')).toBeInTheDocument();
    expect(screen.getAllByText('No pick')).toHaveLength(2);
  });

  /**
   * The whole point of the page. The old app let you choose an illegal team, then
   * reverted the field behind a toast that closed in a second.
   */
  it('greys out a team already used in this slot this season, and says why', async () => {
    const { user } = renderGrid();

    await user.click(screen.getByRole('button', { name: 'Win slot' }));

    expect(screen.getByRole('button', { name: /San Francisco 49ers/u })).toBeDisabled();
    // The wording is `describeRejection`'s, not this component's.
    expect(screen.getByText(/SF was already used at Win in week 1/u)).toBeInTheDocument();
  });

  it('greys out both sides of a game already picked this week', async () => {
    const { user } = renderGrid();

    await user.click(screen.getByRole('button', { name: 'Place slot' }));

    expect(screen.getByRole('button', { name: /Buffalo Bills/u })).toBeDisabled();
    expect(screen.getByText(/BUF is already this week's Win pick/u)).toBeInTheDocument();

    // Rule 8 — you cannot take both teams in one game.
    expect(screen.getByRole('button', { name: /New York Jets/u })).toBeDisabled();
    expect(screen.getByText(/NYJ plays BUF, this week's Win pick/u)).toBeInTheDocument();
  });

  it('locks a team whose game has kicked off', async () => {
    const { user } = renderGrid();

    await user.click(screen.getByRole('button', { name: 'Place slot' }));

    expect(screen.getByRole('button', { name: /Denver Broncos/u })).toBeDisabled();
    expect(screen.getByText(/DEN kicked off/u)).toBeInTheDocument();
  });

  it('reports a legal choice to its caller, once, with the slot it was made in', async () => {
    const { user, onSelect } = renderGrid();

    await user.click(screen.getByRole('button', { name: 'Place slot' }));
    await user.click(screen.getByRole('button', { name: /San Francisco 49ers/u }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('place', 'SF');
  });

  it('offers nothing to pick once every game has kicked off', () => {
    const later = new Date('2026-09-28T23:00:00Z');
    renderGrid({ now: later });

    expect(screen.getAllByText(/every game has kicked off/u).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Place slot' })).not.toBeInTheDocument();
  });

  it('clears a pick through the picker', async () => {
    const { user, onClear } = renderGrid();

    await user.click(screen.getByRole('button', { name: 'Win slot' }));
    await user.click(screen.getByRole('button', { name: 'Clear this pick' }));

    expect(onClear).toHaveBeenCalledExactlyOnceWith('win');
  });
});
