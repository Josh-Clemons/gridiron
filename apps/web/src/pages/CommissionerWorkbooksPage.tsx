import { useParams } from '@tanstack/react-router';
import { CommissionerWorkbooks } from '../components/CommissionerWorkbooks';

/** Workbook management on its own page — the default commissioner view in season. */
export function CommissionerWorkbooksPage() {
  const { leagueId } = useParams({ from: '/_authed/leagues/$leagueId' });
  return <CommissionerWorkbooks leagueId={Number(leagueId)} />;
}
