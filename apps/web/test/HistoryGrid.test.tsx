import type { SeasonHistory } from '@gridiron/contracts';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HistoryGrid } from '../src/components/HistoryGrid';
import { theme } from '../src/theme';

/** Four weeks in: three played, the fourth still to come. */
const weeks: SeasonHistory['weeks'] = [
  { week: 1, settled: true },
  { week: 2, settled: true },
  { week: 3, settled: true },
  { week: 4, settled: false },
];

const rows: SeasonHistory['rows'] = [
  {
    memberId: 1,
    displayName: 'Leader',
    claimed: true,
    isSelf: false,
    rank: 1,
    seasonPoints: 19,
    points: [11, 8, 0, 0],
  },
  {
    memberId: 2,
    displayName: 'Me',
    claimed: true,
    isSelf: true,
    rank: 2,
    seasonPoints: 9,
    points: [5, 3, 1, 0],
  },
  {
    memberId: 3,
    displayName: 'Imported Player',
    claimed: false,
    isSelf: false,
    rank: 3,
    seasonPoints: 0,
    points: [0, 0, 0, 0],
  },
];

function renderGrid(overrides: Partial<Parameters<typeof HistoryGrid>[0]> = {}) {
  render(
    <ThemeProvider theme={theme}>
      <HistoryGrid weeks={weeks} rows={rows} {...overrides} />
    </ThemeProvider>,
  );
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

describe('HistoryGrid', () => {
  it('gives every week of the season its own column', () => {
    renderGrid();

    // Rank, player, four weeks, total.
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  });

  it("shows each member's week totals and their season total", () => {
    renderGrid();

    const cells = within(rowFor('Me')).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual(['2', 'Me', '5', '3', '1', '—', '9']);
  });

  /**
   * A week nobody has played and a week somebody scored nothing are both zero. Only
   * the week's own state separates them, so an unplayed cell is deliberately blank.
   */
  it('blanks an unplayed week but prints a real zero', () => {
    renderGrid();

    const leader = within(rowFor('Leader')).getAllByRole('cell');
    // Week 3 was played and scored nothing; week 4 has not happened.
    expect(leader[4]).toHaveTextContent('0');
    expect(leader[5]).toHaveTextContent('—');
  });

  /**
   * The name column is pinned and the screen is a phone, so the row carries the name
   * and nothing else — "Unclaimed" belongs on the standings table, where there is
   * room for it.
   */
  it('gives the player column to the name alone', () => {
    renderGrid();

    const cells = within(rowFor('Imported Player')).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('Imported Player');
    expect(screen.queryByText('Unclaimed')).not.toBeInTheDocument();
  });

  it('says so when the league has no members', () => {
    renderGrid({ rows: [] });

    expect(screen.getByText(/Nobody has joined this league yet/u)).toBeInTheDocument();
  });
});
