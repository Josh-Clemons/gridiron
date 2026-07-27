import {
  createTheme,
  type PaletteColor,
  type SimplePaletteColorOptions,
} from '@mui/material/styles';
import type { Slot } from '@gridiron/rules';

/**
 * The palette lives here and only here.
 *
 * The old app copy-pasted `#1C2541` and `#5BC0BE` through its components — the same
 * two hex values appeared in a dozen files, so a colour could never be changed in one
 * place. Those colours are kept, because the pool recognises them, but every component
 * now reads them off the theme.
 */
const NAVY = '#1C2541';
const TEAL = '#5BC0BE';

/**
 * Win / Place / Show are horse-racing slots, so they get the podium's own colours.
 * Nothing depends on them for meaning — every slot is labelled in words too — but they
 * make a glanced-at pick grid readable in the two seconds it gets on a phone.
 */
export interface SlotPalette {
  readonly win: PaletteColor;
  readonly place: PaletteColor;
  readonly show: PaletteColor;
}

declare module '@mui/material/styles' {
  interface Palette {
    slot: SlotPalette;
  }
  interface PaletteOptions {
    slot?: Record<Slot, SimplePaletteColorOptions>;
  }
}

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: NAVY, light: '#3A506B', dark: '#0B132B', contrastText: '#FFFFFF' },
    secondary: { main: TEAL, light: '#8AD5D3', dark: '#3E8C8A', contrastText: '#0B132B' },
    success: { main: '#2E7D32' },
    error: { main: '#B3261E' },
    warning: { main: '#8A6100' },
    background: { default: '#F4F6FA', paper: '#FFFFFF' },
    slot: {
      win: { main: '#B8860B', light: '#E5C35C', dark: '#7A5A07', contrastText: '#FFFFFF' },
      place: { main: '#6B7A8F', light: '#A6B2C2', dark: '#485468', contrastText: '#FFFFFF' },
      show: { main: '#A05A2C', light: '#D08C5A', dark: '#6E3C1B', contrastText: '#FFFFFF' },
    },
  },
  typography: {
    fontFamily: "'Inter Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
    h1: { fontSize: '1.75rem', fontWeight: 700 },
    h2: { fontSize: '1.375rem', fontWeight: 700 },
    h3: { fontSize: '1.125rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Safe-area padding: picks get made on phones, often one-handed at the bottom
        // of a notched screen.
        body: {
          paddingBottom: 'env(safe-area-inset-bottom)',
          WebkitTapHighlightColor: 'transparent',
        },
      },
    },
    MuiButtonBase: {
      // Every tap target is at least 44px, which is the smallest thing a thumb hits
      // reliably. The old pick page used 54 native selects at browser defaults.
      styleOverrides: { root: { minHeight: 44 } },
    },
    MuiContainer: {
      defaultProps: { maxWidth: 'md' },
    },
  },
});
