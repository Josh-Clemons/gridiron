/// <reference types="node" />
// Browser steps are sequential by nature - the tour's next step cannot be walked
// until the previous one has settled - so awaiting inside a loop is the correct shape
// here, not an oversight.
// oxlint-disable eslint/no-await-in-loop

import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { createLeagueThroughUi, fetchLeague, registerThroughUi } from './helpers';

/**
 * A platform admin who is a plain member of a league — exactly Josh's production
 * state — can open each league, see the Commissioner tab, and walk the whole guided
 * tour, commissioner section included, without the app dying.
 *
 * This spec exists because the tour shipped with two hooks below LeagueLayout's
 * pending/error early returns, so the first render of a still-loading league ran
 * fewer hooks than the second and React threw "rendered more hooks than during the
 * previous render" — a crash that only surfaced on a league whose data was not
 * already cached, which every jsdom test was. Hook order is now load-bearing here.
 */

function devDbUrl(): string {
  const line = execFileSync('grep', ['-h', '^DATABASE_URL=', '/home/josh/Projects/gridiron/.env'], {
    encoding: 'utf8',
  });
  return line.trim().slice('DATABASE_URL='.length);
}

function setAdmin(email: string): void {
  execFileSync(
    'psql',
    [
      devDbUrl(),
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `UPDATE users SET is_admin = true WHERE email = '${email}'`,
    ],
    { stdio: 'pipe' },
  );
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${String(error)}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

test('an admin who is a plain member of a league opens it, tour included, without dying', async ({
  page,
  browser,
  baseURL,
}) => {
  test.slow();
  const errors = collectErrors(page);

  const admin = await registerThroughUi(page, 'admin');
  const ownedLeague = await createLeagueThroughUi(page, `Owned ${String(Date.now())}`);
  const ownedName = (await fetchLeague(page, ownedLeague)).name;

  // A second player owns the other league; the admin joins it as a plain member.
  const otherContext = await browser.newContext(baseURL === undefined ? {} : { baseURL });
  let otherLeagueId = 0;
  let invite = '';
  try {
    const other = await otherContext.newPage();
    await registerThroughUi(other, 'other');
    otherLeagueId = await createLeagueThroughUi(other, `Other ${String(Date.now())}`);
    invite = (await fetchLeague(other, otherLeagueId)).inviteCode;
  } finally {
    await otherContext.close();
  }

  // Back to the league list, where the join form lives, and in as a plain member.
  await page.goto('/leagues');
  await page.getByLabel('Invite code').fill(invite);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('button', { name: 'Join league' })).toBeVisible();
  await page.getByRole('button', { name: 'Join league' }).click();
  await expect(page).toHaveURL(new RegExp(`/leagues/${String(otherLeagueId)}`, 'u'));

  // The platform admin flag, set out-of-band exactly like production.
  setAdmin(admin.email);

  const joinedName = (await fetchLeague(page, otherLeagueId)).name;

  await test.step('fresh direct load of the joined league (member there, admin)', async () => {
    // The goto is a full reload, so whatever tour the join left behind is gone and
    // this is exactly the user's situation: flag set, tour not yet seen, member of a
    // league they do not own. The tour opens over the page - the whole screen on a
    // phone - so the assertions target the tour itself, not what is beneath it.
    await page.goto(`/leagues/${String(otherLeagueId)}`);
    // Nine steps, not five: the commissioner section is appended for an admin.
    await expect(page.getByText('Step 1 of 9')).toBeVisible({ timeout: 10_000 });
  });

  await test.step('walk the whole tour, commissioner section included', async () => {
    for (let step = 0; step < 12; step += 1) {
      const finish = page.getByRole('button', { name: 'Finish', exact: true });
      if (await finish.isVisible()) {
        await finish.click();
        break;
      }
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByText(/Step \d+ of 9/u)).toBeVisible();
    }

    // Finished: gone, the workbooks page (the commissioner tour's last stop) is up,
    // and the league beneath - no longer covered - is the joined one.
    await expect(page.getByText(/Step \d+ of 9/u)).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Commissioner tools' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upload a workbook' })).toBeVisible();

    // The Commissioner tab is new for this user in this league they do not own.
    await expect(page.getByRole('tab', { name: 'Commissioner' })).toBeVisible();
  });

  await test.step('the tour does not return, and both leagues still open', async () => {
    await page.goto(`/leagues/${String(otherLeagueId)}`);
    await expect(page.getByRole('heading', { name: joinedName })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Step \d+ of 9/u)).toBeHidden();

    await page.goto(`/leagues/${String(ownedLeague)}`);
    await expect(page.getByRole('heading', { name: ownedName })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Step \d+ of 9/u)).toBeHidden();
  });

  expect(errors, 'no client-side errors across the whole walk').toEqual([]);
});
