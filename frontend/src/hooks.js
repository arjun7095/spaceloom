import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { useMediaQuery, useTheme } from '@mui/material';
import { useAuth, can } from './store/auth';

// Re-renders every `ms` so timers stay current.
export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export const useMobile = () => useMediaQuery(useTheme().breakpoints.down('md'));

export function usePerm() {
  const user = useAuth((s) => s.user);
  return { user, can: (p) => can(user, p) };
}

// Mutation with success / error snackbars and query invalidation.
export function useAction(fn, { success, invalidate = [], onSuccess } = {}) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  return useMutation({
    mutationFn: fn,
    networkMode: 'always',
    onSuccess: (data, vars) => {
      if (data?.queued) enqueueSnackbar('No signal — saved on this phone. It will sync automatically when you are back online.', { variant: 'info' });
      else if (success) enqueueSnackbar(typeof success === 'function' ? success(data, vars) : success, { variant: 'success' });
      invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onSuccess?.(data, vars);
    },
    onError: (e) => enqueueSnackbar(e.message, { variant: 'error' }),
  });
}
