import type { TourStep } from '../components/GuidedTour';

/**
 * The guided tour's content, kept beside (not inside) the component: the app will
 * change, and steps are plain data that anyone can reword without touching behaviour.
 *
 * Member steps anchor to the league's tab bar, which is on screen wherever the tour
 * starts — no navigation. The commissioner section then walks the workbook loop on
 * the Workbooks page, so its steps carry the `onEnter` that moves there.
 */

/** The tour every member gets: the five tabs, one sentence each. */
export const memberTourSteps: readonly TourStep[] = [
  {
    anchor: 'tour-tab-picks',
    title: 'Make your picks',
    body: 'Pick three teams each week - one each for Win (5 pts), Place (3), and Show (1). All three winning is a Trifecta worth 2 bonus points. Each pick locks when its game kicks off.',
  },
  {
    anchor: 'tour-tab-usage',
    title: 'Teams left',
    body: 'See which teams you still have available. A team can be used at most once per slot all season - three times in all - so spend them wisely.',
  },
  {
    anchor: 'tour-tab-standings',
    title: 'Standings',
    body: "Everyone's scores, week by week. Expand a row to see that member's picks once their games have kicked off.",
  },
  {
    anchor: 'tour-tab-history',
    title: 'History',
    body: 'Every past season, member by member, week by week.',
  },
  {
    anchor: 'tour-tab-champions',
    title: 'Champions',
    body: "The league's winners, all the way back to 2007.",
  },
];

/**
 * The commissioner's extra section, appended to the member steps. It walks the
 * weekly workbook loop on the Workbooks page, so it needs the move there - passed in
 * as a callback rather than a route, so this file stays free of router types.
 */
export function commissionerTourSteps(openWorkbooks: () => void): readonly TourStep[] {
  return [
    {
      anchor: 'tour-tab-admin',
      title: 'Commissioner tools',
      body: 'Your tools live here - the weekly spreadsheet, pick corrections, and the roster.',
    },
    {
      anchor: 'tour-workbooks-upload',
      onEnter: openWorkbooks,
      title: 'Upload the spreadsheet',
      body: 'Uploading runs the checks - nothing is imported until you confirm.',
    },
    {
      anchor: 'tour-workbooks-uploads',
      title: 'Read the report, then apply',
      body: "Each upload lists what it caught. Apply imports the picks, and asks you to confirm first. If a report says 'conflict', that's a member's own app pick - tell Josh.",
    },
    {
      anchor: 'tour-workbooks-download',
      title: 'Get your file back',
      body: 'Download your uploaded workbook, or a fresh copy rebuilt from the site.',
    },
  ];
}
