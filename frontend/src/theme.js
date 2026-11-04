import { createTheme, alpha } from '@mui/material/styles';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/plus-jakarta-sans/wght.css';

// Colour tokens. The whole app is styled from these, so re-skinning means changing this block only.
export const BRAND = {
  50: '#EEF2FF', 100: '#E0E7FF', 200: '#C7D2FE', 300: '#A5B4FC', 400: '#818CF8', 500: '#6366F1',
  600: '#4F46E5', 700: '#4338CA', 800: '#3730A3', 900: '#312E81', 950: '#1E1B4B',
};
export const VIOLET = '#7C3AED';
export const GREY = {
  25: '#FCFCFD', 50: '#F9FAFB', 100: '#F2F4F7', 200: '#EAECF0', 300: '#D0D5DD', 400: '#98A2B3',
  500: '#667085', 600: '#475467', 700: '#344054', 800: '#1D2939', 900: '#101828',
};
export const ACCENT = BRAND[600];
export const GRADIENT = `linear-gradient(135deg, ${BRAND[950]} 0%, ${BRAND[700]} 58%, ${VIOLET} 100%)`;
export const SHADOW = {
  xs: '0 1px 2px rgba(16,24,40,.05)',
  sm: '0 1px 3px rgba(16,24,40,.08), 0 1px 2px rgba(16,24,40,.04)',
  md: '0 4px 8px -2px rgba(16,24,40,.08), 0 2px 4px -2px rgba(16,24,40,.04)',
  lg: '0 12px 16px -4px rgba(16,24,40,.08), 0 4px 6px -2px rgba(16,24,40,.03)',
  xl: '0 20px 24px -4px rgba(16,24,40,.10), 0 8px 8px -4px rgba(16,24,40,.04)',
};
// Recharts needs raw colours. The two series hues pass the colour-blind and 3:1 contrast checks on white.
export const CHART = { series: [BRAND[600], '#E8702A'], single: BRAND[600], grid: GREY[200], axis: GREY[500], cursor: alpha(BRAND[600], 0.06) };

const HEADING = '"Plus Jakarta Sans Variable", "Inter Variable", system-ui, sans-serif';
const BODY = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const STATUS = ['success', 'warning', 'error', 'info'];
const ring = (c) => `0 0 0 4px ${alpha(c, 0.14)}`;

// soft = tinted background, ink = readable text on that background (all inks are 4.5:1 or better).
const palette = {
  primary: { main: BRAND[600], light: BRAND[400], dark: BRAND[700], soft: BRAND[50], ink: BRAND[700], 100: BRAND[100], 200: BRAND[200], contrastText: '#fff' },
  secondary: { main: BRAND[600], light: BRAND[400], dark: BRAND[700], soft: BRAND[50], ink: BRAND[700], contrastText: '#fff' },
  success: { main: '#079455', light: '#47CD89', dark: '#067647', soft: '#ECFDF3', ink: '#067647', contrastText: '#fff' },
  warning: { main: '#DC6803', light: '#FDB022', dark: '#B54708', soft: '#FFFAEB', ink: '#B54708', contrastText: '#fff' },
  error: { main: '#D92D20', light: '#F97066', dark: '#B42318', soft: '#FEF3F2', ink: '#B42318', contrastText: '#fff' },
  info: { main: '#1570EF', light: '#53B1FD', dark: '#175CD3', soft: '#EFF8FF', ink: '#175CD3', contrastText: '#fff' },
  grey: GREY,
  background: { default: '#F5F6FA', paper: '#FFFFFF' },
  text: { primary: GREY[900], secondary: GREY[600], disabled: GREY[400] },
  divider: GREY[200],
  action: { active: GREY[500], hover: alpha(GREY[500], 0.07), selected: alpha(BRAND[600], 0.08) },
};

const shadows = ['none', SHADOW.xs, SHADOW.sm, SHADOW.sm, SHADOW.md, SHADOW.md, SHADOW.md, SHADOW.lg, SHADOW.lg, ...Array(16).fill(SHADOW.xl)];

