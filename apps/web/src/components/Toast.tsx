import Alert, { type AlertColor } from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { createContext, type ReactNode, use, useCallback, useMemo, useState } from 'react';

interface ToastState {
  readonly message: string;
  readonly severity: AlertColor;
  readonly key: number;
}

export interface ToastApi {
  readonly show: (message: string, severity?: AlertColor) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

/**
 * One transient message at a time, and it stays until it's dismissed or superseded.
 *
 * The old app's rejection toast auto-closed after one second and reverted the field
 * behind it, so the usual experience was a pick vanishing for no visible reason. Six
 * seconds is long enough to read a sentence; errors wait for a dismissal.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | undefined>();

  const show = useCallback((message: string, severity: AlertColor = 'info') => {
    setToast({ message, severity, key: Date.now() });
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext value={api}>
      {children}
      <Snackbar
        key={toast?.key}
        open={toast !== undefined}
        autoHideDuration={toast?.severity === 'error' ? null : 6000}
        onClose={() => {
          setToast(undefined);
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={toast?.severity ?? 'info'}
          variant="filled"
          onClose={() => {
            setToast(undefined);
          }}
          sx={{ width: '100%' }}
        >
          {toast?.message}
        </Alert>
      </Snackbar>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const api = use(ToastContext);
  // A no-op rather than a throw: a component rendered in a test without the provider
  // should still render, and a missing toast is never the interesting failure.
  return api ?? NOOP;
}

const NOOP: ToastApi = {
  show: () => {
    // Nothing to show it in.
  },
};
