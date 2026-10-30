import { useEffect, useRef, useState } from 'react';
import type { ImportedChatMessage } from '../../../src/shared/chat-imports';
import { forSharedModule, useDomainEnvironment } from './useDomainEnvironment';

type State = {
  scope: string; items: ImportedChatMessage[]; cursor: string | null;
  phase: 'loading' | 'ready' | 'error' | 'unavailable'; busy: boolean; error: string | null;
  selectedId: string | null; detail: ImportedChatMessage | null; detailLoading: boolean; detailError: string | null;
};
const empty = (scope: string): State => ({ scope, items: [], cursor: null, phase: 'loading', busy: false, error: null,
  selectedId: null, detail: null, detailLoading: false, detailError: null });

/** Ephemeral private read projection. Mount only while the imported-history source is selected. */
export function useImportedChatHistory() {
  const env = forSharedModule(useDomainEnvironment(), 'private'), api = env.owner.chatApi;
  const scope = JSON.stringify([env.identityKey, env.scopeKey, env.userId, env.childId, env.sharedMode]);
  const latest = useRef({ env, scope }); latest.current = { env, scope };
  const [state, setState] = useState<State>(() => empty(scope)), snapshot = useRef(state), live = useRef(false);
  const listing = useRef<AbortController | null>(null), detailRead = useRef<AbortController | null>(null);
  const replace = (value: State) => { snapshot.current = value; setState(value); };
  const update = (key: string, patch: Partial<State>) => { if (snapshot.current.scope === key) replace({ ...snapshot.current, ...patch }); };
  const available = () => !env.sharedMode && !!env.childId && !!env.userId && env.current();
  function close() {
    if (latest.current.scope !== scope) return;
    detailRead.current?.abort(); detailRead.current = null;
    update(scope, { selectedId: null, detail: null, detailLoading: false, detailError: null });
  }
  function failed(error: unknown, key: string, detail: boolean) {
    const failure = error as { status?: number; code?: string | null; onlineCode?: string | null };
    const denied = [401, 403, 404].includes(failure.status ?? 0) || failure.code === 'session_changed' || failure.onlineCode === 'identity_changed';
    if (denied || !detail) {
      if (denied) { listing.current?.abort(); listing.current = null; }
      detailRead.current?.abort(); detailRead.current = null;
      update(key, { items: [], cursor: null, busy: false, phase: 'error', error: denied ? '目前無法讀取匯入對話，請重新核對身份及孩子權限。' : '未能讀取匯入對話，請重新讀取。',
        selectedId: null, detail: null, detailLoading: false, detailError: null });
    } else update(key, { detail: null, detailLoading: false, detailError: '未能讀取這份來源歷史，請返回清單重新讀取。' });
    if ([401, 403].includes(failure.status ?? 0) || failure.code === 'session_changed') env.accessError(failure);
  }
  async function read(more: boolean) {
    if (!live.current || !available() || !env.online || listing.current || more && !snapshot.current.cursor) return;
    if (!api?.listImportedMessages) { update(scope, { phase: 'unavailable', error: '匯入對話歷史暫未提供。' }); return; }
    const controller = new AbortController(); listing.current = controller;
    const current = () => live.current && latest.current.scope === scope && env.current() && !controller.signal.aborted;
    const before = snapshot.current;
    update(scope, { busy: true, error: null, phase: more ? before.phase : 'loading' });
    try {
      const page = await api.listImportedMessages(env.childId!, controller.signal, env.userId!, more ? before.cursor : null);
      if (!current()) return;
      const rows = more ? [...before.items] : [];
      for (const row of page.items) {
        const index = rows.findIndex(value => value.id === row.id);
        if (index < 0) rows.push(row); else rows[index] = row;
      }
      update(scope, { items: rows, cursor: page.nextCursor, phase: 'ready', busy: false });
    } catch (error) { if (current()) failed(error, scope, false); }
    finally { if (listing.current === controller) listing.current = null; }
  }
  async function open(item: ImportedChatMessage) {
    if (!live.current || !available() || !env.online || item.childId !== env.childId) return;
    detailRead.current?.abort();
    const controller = new AbortController(); detailRead.current = controller;
    const current = () => live.current && latest.current.scope === scope && env.current() && !controller.signal.aborted;
    update(scope, { selectedId: item.id, detail: null, detailLoading: true, detailError: null });
    try {
      if (!api?.getImportedMessage) throw Error('chat_import_unavailable');
      const value = await api.getImportedMessage(env.childId!, item.id, controller.signal, env.userId!);
      if (!current()) return;
      if (value.version !== item.version) throw Error('chat_import_changed');
      update(scope, { detail: value, detailLoading: false });
    } catch (error) { if (current()) failed(error, scope, true); }
    finally { if (detailRead.current === controller) detailRead.current = null; }
  }
  const readRef = useRef(read); readRef.current = read;
  useEffect(() => {
    live.current = true; replace(empty(scope));
    if (available() && env.online) void readRef.current(false);
    else update(scope, { phase: 'unavailable', error: env.sharedMode ? '匯入對話只供本人孩子查閱。' : '連線後才可讀取匯入對話。' });
    return () => { live.current = false; listing.current?.abort(); listing.current = null; detailRead.current?.abort(); detailRead.current = null; };
  }, [scope, env.online, api]);
  const visible = state.scope === scope && available() ? state : { ...empty(scope), phase: 'unavailable' as const };
  return { ...visible, scopeKey: scope, online: env.online, hasMore: visible.cursor !== null,
    loadMore: () => { void read(true); }, refresh: () => { if (!live.current || latest.current.scope !== scope) return; listing.current?.abort(); listing.current = null; close(); void read(false); },
    open: (item: ImportedChatMessage) => { void open(item); }, close };
}