export const theme = createTheme({
  palette,
  shadows,
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: BODY,
    h1: { fontFamily: HEADING }, h2: { fontFamily: HEADING }, h3: { fontFamily: HEADING },
    h4: { fontFamily: HEADING, fontWeight: 800, letterSpacing: -0.6 },
    h5: { fontFamily: HEADING, fontWeight: 800, letterSpacing: -0.4, fontSize: '1.5rem' },
    h6: { fontFamily: HEADING, fontWeight: 700, letterSpacing: -0.2 },
    subtitle1: { fontFamily: HEADING, fontWeight: 700, letterSpacing: -0.1 },
    subtitle2: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    overline: { fontWeight: 700, letterSpacing: 1.2, fontSize: 11, lineHeight: 2 },
    caption: { lineHeight: 1.5 },
  },
  components: {
    // Read the screen size on the first render (no server rendering here). Otherwise phones first build the
    // desktop version of every page (data grids included) and then rebuild it for the small screen.
    MuiUseMediaQuery: { defaultProps: { noSsr: true } },
    MuiCssBaseline: {
      styleOverrides: {
        body: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale', fontFeatureSettings: '"cv11", "ss01"' },
        '::selection': { backgroundColor: BRAND[100] },
        '*': { scrollbarWidth: 'thin', scrollbarColor: `${GREY[300]} transparent` },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-thumb': { backgroundColor: GREY[300], borderRadius: 8, border: '2px solid transparent', backgroundClip: 'content-box' },
        '*::-webkit-scrollbar-thumb:hover': { backgroundColor: GREY[400] },
        a: { color: BRAND[600] },
        '@media print': { '.no-print': { display: 'none !important' } },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: ({ ownerState }) => ({
          borderRadius: 10,
          paddingInline: 16,
          transition: 'background-color .15s, box-shadow .15s, border-color .15s, color .15s',
          '&.Mui-focusVisible': { boxShadow: ring(palette[ownerState.color]?.main || BRAND[600]) },
          ...(ownerState.variant === 'contained' && ownerState.color !== 'inherit' && {
            boxShadow: `${SHADOW.xs}, inset 0 1px 0 ${alpha('#fff', 0.14)}`,
            '&:hover': { boxShadow: SHADOW.sm },
          }),
          // Outlined buttons are neutral (white with a grey border) unless they carry a status or brand colour.
          ...(ownerState.variant === 'outlined' && ownerState.color === 'primary' && {
            borderColor: GREY[300], color: GREY[700], backgroundColor: '#fff', boxShadow: SHADOW.xs,
            '&:hover': { borderColor: GREY[300], backgroundColor: GREY[50], color: GREY[900] },
          }),
          ...(ownerState.variant === 'outlined' && ownerState.color === 'secondary' && {
            borderColor: BRAND[200], color: BRAND[700], backgroundColor: '#fff',
            '&:hover': { borderColor: BRAND[300], backgroundColor: BRAND[50] },
          }),
          ...(ownerState.variant === 'text' && ownerState.color === 'primary' && { color: BRAND[700], '&:hover': { backgroundColor: BRAND[50] } }),
        }),
        sizeLarge: { paddingBlock: 10, fontSize: 15, borderRadius: 12 },
        sizeSmall: { borderRadius: 8, paddingInline: 12 },
      },
    },
    MuiIconButton: { styleOverrides: { root: { '&.Mui-focusVisible': { boxShadow: ring(BRAND[600]) } } } },
    MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: `1px solid ${GREY[200]}`, borderRadius: 16, boxShadow: SHADOW.xs } } },
    MuiCardActionArea: { styleOverrides: { focusHighlight: { backgroundColor: BRAND[600] } } },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: 14 }, outlined: { borderColor: GREY[200] } } },
    MuiPopover: { styleOverrides: { paper: { border: `1px solid ${GREY[200]}`, borderRadius: 12, boxShadow: SHADOW.lg, marginTop: 4 } } },
    MuiMenu: { styleOverrides: { paper: { border: `1px solid ${GREY[200]}`, borderRadius: 12, boxShadow: SHADOW.lg }, list: { padding: 4 } } },
    MuiMenuItem: { styleOverrides: { root: { borderRadius: 8, fontSize: 14, minHeight: 38, '&.Mui-selected': { backgroundColor: BRAND[50], color: BRAND[700] } } } },
    MuiAutocomplete: { styleOverrides: { paper: { border: `1px solid ${GREY[200]}`, borderRadius: 12, boxShadow: SHADOW.lg, marginTop: 4 }, listbox: { padding: 4, '& .MuiAutocomplete-option': { borderRadius: 8 } }, groupLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: GREY[500], lineHeight: '32px' } } },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme: t }) => ({ borderRadius: 20, boxShadow: SHADOW.xl, border: 'none', [t.breakpoints.down('sm')]: { margin: 12, maxHeight: 'calc(100% - 24px)', borderRadius: 16 } }),
        paperFullWidth: ({ theme: t }) => ({ [t.breakpoints.down('sm')]: { width: 'calc(100% - 24px)' } }),
        paperFullScreen: { margin: 0, maxHeight: 'none', borderRadius: 0 },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontFamily: HEADING, fontWeight: 700, fontSize: 18, paddingTop: 20 } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '12px 24px 20px', gap: 4 } } },
    // Blur only on desktop: on phones it makes the menu and dialog animations stutter.
    MuiBackdrop: { styleOverrides: { root: ({ ownerState, theme: t }) => (ownerState.invisible ? {} : { backgroundColor: alpha(GREY[900], 0.45), [t.breakpoints.up('md')]: { backdropFilter: 'blur(3px)' } }) } },
    MuiDrawer: { styleOverrides: { paper: { borderRight: 'none' } } },
    MuiChip: {
      styleOverrides: {
        root: ({ ownerState }) => {
          const c = ownerState.color;
          // Status chips are soft (tinted background, dark text); selected filter chips stay solid brand.
          if (ownerState.variant !== 'outlined' && STATUS.includes(c)) {
            const p = palette[c];
            return {
              backgroundColor: p.soft, color: p.ink, boxShadow: `inset 0 0 0 1px ${alpha(p.main, 0.2)}`,
              '& .MuiChip-icon': { color: p.main },
              '& .MuiChip-deleteIcon': { color: alpha(p.ink, 0.6) },
              ...(ownerState.clickable && { '&:hover': { backgroundColor: alpha(p.main, 0.14) } }),
            };
          }
          if (ownerState.variant === 'outlined' && c === 'default') return { borderColor: GREY[300], color: GREY[700], backgroundColor: '#fff' };
          if (ownerState.variant !== 'outlined' && c === 'default') return { backgroundColor: GREY[100], color: GREY[700] };
          return {};
        },
        label: { fontWeight: 600 },
        sizeSmall: { height: 24, fontSize: 12 },
      },
    },
    MuiAvatar: { styleOverrides: { root: { fontWeight: 700 } } },
    MuiBadge: { styleOverrides: { badge: { fontWeight: 700, boxShadow: '0 0 0 2px #fff' } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 10, backgroundColor: '#fff', transition: 'box-shadow .15s',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: GREY[300] },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: GREY[400] },
          '&.Mui-focused': { boxShadow: ring(BRAND[600]) },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: BRAND[500], borderWidth: 1 },
          '&.Mui-error.Mui-focused': { boxShadow: ring(palette.error.main) },
          '&.Mui-disabled': { backgroundColor: GREY[50] },
        },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { color: GREY[600] } } },
    MuiFormHelperText: { styleOverrides: { root: { marginLeft: 2 } } },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: { tooltip: { backgroundColor: GREY[900], fontSize: 12.5, fontWeight: 500, borderRadius: 8, padding: '6px 10px', boxShadow: SHADOW.lg }, arrow: { color: GREY[900] } },
    },
    MuiTabs: { styleOverrides: { root: { minHeight: 44 }, indicator: { height: 3, borderRadius: '3px 3px 0 0' } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, fontSize: 14, minHeight: 44, color: GREY[500], '&:hover': { color: GREY[800] } } } },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: { backgroundColor: GREY[100], padding: 3, borderRadius: 11, gap: 2 },
        grouped: { border: '0 !important', borderRadius: '8px !important', margin: '0 !important' },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none', fontWeight: 600, color: GREY[600], border: 0, paddingInline: 14,
          '&:hover': { backgroundColor: alpha(GREY[500], 0.08) },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: '#fff', color: GREY[900], boxShadow: SHADOW.sm },
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: { width: 42, height: 24, padding: 0, margin: 8 },
        switchBase: ({ ownerState }) => ({
          padding: 2,
          '&.Mui-checked': { transform: 'translateX(18px)', color: '#fff', '& + .MuiSwitch-track': { opacity: 1, backgroundColor: palette[ownerState.color]?.main || BRAND[600] } },
        }),
        thumb: { width: 20, height: 20, boxShadow: SHADOW.sm },
        track: { borderRadius: 12, opacity: 1, backgroundColor: GREY[300] },
      },
    },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 6, height: 8, backgroundColor: GREY[100] }, bar: { borderRadius: 6 } } },
    MuiAlert: {
      styleOverrides: {
        root: ({ ownerState }) => {
          const p = palette[ownerState.severity || ownerState.color] || palette.info;
          return {
            borderRadius: 12,
            ...(ownerState.variant === 'standard' && { backgroundColor: p.soft, color: GREY[800], border: `1px solid ${alpha(p.main, 0.22)}`, '& .MuiAlert-icon': { color: p.main } }),
          };
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: GREY[200] },
        sizeSmall: ({ theme: t }) => ({ [t.breakpoints.down('sm')]: { paddingLeft: 10, paddingRight: 10 } }),
        head: { fontWeight: 600, color: GREY[600], backgroundColor: GREY[50], fontSize: 13 },
      },
    },
    MuiListItemButton: { styleOverrides: { root: { '&.Mui-selected': { backgroundColor: BRAND[50] } } } },
    MuiDataGrid: {
      styleOverrides: {
        root: { border: 'none', '--DataGrid-containerBackground': GREY[50], '--DataGrid-rowBorderColor': GREY[200], fontSize: 14, color: GREY[800] },
        columnHeaderTitle: { fontWeight: 600, color: GREY[600], fontSize: 13 },
        row: { cursor: 'pointer', '&:hover': { backgroundColor: alpha(BRAND[600], 0.04) } },
        cell: { '&:focus, &:focus-within': { outline: 'none' } },
        footerContainer: { borderColor: GREY[200] },
      },
    },
  },
});
