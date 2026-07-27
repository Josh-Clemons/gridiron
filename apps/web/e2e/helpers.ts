import {
  type Board,
  boardSchema,
  type Game,
  type League,
  leagueSchema,
  teamsResponseSchema,
} from '@gridiron/contracts';
import { type Slot, SLOT_LABELS, SLOTS } from '@gridiron/rules';
import { expect, type Page } from '@playwright/test';

/**
 * Helpers for driving the real app against the real API.
 *
 * Nothing here stubs anything. Where a test needs to know a fact about the world —
 * which teams play in week 1, what the invite code is — it asks the API through
 * `page.request`, which shares the page's cookie jar, and parses the answer with the
 * same contract schema the app itself uses. So a server that drifts fails the smoke
 * with a parse error naming the field, rather than as a mystery timeout on a locator.
 */

/** Accounts are never cleaned up, so every run needs its own. */
export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${String(Date.now())}-${String(Math.floor(Math.random() * 10_000))}@example.test`;
}

export const PASSWORD = 'e2e-correct-horse-battery';

export interface TestUser {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

/** Register through the form, not the API — signing up is part of what's being tested. */
export async function registerThroughUi(page: Page, tag: string): Promise<TestUser> {
  const user: TestUser = {
    email: uniqueEmail(tag),
    password: PASSWORD,
    displayName: `E2E ${tag}`,
  };

  await page.goto('/register');
  await page.getByLabel('Display name').fill(user.displayName);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.getByRole('heading', { name: 'Your leagues' })).toBeVisible();
  return user;
}

/** Create a league through the dialog and return the id the router navigated to. */
export async function createLeagueThroughUi(page: Page, name: string): Promise<number> {
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByLabel('League name').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page).toHaveURL(/\/leagues\/\d+/u);
  const match = /\/leagues\/(\d+)/u.exec(page.url());
  expect(match?.[1], 'league id in the URL').toBeDefined();
  return Number(match?.[1]);
}

async function getJson(page: Page, path: string): Promise<unknown> {
  const response = await page.request.get(`/api${path}`);
  expect(response.ok(), `GET ${path} → ${String(response.status())}`).toBe(true);
  return response.json();
}

export async function fetchLeague(page: Page, leagueId: number): Promise<League> {
  return leagueSchema.parse(await getJson(page, `/leagues/${String(leagueId)}`));
}

/** The live week, exactly as the page gets it — including which games are locked. */
export async function fetchBoard(page: Page, leagueId: number, week?: number): Promise<Board> {
  const query = week === undefined ? '' : `?week=${String(week)}`;
  return boardSchema.parse(await getJson(page, `/leagues/${String(leagueId)}/board${query}`));
}

/**
 * Team code → full name, which is what the picker's buttons are labelled with.
 *
 * `TeamButton` sets `aria-label` to the team's name, so a test that wants to click
 * "the home team of the first game" has to translate the code the board speaks into
 * the name the button announces.
 */
export async function fetchTeamNames(page: Page): Promise<ReadonlyMap<string, string>> {
  const { teams } = teamsResponseSchema.parse(await getJson(page, '/teams'));
  return new Map(teams.map((team) => [team.code, team.name]));
}

export function teamName(names: ReadonlyMap<string, string>, code: string): string {
  const name = names.get(code);
  if (name === undefined) throw new Error(`GET /teams did not include ${code}`);
  return name;
}

/** The earliest game still open for picking, which every rule test builds on. */
export function firstOpenGame(board: Board): Game {
  const game = board.games.find((candidate) => !candidate.locked);
  if (game === undefined) {
    throw new Error(`week ${String(board.week)} has no unlocked games — nothing is pickable`);
  }
  return game;
}

export interface PlannedPick {
  readonly slot: Slot;
  /** The `aria-label` on the slot card that opens this slot's picker. */
  readonly cardLabel: string;
  readonly teamId: string;
}

/**
 * A legal week: one team per slot, each from a different unlocked game.
 *
 * Different games because rule 4 forbids both sides of one game in the same week, and
 * unlocked because rule 9 forbids picking after kickoff. Reading them off the real
 * schedule rather than hardcoding codes is what keeps this working in September, when
 * the live week is no longer week 1 and half its games have already started.
 */
export function planWeekPicks(board: Board): readonly PlannedPick[] {
  const open = board.games.filter((game) => !game.locked);
  return SLOTS.flatMap((slot, index) => {
    const game = open[index];
    return game === undefined
      ? []
      : [{ slot, cardLabel: `${SLOT_LABELS[slot]} slot`, teamId: game.homeTeam }];
  });
}
