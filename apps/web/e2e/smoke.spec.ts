// Browser steps are sequential by nature — a pick can't be made until the dialog from
// the previous one has closed — so awaiting inside a loop is the correct shape here,
// not an oversight. `Promise.all` would race three writes at one board.
// oxlint-disable eslint/no-await-in-loop

import { expect, test } from '@playwright/test';
import {
  createLeagueThroughUi,
  fetchBoard,
  fetchLeague,
  fetchTeamNames,
  firstOpenGame,
  planWeekPicks,
  registerThroughUi,
  teamName,
} from './helpers';

/**
 * The end-to-end smoke, against a live API and a live database.
 *
 * This is the check the plan asks for by name, and the only one in the suite that
 * proves the parts fit together: the session cookie survives the dev proxy, the router
 * guard lets a signed-in user through, an auto-saved pick reaches Postgres, and a
 * reload gets it back. Everything else in the web app is tested with props and jsdom.
 *
 * It runs twice — desktop and Pixel 5 — because "a full week of picks can be made on a
 * phone" is the phase's stated finish line, and the team picker is a genuinely
 * different component at that width.
 */

test('register, create a league, admit a second player, and make a week of picks that survive a reload', async ({
  page,
  browser,
  baseURL,
}) => {
  // Two registrations, a join, and three round-tripped picks.
  test.slow();

  const commissioner = await registerThroughUi(page, 'commish');
  const leagueId = await createLeagueThroughUi(page, `E2E ${String(Date.now())}`);

  const league = await fetchLeague(page, leagueId);
  await expect(page.getByRole('heading', { name: league.name })).toBeVisible();
  // The invite code is on the league page because it is how the other 71 arrive.
  await expect(page.getByText(league.inviteCode, { exact: true })).toBeVisible();

  await test.step('a second player joins with the invite code', async () => {
    // Its own context, so it gets its own session cookie rather than sharing the
    // commissioner's. The device emulation of the running project isn't reproduced
    // here on purpose: the mobile-specific surface is the pick page, which the primary
    // `page` exercises, and joining is one form either way.
    const joinerContext = await browser.newContext(baseURL === undefined ? {} : { baseURL });
    try {
      const joiner = await joinerContext.newPage();
      await registerThroughUi(joiner, 'joiner');

      await joiner.getByLabel('Invite code').fill(league.inviteCode);
      await joiner.getByRole('button', { name: 'Look up' }).click();

      await expect(joiner.getByRole('heading', { name: league.name })).toBeVisible();
      await joiner.getByRole('button', { name: 'Join league' }).click();

      // Landing on the league's own page is the join succeeding.
      await expect(joiner).toHaveURL(new RegExp(`/leagues/${String(leagueId)}`, 'u'));
      await expect(joiner.getByText(league.inviteCode, { exact: true })).toBeVisible();
    } finally {
      await joinerContext.close();
    }
  });

  const board = await fetchBoard(page, leagueId);
  const names = await fetchTeamNames(page);
  const planned = planWeekPicks(board);
  expect(planned, 'three unlocked games in the live week').toHaveLength(3);

  await test.step('fill all three slots, with no save button anywhere', async () => {
    await page.reload();

    for (const pick of planned) {
      await page.getByRole('button', { name: pick.cardLabel }).click();

      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: teamName(names, pick.teamId), exact: true }).click();

      // The dialog closes on selection and the card shows the team immediately —
      // that immediacy is the optimistic write, before the server has answered.
      await expect(dialog).toBeHidden();
      await expect(page.getByRole('button', { name: pick.cardLabel })).toContainText(pick.teamId);
    }
  });

  await test.step('the picks are in the database, not just the cache', async () => {
    const stored = await fetchBoard(page, leagueId, board.week);
    expect(stored.picks.map((pick) => `${pick.slot}:${pick.teamId}`).toSorted()).toEqual(
      planned.map((pick) => `${pick.slot}:${pick.teamId}`).toSorted(),
    );
    // Made in the app, not imported off the commissioner's workbook.
    expect(stored.picks.map((pick) => pick.source)).toEqual(['app', 'app', 'app']);
  });

  await test.step('and they come back after a reload', async () => {
    await page.reload();

    for (const pick of planned) {
      await expect(page.getByRole('button', { name: pick.cardLabel })).toContainText(pick.teamId);
    }
    // The second player is really in the league, counted from the server's standings.
    await expect(page.getByRole('link', { name: 'See all 2' })).toBeVisible();
  });

  await test.step('the session survives, and signing out ends it', async () => {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/u);

    // The guard, not just a redirect: the league page is unreachable without a session.
    await page.goto(`/leagues/${String(leagueId)}`);
    await expect(page).toHaveURL(/\/login/u);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(commissioner.email);
    await page.getByLabel('Password').fill(commissioner.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Signing in returns to where the guard turned us away, picks intact.
    await expect(page).toHaveURL(new RegExp(`/leagues/${String(leagueId)}`, 'u'));
    for (const pick of planned) {
      await expect(page.getByRole('button', { name: pick.cardLabel })).toContainText(pick.teamId);
    }
  });
});

/**
 * The phase's actual finish line: "illegal options are visibly unavailable rather than
 * rejected after the fact."
 *
 * The old app let you select an illegal team, flashed a red toast for one second, and
 * put the field back. This asserts the opposite — the option is disabled before it can
 * be chosen, and it carries the rules engine's own sentence explaining why.
 */
test('an illegal team is greyed out with its reason, not rejected after the click', async ({
  page,
}) => {
  await registerThroughUi(page, 'rules');
  const leagueId = await createLeagueThroughUi(page, `E2E Rules ${String(Date.now())}`);

  const board = await fetchBoard(page, leagueId);
  const names = await fetchTeamNames(page);
  const game = firstOpenGame(board);

  await page.reload();
  await page.getByRole('button', { name: 'Win slot' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: teamName(names, game.homeTeam), exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Win slot' })).toContainText(game.homeTeam);

  await page.getByRole('button', { name: 'Place slot' }).click();
  const dialog = page.getByRole('dialog');

  // Rule 4: you cannot have both sides of one game in a week.
  const opponent = dialog.getByRole('button', { name: teamName(names, game.awayTeam) });
  await expect(opponent).toBeDisabled();
  await expect(opponent).toContainText(
    `${game.awayTeam} plays ${game.homeTeam}, this week's Win pick`,
  );

  // Rule 3: and you cannot spend the same team on two slots in a week.
  const alreadyUsed = dialog.getByRole('button', { name: teamName(names, game.homeTeam) });
  await expect(alreadyUsed).toBeDisabled();
  await expect(alreadyUsed).toContainText(`${game.homeTeam} is already this week's Win pick`);
});
