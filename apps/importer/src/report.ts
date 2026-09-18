import { SLOT_LABELS } from '@gridiron/rules';
import type { ImportResult } from './import';

/**
 * Render a run as text.
 *
 * The report is the product on most weeks — the operator reads it, talks to the
 * commissioner about anything surprising, and only then re-runs with `--apply`. So it
 * leads with what was refused and what disagrees, and keeps the counts at the end.
 */
export function renderReport(result: ImportResult): string {
  const out: string[] = [];
  const line = (text = ''): void => void out.push(text);

  line(result.file);
  line(
    `  ${result.leagueName} · ${String(result.year)} · ${String(result.weekCount)} weeks · ` +
      `${String(result.playerCount)} players · ${String(result.picksInSheet)} picks in the sheet`,
  );
  line();

  if (result.rejections.length > 0) {
    line(`REJECTED — ${String(result.rejections.length)} pick(s), left empty and scoring 0`);
    for (const rejection of sorted(result.rejections)) {
      line(
        `  ${rejection.playerName} · week ${String(rejection.week)} ${SLOT_LABELS[rejection.slot]} · ${rejection.teamToken}`,
      );
      for (const reason of rejection.reasons) line(`      ${reason}`);
    }
    line(
      '  Correct these in the sheet and re-import — each slot stays empty and scores 0 until then.',
    );
    line();
  }

  if (result.conflicts.length > 0) {
    line(
      `CONFLICTS — ${String(result.conflicts.length)}; neither pick imported, the app pick is untouched`,
    );
    for (const conflict of sorted(result.conflicts)) {
      line(
        `  ${conflict.playerName} · week ${String(conflict.week)} ${SLOT_LABELS[conflict.slot]} · ` +
          `sheet says ${conflict.sheetTeam}, the app holds ${conflict.appTeam}`,
      );
    }
    line();
  }

  if (result.scoring.length > 0) {
    line(`SCORING — ${String(result.scoring.length)} disagreement(s) with the sheet's arithmetic`);
    for (const finding of result.scoring) {
      const where =
        finding.kind === 'season'
          ? 'season total'
          : `week ${String(finding.week ?? 0)} ${finding.kind === 'slot' ? `${SLOT_LABELS[finding.slot ?? 'win']} ${finding.teamCode ?? ''}` : finding.kind}`;
      line(
        `  ${finding.playerName} · ${where} · sheet ${String(finding.sheet ?? 0)}, computed ${String(finding.computed)}`,
      );
    }
    line('  The app always uses its own figure; these are listed so the sheet can be corrected.');
    line();
  }

  if (result.crossCheck.length > 0) {
    line(
      `SELECTION HISTORY — ${String(result.crossCheck.length)} disagreement(s) with the main sheet`,
    );
    for (const finding of result.crossCheck) {
      if (finding.unreadable !== undefined) {
        line(
          `  ${finding.playerName} · ${finding.teamCode} ${SLOT_LABELS[finding.slot]} · ` +
            `unreadable week ${JSON.stringify(finding.unreadable)}`,
        );
        continue;
      }
      line(
        `  ${finding.playerName} · ${finding.teamCode} ${SLOT_LABELS[finding.slot]} · ` +
          `main sheet week ${String(finding.scoresWeek)}, tab says week ${String(finding.historyWeek ?? 0)}`,
      );
    }
    line(
      '  The main sheet wins. A run of these on one player is usually a whole week logged one column off.',
    );
    line();
  }

  if (result.removals.length > 0) {
    line(
      `REMOVED — ${String(result.removals.length)} previously imported pick(s) are no longer in the sheet`,
    );
    for (const removal of sorted(result.removals)) {
      line(
        `  ${removal.playerName} · week ${String(removal.week)} ${SLOT_LABELS[removal.slot]} · ${removal.teamCode}`,
      );
    }
    line();
  }

  if (result.membersCreated.length > 0) {
    const verb = result.applied ? 'Created' : 'Would create';
    line(
      `${verb} ${String(result.membersCreated.length)} member(s): ${result.membersCreated.join(', ')}`,
    );
    line();
  }

  if (result.applied) {
    line(
      `applied: ${String(result.written.inserted)} new, ${String(result.written.updated)} updated, ` +
        `${String(result.written.unchanged)} unchanged` +
        (result.removals.length > 0 ? `, ${String(result.removals.length)} removed` : ''),
    );
  } else {
    line(`dry run: ${String(result.importable)} pick(s) would be imported. Nothing was written.`);
    line('Re-run with --apply once the findings above have been read.');
  }

  return out.join('\n');
}

/** Stable ordering so two runs of the same file produce diffable reports. */
function sorted<T extends { playerName: string; week: number; slot: string }>(
  items: readonly T[],
): T[] {
  return [...items].toSorted(
    (a, b) =>
      a.playerName.localeCompare(b.playerName) || a.week - b.week || a.slot.localeCompare(b.slot),
  );
}
