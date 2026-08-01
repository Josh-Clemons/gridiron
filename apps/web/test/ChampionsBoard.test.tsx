import type { Champions } from '@gridiron/contracts';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChampionsBoard } from '../src/components/ChampionsBoard';
import { theme } from '../src/theme';

/**
 * The shape the real workbook produces: a tie, a year nobody won, and a champion from
 * long before anyone had an account.
 */
const pools: Champions['pools'] = [
  {
    pool: 'regular',
    years: [
      {
        year: 2022,
        champions: [
          {
            year: 2022,
            pool: 'regular',
            displayName: 'Kevin Fournier',
            memberId: null,
            totalPoints: 146,
            note: null,
          },
          {
            year: 2022,
            pool: 'regular',
            displayName: 'Meaghan Olender',
            memberId: 4,
            totalPoints: 146,
            note: null,
          },
        ],
      },
      {
        year: 2021,
        champions: [
          {
            year: 2021,
            pool: 'regular',
            displayName: 'Old Timer',
            memberId: null,
            totalPoints: null,
            note: null,
          },
        ],
      },
    ],
  },
  {
    pool: 'playoff',
    years: [
      {
        year: 2019,
        champions: [
          {
            year: 2019,
            pool: 'playoff',
            displayName: 'Playoff Winner',
            memberId: null,
            totalPoints: 24,
            note: null,
          },
        ],
      },
      { year: 2018, champions: [] },
      {
        year: 2017,
        champions: [
          {
            year: 2017,
            pool: 'playoff',
            displayName: 'Earlier Winner',
            memberId: null,
            totalPoints: 22,
            note: null,
          },
        ],
      },
    ],
  },
];

function renderBoard(value: Champions['pools'] = pools) {
  render(
    <ThemeProvider theme={theme}>
      <ChampionsBoard pools={value} />
    </ThemeProvider>,
  );
}

/** The row a year owns, so each assertion is scoped to one year of the board. */
function rowFor(year: string): HTMLElement {
  const row = screen.getByText(year).closest('tr');
  if (row === null) throw new Error(`no row for ${year}`);
  return row;
}

describe('ChampionsBoard', () => {
  it('separates the regular-season and playoff pools', () => {
    renderBoard();

    expect(screen.getByRole('heading', { name: 'Regular season' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Playoffs' })).toBeInTheDocument();
  });

  it('names both winners of a tied year', () => {
    renderBoard();

    const row = rowFor('2022');
    expect(within(row).getByText('Kevin Fournier')).toBeInTheDocument();
    expect(within(row).getByText('Meaghan Olender')).toBeInTheDocument();
  });

  /** 2018's playoff pool played no game. The year is still part of the history. */
  it('shows a year nobody won rather than skipping it', () => {
    renderBoard();

    expect(within(rowFor('2018')).getByText('No champion recorded')).toBeInTheDocument();
  });

  it('leaves the points blank for a champion the sheet recorded no score for', () => {
    renderBoard();

    const row = rowFor('2021');
    expect(within(row).getByText('Old Timer')).toBeInTheDocument();
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('explains where the list comes from when nothing has been imported', () => {
    renderBoard([]);

    expect(screen.getByText(/No champions have been imported yet/u)).toBeInTheDocument();
  });
});
