import { useEffect, useRef, useState } from 'react';
import { subscribeOnlineRefresh } from '../../../src/client/online-refresh-events';
import type { AttachmentListQuery } from '../../../src/shared/attachment-list';
import type { VoiceAttachment, VoiceAttachmentPage } from '../../../src/shared/voice';
import type { ChatFileAttachment, ChatFileAttachmentPage } from '../../../src/shared/chat-files';
import { photoTime } from '../photo-view-model';
import type { AttachmentReviewCollections, AttachmentReviewPage } from '../components/photos/AttachmentLibrary';
import { useDomainEnvironment } from './useDomainEnvironment';
import { VoiceMessage } from './VoiceMessage';
import { ChatFileMessage } from './ChatFileMessage';

type Original = VoiceAttachment | ChatFileAttachment;
type Page<T> = { items: T[]; nextCursor: string | null; complete: boolean; scanned: number };
type ListApi<T> = { list(childId: string, query: AttachmentListQuery, signal: AbortSignal, userId: string): Promise<Page<T>> };
type ReadState<T> = { scope: string; items: T[]; cursor: string | null; depth: number; state: AttachmentReviewPage['state']; busy: boolean; refreshing: boolean; message: string };

/** One ephemeral read projection per source. No upload owner, persisted copies or global attachment totals. */
export function useAttachmentList<T extends Original>(api: ListApi<T>) {
  const env = useDomainEnvironment(), latestEnv = useRef(env); latestEnv.current = env;
  const empty = (scope: string): ReadState<T> => ({ scope, items: [], cursor: null, depth: 0, state: 'loading', busy: false, refreshing: false, message: '' });
  const [state, setState] = useState<ReadState<T>>(() => empty(env.scopeKey));
  const snapshot = useRef(state), request = useRef<AbortController | null>(null), live = useRef(false), refreshRequested = useRef(false);
  const update = (value: ReadState<T>) => { snapshot.current = value; setState(value); };
  async function read(more: boolean) {
    const e = latestEnv.current, previous = snapshot.current.scope === e.scopeKey ? snapshot.current : empty(e.scopeKey);
    if (!live.current || !e.current() || !e.childId || !e.userId || !e.online || more && !previous.cursor) return;
    if (request.current) { if (!more) refreshRequested.current = true; return; }
    refreshRequested.current = false;
    const controller = new AbortController(); request.current = controller;
    const current = () => live.current && latestEnv.current.scopeKey === e.scopeKey && latestEnv.current.userId === e.userId && e.current() && !controller.signal.aborted;
    update({ ...previous, state: previous.depth ? previous.state : 'loading', busy: true, refreshing: !more && previous.depth > 0, message: previous.depth ? previous.message : '' });
    try {
      const items = more ? [...previous.items] : [];
      const positions = new Map(items.map((item, index) => [item.id, index]));
      let cursor = more ? previous.cursor : null, depth = more ? previous.depth : 0;
      // Rebuild the loaded depth from fresh cursors; commit only after the whole read succeeds.
      // Empty scan pages still count toward that depth and retain their continuation cursor.
      for (let index = 0; index < (more ? 1 : Math.max(1, previous.depth)); index++) {
        const page = await api.list(e.childId, cursor === null ? {} : { cursor }, controller.signal, e.userId);
        if (!current()) return;
        for (const item of page.items) {
          const existing = positions.get(item.id);
          if (existing === undefined) { positions.set(item.id, items.length); items.push(item); } else items[existing] = item;
        }
        depth++; cursor = page.nextCursor;
        if (cursor === null) break;
      }
      update({ scope: e.scopeKey, items, cursor, depth, state: 'ready', busy: false, refreshing: false, message: '' });
    } catch (error) {
      if (!current()) return;
      const failure = error as { status?: number; code?: string };
      const changed = failure.code === 'attachment_scope_changed' || failure.code === 'session_changed' || failure.code === 'identity_changed';
      const denied = [401, 403, 404, 428].includes(failure.status ?? 0);
      const unavailable = failure.status === 404 || failure.status === 405
        || failure.status === 503 && failure.code === 'attachment_list_unavailable';
      if (changed || denied || unavailable) refreshRequested.current = false;
      update({ ...previous, ...(changed || denied || unavailable ? { items: [], cursor: null, depth: 0 } : {}), state: unavailable ? 'unavailable' : 'error', busy: false, refreshing: false,
        message: changed ? '存取範圍已改變，舊清單已清除。請重新讀取。' : unavailable ? '附件清單暫不可用；服務可能尚未接通，請返回原聊天查看。'
          : denied ? '目前無法讀取這些私人附件，請重新核對身份及孩子權限。' : previous.items.length ? '未能更新附件，以下是較早讀取的清單。可重新讀取。' : '未能讀取附件，請重試。' });
      if ([401, 403].includes(failure.status ?? 0) || failure.code === 'session_changed') e.accessError(failure);
    } finally {
      if (request.current === controller) request.current = null;
      if (current() && refreshRequested.current) { refreshRequested.current = false; void readRef.current(false); }
    }
  }
  const readRef = useRef(read); readRef.current = read;
  useEffect(() => {
    live.current = true;
    if (snapshot.current.scope !== env.scopeKey) update(empty(env.scopeKey));
    if (env.online) void readRef.current(false);
    else update({ ...snapshot.current, busy: false, refreshing: false, state: snapshot.current.items.length ? 'ready' : 'error', message: '目前離線；重連後可重新讀取附件。' });
    return () => { live.current = false; refreshRequested.current = false; request.current?.abort(); request.current = null; };
  }, [env.scopeKey, env.online, api]);
  useEffect(() => subscribeOnlineRefresh(() => { void readRef.current(false); }), []);
  const visible = state.scope === env.scopeKey && env.current() ? state : empty(env.scopeKey);
  return { ...visible, online: env.online, hasMore: visible.cursor !== null, refresh: () => { void read(false); }, loadMore: () => { void read(true); } };
}

function sizeLabel(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
export function useAttachmentReview(): AttachmentReviewCollections {
  const env = useDomainEnvironment();
  const voices = useAttachmentList<VoiceAttachmentPage['items'][number]>(env.owner.voiceApi);
  const files = useAttachmentList<ChatFileAttachmentPage['items'][number]>(env.owner.fileApi);
  return {
    voices: { ...voices, items: voices.items.map(item => ({ id: item.id, kind: 'voice', title: item.fileName!, createdAtLabel: photoTime(item.createdAt),
      sizeLabel: `${Math.ceil(item.durationMs! / 1000)} 秒 · ${sizeLabel(item.bytes!)}`, sourceLabel: '本人私人聊天', version: item.version,
      content: <VoiceMessage key={`${env.scopeKey}:${item.id}:${item.version}`} messageId={item.messageId!} voice={{ id: item.id, version: item.version, mimeType: item.mimeType!, bytes: item.bytes!, durationMs: item.durationMs!, sha256: item.sha256! }} /> })) },
    files: { ...files, items: files.items.map(item => ({ id: item.id, kind: item.mimeType!.startsWith('video/') ? 'video' : 'file', title: item.fileName!, createdAtLabel: photoTime(item.createdAt),
      sizeLabel: sizeLabel(item.bytes!), sourceLabel: '本人私人聊天', version: item.version,
      content: <ChatFileMessage key={`${env.scopeKey}:${item.id}:${item.version}`} compact messageId={item.messageId!} file={{ id: item.id, version: item.version, mimeType: item.mimeType!, bytes: item.bytes!, sha256: item.sha256! }} /> })) },
  };
}
