import { useEffect, useState } from 'react';
import { useGateway } from '../gateway/context';
import { useAuthUser } from '../gateway/auth';

export interface WorkspaceMemberOption { id: string; userId: number; name: string; email: string; initials: string }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';

export function useWorkspaceMembers(fallback: WorkspaceMemberOption[] = []) {
  const gateway = useGateway();
  const auth = useAuthUser();
  const [members, setMembers] = useState(fallback);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(gateway.mode === 'live' ? 'loading' : 'ready');
  useEffect(() => {
    if (gateway.mode !== 'live' || !gateway.domains.workspaceMembers) { setMembers(fallback); setStatus('ready'); return; }
    let active = true; setStatus('loading');
    void gateway.domains.workspaceMembers.list()
      .then((rows) => { if (active) { setMembers(rows.map((row) => ({ id: String(row.userId), userId: row.userId, name: row.name, email: row.email, initials: initials(row.name) }))); setStatus('ready'); } })
      .catch(() => { if (active) { setMembers([]); setStatus('error'); } });
    return () => { active = false; };
  }, [gateway]); // identity/server changes rebuild the gateway
  return { members, status, currentUserId: auth?.user.id ?? null };
}
