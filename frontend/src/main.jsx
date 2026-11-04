import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { styled } from '@mui/material/styles';
import { MaterialDesignContent, SnackbarProvider } from 'notistack';
import 'leaflet/dist/leaflet.css';
import { GREY, SHADOW, theme } from './theme';

// Toasts: dark card for neutral messages, the theme's status colours for the rest.
const Toast = styled(MaterialDesignContent)(() => ({
  '&.notistack-MuiContent': { borderRadius: 12, fontFamily: theme.typography.fontFamily, fontWeight: 500, fontSize: 14, boxShadow: SHADOW.xl, padding: '6px 14px' },
  '&.notistack-MuiContent-default, &.notistack-MuiContent-info': { backgroundColor: GREY[900] },
  '&.notistack-MuiContent-success': { backgroundColor: theme.palette.success.dark },
  '&.notistack-MuiContent-warning': { backgroundColor: theme.palette.warning.dark },
  '&.notistack-MuiContent-error': { backgroundColor: theme.palette.error.dark },
}));
const TOASTS = { default: Toast, info: Toast, success: Toast, warning: Toast, error: Toast };
import { DialogProvider } from './components/common';
import App from './App';

const queryClient = new QueryClient({
  // offlineFirst: queries still run without signal so the service worker can answer from its cache.
  defaultOptions: { queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: false, networkMode: 'offlineFirst' }, mutations: { networkMode: 'always' } },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SnackbarProvider maxSnack={3} autoHideDuration={4000} anchorOrigin={{ vertical: 'top', horizontal: 'right' }} Components={TOASTS}>
          <DialogProvider>
            {/* Navigations are transitions: the current page stays until the next one has loaded (no full-screen spinner). */}
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <App />
            </BrowserRouter>
          </DialogProvider>
        </SnackbarProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
