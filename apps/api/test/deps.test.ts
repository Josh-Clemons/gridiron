import { describe, expect, it } from 'vitest';
import { ImporterError, importerFailureMessage, runCommand } from '../src/deps';

/**
 * The subprocess seam, without the importer itself.
 *
 * `runImporterCli` shells out to a fixed command (`pnpm exec tsx ../importer/...`), so
 * the pieces that matter — output capture, the deadline, the failure-message policy —
 * are tested here against `node -e`, which honours the same contract.
 */
describe('runCommand', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const { code, stdout, stderr } = await runCommand(
      'node',
      ['-e', 'console.log("report"); console.error("noise");'],
      { timeoutMs: 10_000 },
    );

    expect(code).toBe(0);
    expect(stdout).toContain('report');
    expect(stderr).toContain('noise');
  });

  it('returns a non-zero exit code rather than throwing', async () => {
    const { code, stderr } = await runCommand(
      'node',
      ['-e', 'console.error("no such sheet"); process.exit(1);'],
      { timeoutMs: 10_000 },
    );

    expect(code).toBe(1);
    expect(stderr).toContain('no such sheet');
  });

  it('kills a child that outlives the deadline', async () => {
    const started = Date.now();
    const promise = runCommand('node', ['-e', 'setTimeout(() => {}, 30_000);'], {
      timeoutMs: 100,
    });

    await expect(promise).rejects.toBeInstanceOf(ImporterError);
    await expect(promise).rejects.toThrow('did not finish');
    // Killed, not waited out — the whole point is that nothing hangs for 30 seconds.
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe('importerFailureMessage', () => {
  it('passes a clean operator-facing sentence through', () => {
    expect(importerFailureMessage(1, '\nno "Scores & Ranking" sheet in this workbook\n')).toBe(
      'no "Scores & Ranking" sheet in this workbook',
    );
  });

  it('hides a crash behind a pointer to the log', () => {
    const crash =
      'Error: something exploded\n    at runImport (/app/apps/importer/src/import.ts:12:9)\n    at main (/app/apps/importer/src/cli.ts:80:3)';
    expect(importerFailureMessage(1, crash)).toBe(
      'the importer failed unexpectedly — see the API log',
    );
  });

  it('names the exit code when the importer said nothing', () => {
    expect(importerFailureMessage(3, '')).toBe('the importer exited with code 3');
  });
});
