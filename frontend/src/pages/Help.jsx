import { useNavigate } from 'react-router-dom';
import { Accordion, AccordionDetails, AccordionSummary, Avatar, Box, Button, Chip, Grid, Paper, Stack, Typography } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ArrowForward from '@mui/icons-material/ArrowForward';
import PlayCircleOutline from '@mui/icons-material/PlayCircleOutline';
import { useAuth } from '../store/auth';
import { DEMO_PASSWORD, DEMO_SCRIPT, GLOSSARY, WELCOME } from '../config/guide';
import { PageHeader, SectionCard } from '../components/common';

const FAQ = [
  ['What do the colours mean?', 'Green is on target or on time. Amber means attention is needed — for tickets, 75% of the allowed time has been used. Red means a target or deadline has been missed. Every colour also has an icon or label, so you never have to rely on colour alone.'],
  ['How is ticket priority decided?', 'From the problem type and how critical the equipment is. For example, an HVAC problem on a high-criticality AHU becomes P2. Helpdesk and supervisors can change it, but must give a reason.'],
  ['Why was my check-in flagged?', 'Check-ins are flagged when you are outside the property boundary, or later than your shift start plus the grace period. Your supervisor reviews flags under Attendance → Exceptions.'],
  ['What happens if nobody responds to a ticket?', 'The supervisor is warned at 75% of the SLA time. If the deadline passes, the Property Manager is alerted, and later the client/owner.'],
  ['How does stock change?', 'Only through movements: goods receipts, issues to a job, returns, transfers, adjustments and stock-count variances. The ledger keeps every movement with the balance after it, and stock can never go negative.'],
  ['Can I work without mobile signal?', 'Yes, in the installed app. Check-ins, checklists, photos and job updates are saved on the phone and sent automatically — with the time you really did them — when the signal returns. The top bar shows how many are waiting.'],
  ['How do I get alerts on my phone?', 'Open My profile → Phone notifications and press Turn on (technicians also see a prompt on Today). Alerts arrive even when the app is closed.'],
  ['What does the QR scanner do?', 'Tap the QR icon at the top and point the camera at a sticker. An equipment QR opens its page (or a new ticket for tenants); a location QR starts a ticket for that spot.'],
  ['Can I use this on my phone?', 'Yes. Technicians, guards, tenants and vendors get a phone-friendly layout with tabs at the bottom. You can also add it to your home screen from the browser menu.'],
  ['How do I start the demo again?', 'An admin or the Property Manager can reset all demo data under Admin → System jobs → Reset demo data.'],
];

export default function Help() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const role = user?.roles?.map((r) => r.key).find((k) => WELCOME[k]);
  const w = WELCOME[role];
  return (
    <Box>
      <PageHeader title="Help center" subtitle="Everything you need to get going, in plain language." />
      <Grid container spacing={2}>
        {w && (
          <Grid item xs={12} md={6}>
            <SectionCard title={`Getting started: ${user.roles.find((r) => r.key === role)?.name}`} subtitle={w.intro} action={<Button size="small" startIcon={<PlayCircleOutline />} onClick={() => window.dispatchEvent(new Event('ps-welcome'))}>Show welcome again</Button>}>
              <Stack spacing={1.25}>
                {w.steps.map(([title, text, to], i) => (
                  <Paper key={title} variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', cursor: 'pointer', '&:hover': { borderColor: 'secondary.main' } }} onClick={() => navigate(to)}>
                    <Avatar sx={{ bgcolor: 'primary.soft', color: 'primary.ink', fontWeight: 800, width: 32, height: 32, fontSize: 14 }}>{i + 1}</Avatar>
                    <Box sx={{ flex: 1 }}><Typography fontWeight={700}>{title}</Typography><Typography variant="body2" color="text.secondary">{text}</Typography></Box>
                    <ArrowForward color="action" />
                  </Paper>
                ))}
              </Stack>
            </SectionCard>
          </Grid>
        )}
        <Grid item xs={12} md={w ? 6 : 12}>
          <SectionCard title="Live demo: one complaint, start to finish" subtitle={`Sign out and sign in as each role in turn. Password for every demo account: ${DEMO_PASSWORD}`}>
            <Stack spacing={1}>
              {DEMO_SCRIPT.map(([role_, email, text], i) => (
                <Stack key={i} direction="row" spacing={1.5} alignItems="flex-start" sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Avatar sx={{ width: 26, height: 26, fontSize: 13, fontWeight: 800, bgcolor: 'primary.main' }}>{i + 1}</Avatar>
                  <Box>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><Chip size="small" color="secondary" label={role_} /><Typography variant="caption" color="text.secondary">{email}</Typography></Stack>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>{text}</Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionCard title="Common questions" noPad>
            <Box sx={{ px: 1, pb: 1 }}>
              {FAQ.map(([qq, a]) => (
                <Accordion key={qq} disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
                  <AccordionSummary expandIcon={<ExpandMore />}><Typography fontWeight={600}>{qq}</Typography></AccordionSummary>
                  <AccordionDetails><Typography variant="body2" color="text.secondary">{a}</Typography></AccordionDetails>
                </Accordion>
              ))}
            </Box>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionCard title="Glossary" subtitle="Words you will see around the app">
            <Stack spacing={1.25}>
              {GLOSSARY.map(([term, def]) => <Box key={term}><Typography fontWeight={700} component="span">{term}</Typography><Typography variant="body2" color="text.secondary" component="span"> — {def}</Typography></Box>)}
            </Stack>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
