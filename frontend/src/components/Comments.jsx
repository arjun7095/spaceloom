import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client';
import { useAction } from '../hooks';
import { RefSelect } from './form';
import { SectionCard } from './common';
import { fmtDateTime } from '../utils/format';

// Comment input with an "@mention" picker; mentioned people get a notification.
export function CommentBox({ onPost, busy }) {
  const [text, setText] = useState('');
  const [people, setPeople] = useState([]);
  const send = () => {
    const prefix = people.map((p) => `@${p.name}`).join(' ');
    onPost(`${prefix ? `${prefix} ` : ''}${text.trim()}`, people.map((p) => p._id), () => { setText(''); setPeople([]); });
  };
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1}>
        <TextField placeholder="Write a comment…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && text.trim() && send()} />
        <Button variant="outlined" disabled={!text.trim() || busy} onClick={send}>Post</Button>
      </Stack>
      <RefSelect refTo="users" multiple label="@ Mention people (they get notified)" value={people.map((p) => p._id)} onChange={(ids, objs) => setPeople(objs)} />
    </Stack>
  );
}

export default function Comments({ entity, entityId, title = 'Comments' }) {
  const q = useQuery({ queryKey: ['comments', entity, entityId], queryFn: () => api.get('/comments', { entity, entityId }) });
  const post = useAction((b) => api.post('/comments', { entity, entityId, ...b }), { invalidate: ['comments'] });
  return (
    <SectionCard title={title} subtitle="Discuss this record; use @ to notify someone">
      <CommentBox busy={post.isPending} onPost={(text, mentions, reset) => post.mutate({ text, mentions }, { onSuccess: reset })} />
      <Stack spacing={1}>
        {(q.data || []).map((c) => (
          <Box key={c._id} sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 2 }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{c.text}</Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">{c.byName} · {fmtDateTime(c.createdAt)}</Typography>
              {c.mentions?.map((m) => <Chip key={m._id} size="small" variant="outlined" label={`@${m.name}`} />)}
            </Stack>
          </Box>
        ))}
        {!q.isLoading && !q.data?.length && <Typography variant="body2" color="text.secondary">No comments yet.</Typography>}
      </Stack>
    </SectionCard>
  );
}
