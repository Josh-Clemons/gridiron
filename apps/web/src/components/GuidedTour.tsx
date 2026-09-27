import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Dialog from '@mui/material/Dialog';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useEffect, useState } from 'react';

/** One step of a guided tour: a title, a one-liner, and optionally an element to spotlight. */
export interface TourStep {
  /**
   * The DOM `id` of the element this step highlights. The step waits briefly for the
   * element to appear (a step that navigates first), then falls back to a dialog —
   * a tour must not break when the page changes shape.
   */
  readonly anchor?: string;
  /** Runs when the step starts — how a tour moves to the page its anchor lives on. */
  readonly onEnter?: () => void;
  readonly title: string;
  readonly body: string;
}

interface GuidedTourProps {
  readonly steps: readonly TourStep[];
  /**
   * Fired on Finish and on Skip alike — either way the viewer has had their chance
   * and should not be auto-toured again. Called at most once per mount.
   */
  readonly onDone: () => void;
}

const CARD_WIDTH = 400;
const SPOTLIGHT_PAD = 8;
const MARGIN = 16;
/** Roughly half a second of frames to wait for an anchor that is still rendering. */
const MAX_ANCHOR_FRAMES = 30;

/** A cleanup that does nothing — the no-anchor path of the follow effect below. */
const noop = (): void => {};

/**
 * The step card, shared by both presentations: spotlight-adjacent on desktop, and a
 * (full-screen on mobile) dialog when there is no anchor to sit beside.
 */
function TourCard({
  step,
  index,
  total,
  onBack,
  onAdvance,
  onDone,
}: {
  readonly step: TourStep;
  readonly index: number;
  readonly total: number;
  readonly onBack: () => void;
  readonly onAdvance: () => void;
  readonly onDone: () => void;
}) {
  const last = index === total - 1;
  return (
    <Stack spacing={1.5}>
      <Typography variant="h3">{step.title}</Typography>
      <Typography variant="body2" color="text.secondary">
        {step.body}
      </Typography>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mt={1}>
        <Button size="small" onClick={onDone}>
          Skip
        </Button>
        <Stack direction="row" spacing={1}>
          {index > 0 && (
            <Button size="small" variant="outlined" onClick={onBack}>
              Back
            </Button>
          )}
          <Button size="small" variant="contained" onClick={last ? onDone : onAdvance}>
            {last ? 'Finish' : 'Next'}
          </Button>
        </Stack>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {`Step ${String(index + 1)} of ${String(total)}`}
      </Typography>
    </Stack>
  );
}

/**
 * A first-visit walkthrough. One step at a time, each an anchor plus a sentence.
 *
 * Deliberately dumb: no tour state, no persistence, no knowledge of who is signed in.
 * The caller decides when to mount it and what finishing means, so the same component
 * serves any tour the app grows — the steps are plain data, and the app will change,
 * so the content lives beside the component, not inside it.
 */
export function GuidedTour({ steps, onDone }: GuidedTourProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [index, setIndex] = useState(0);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [done, setDone] = useState(false);

  const step = steps[index];
  const advance = (): void => {
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  };
  const back = (): void => {
    setIndex((current) => Math.max(current - 1, 0));
  };
  /** Once, no matter which exit was used — Escape, backdrop, Skip and Finish all land here. */
  const finish = (): void => {
    if (done) return;
    setDone(true);
    onDone();
  };

  // Runs once per step transition. Keyed on the index alone on purpose: the effect is
  // "the step changed", not "some parent re-rendered" — a refetched query behind the
  // tour must not re-run a step's navigation or restart its anchor lookup.
  useEffect(() => {
    const current = steps[index];
    setAnchorEl(null);
    setRect(null);
    current?.onEnter?.();

    let raf = 0;
    const anchorId = current?.anchor;
    if (anchorId !== undefined) {
      // A step may navigate to another page before its anchor exists, so the lookup
      // retries across a few animation frames rather than resolving exactly once.
      let frames = 0;
      const look = (): void => {
        const el = document.querySelector(`#${anchorId}`);
        if (el instanceof HTMLElement) {
          setAnchorEl(el);
          return;
        }
        if (frames < MAX_ANCHOR_FRAMES) {
          frames += 1;
          raf = requestAnimationFrame(look);
        }
      };
      look();
    }
    // Always a cleanup, anchor or not — `cancelAnimationFrame(0)` does nothing.
    return () => {
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // The spotlight follows its anchor: scroll and resize both move the rectangle.
  useEffect(() => {
    if (anchorEl === null || isMobile) return noop;
    const measure = (): void => {
      setRect(anchorEl.getBoundingClientRect());
    };
    anchorEl.scrollIntoView({ block: 'center' });
    measure();
    window.addEventListener('scroll', measure, { capture: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, { capture: true });
      window.removeEventListener('resize', measure);
    };
  }, [anchorEl, isMobile]);

  if (steps.length === 0 || step === undefined) return null;

  if (rect === null || isMobile) {
    return (
      <Dialog open fullScreen={isMobile} fullWidth maxWidth="sm" onClose={finish}>
        <Box sx={{ p: 3 }}>
          <TourCard
            step={step}
            index={index}
            total={steps.length}
            onBack={back}
            onAdvance={advance}
            onDone={finish}
          />
        </Box>
      </Dialog>
    );
  }

  // The spotlight: one element ringed by a shadow that darkens everything else.
  const spotlight = {
    top: rect.top - SPOTLIGHT_PAD,
    left: rect.left - SPOTLIGHT_PAD,
    width: rect.width + SPOTLIGHT_PAD * 2,
    height: rect.height + SPOTLIGHT_PAD * 2,
  };
  const left = Math.min(
    Math.max(spotlight.left, MARGIN),
    Math.max(window.innerWidth - CARD_WIDTH - MARGIN, MARGIN),
  );
  const below = spotlight.top + spotlight.height;
  const roomBelow = window.innerHeight - below > 260;
  const top = roomBelow ? below + MARGIN : Math.max(MARGIN, spotlight.top - 280);

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: theme.zIndex.tooltip }}>
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: spotlight.top,
          left: spotlight.left,
          width: spotlight.width,
          height: spotlight.height,
          borderRadius: 2,
          border: `2px solid ${theme.palette.primary.main}`,
          boxShadow: '0 0 0 100vmax rgba(0, 0, 0, 0.5)',
        }}
      />
      <Card
        elevation={8}
        sx={{
          position: 'absolute',
          top,
          left,
          width: `min(${String(CARD_WIDTH)}px, calc(100vw - ${String(MARGIN * 2)}px))`,
          p: 2,
        }}
      >
        <TourCard
          step={step}
          index={index}
          total={steps.length}
          onBack={back}
          onAdvance={advance}
          onDone={finish}
        />
      </Card>
    </Box>
  );
}
