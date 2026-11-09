import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import type { ChatFileMessageReference } from '../../../src/shared/chat-files';
import { ChatFileApiError } from '../../../src/client/chat-file-api';
import { useDomainEnvironment } from './useDomainEnvironment';
import { exportAttachment } from '../platform/file-export';
import { AppButton } from '../components/ui';

/** Presentation only: the shared API authorizes every download of the original. */
export function ChatFileMessage({ messageId, file, compact = false }: { messageId: string; file: ChatFileMessageReference; compact?: boolean }) {
  const env = useDomainEnvironment(), api = env.owner.fileApi;
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; request.current?.abort(); }; }, [env.scopeKey]);
  const matches = (value: Awaited<ReturnType<typeof api.get>>) => value.state === 'ready' && value.messageId === messageId
    && value.version === file.version && value.sha256 === file.sha256;
  const metadata = useQuery({ queryKey: ['production', env.scopeKey, 'chat-file', file.id, file.version],
    enabled: !!env.childId && !!env.userId && env.online, retry: false,
    queryFn: ({ signal }) => api.get(env.childId!, file.id, signal, env.userId!) });
  useEffect(() => { if (metadata.error instanceof ChatFileApiError && [401,403].includes(metadata.error.status)) env.accessError(metadata.error); }, [metadata.error]);
  async function download() {
    if (!env.current() || !env.userId || !env.childId || !env.online || request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setNotice(null);
    const timer = setTimeout(() => controller.abort(), 60000);
    const current = () => live.current && env.current() && !controller.signal.aborted;
    try {
      const attachment = await api.get(env.childId, file.id, controller.signal, env.userId);
      if (!matches(attachment)) throw Error('chat_file_changed');
      const content = await api.content(attachment, controller.signal, env.userId);
      if (!current()) return;
      clearTimeout(timer);
      const result = await exportAttachment(content.bytes, content.mimeType, attachment.fileName ?? 'attachment', current);
      if (current()) setNotice(result);
    } catch (error) {
      if (live.current && env.current()) { setNotice('未能下載原檔，請核對連線或附件是否仍可使用。');
        if (error instanceof ChatFileApiError && [401,403].includes(error.status)) env.accessError(error); }
    } finally { clearTimeout(timer); if (request.current === controller) request.current = null; if (live.current && env.current()) setBusy(false); }
  }
  const attachment = metadata.isError ? undefined : metadata.data, readable = attachment && matches(attachment);
  return <View>
    {!compact ? <><Text>{readable ? attachment.fileName : attachment ? '附件已刪除或不可用' : '檔案附件'} · {Math.max(1,Math.round(file.bytes / 1024))} KB</Text><Text>不支援預覽</Text></> : attachment && !readable ? <Text>附件已刪除或不可用</Text> : null}
    <AppButton label="下載原檔" variant="quiet" disabled={!env.online || !readable || busy} loading={busy} onPress={() => { void download(); }} />
    {metadata.isError ? <AppButton label="重新讀取附件資料" variant="quiet" disabled={!env.online || metadata.isFetching} onPress={() => { void metadata.refetch(); }} /> : null}
    {notice ? <Text accessibilityRole="alert">{notice}</Text> : null}
  </View>;
}
