import { familyLibraryApi, saveLibraryOriginal } from './family-library-upload';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { publishOnlineRefresh } from '../../../src/client/online-refresh-events';
import { photoAttachment, type AssistantAttachment } from '../assistant-draft';
import { AssistantAttachmentPicker } from '../components/agent/AssistantAttachmentPicker';
import { PhotoFilePicker } from '../components/photos/PhotoFilePicker';
import { AppButton } from '../components/ui';
import { useDomainEnvironment } from './useDomainEnvironment';

export function FamilyLibraryUpload({ tab, spaceName, onSaved }: {
  tab: 'photos' | 'voices' | 'files'; spaceName: string; onSaved(): void;
}) {
  const env = useDomainEnvironment();
  const { childId, userId, scopeKey, owner, sharing } = env;
  const api = useMemo(() => sharing ? familyLibraryApi(owner.fetcher, env.apiBaseUrl, sharing) : null,
    [owner, env.apiBaseUrl, sharing]);
  const active = useRef<AbortController | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const enabled = !!childId && !!userId && !!sharing?.expectedBasis && env.online && env.allows('attachments')
    && (env.role === 'owner' || env.role === 'caregiver');
  async function run(selected?: AssistantAttachment) {
    if (!api || !enabled || !childId || !userId || !env.current() || active.current || selected && !env.canStartWrite()) {
      selected?.dispose?.(); return;
    }
    const previous = owner.libraryUploads.get(scopeKey);
    if (!previous && !selected) return;
    const job = new AbortController(), { signal } = job;
    active.current = job;
    const current = () => active.current === job && env.current() && !signal.aborted;
    const timeout = setTimeout(() => job.abort(), 60_000);
    setBusy(true); setMessage(selected ? '正在準備原件…' : '正在查回原上傳…');
    try {
      let state: string | undefined;
      if (selected) {
        state = await saveLibraryOriginal(api, selected, childId, userId, signal, current, previous, ref => {
          owner.libraryUploads.set(scopeKey, ref);
          setMessage('正在保存到家庭附件庫…');
        });
      } else if (previous) {
        const result = previous.kind === 'photo' ? await api.photo.resolveLibrary(childId, previous.opId, signal, userId)
          : await api[previous.kind].resolve(childId, previous.opId, signal, userId);
        state = result.state;
      }
      if (!current()) return;
      if (state === 'ready') {
        owner.libraryUploads.delete(scopeKey);
        setMessage('原件已保存到家庭附件庫。');
        publishOnlineRefresh(); onSaved();
      } else setMessage(state === 'reserved' ? '預留已保存。請選回同一原件繼續上傳。' : '上傳結果仍待確認，可查回原操作。');
    } catch (error) {
      if (active.current !== job || !env.current()) return;
      const failure = error as { status?: number; code?: string; onlineCode?: string; message?: string };
      const code = failure.code ?? failure.onlineCode ?? failure.message;
      if (code === 'original_changed') {
        setMessage('請選回同一原件，或先查回上次結果。');
      } else if (code === 'invalid_file' || failure.status === 400 || ['photo_capacity','voice_pending_capacity','chat_file_pending_capacity'].includes(code ?? '')) {
        if (!previous) owner.libraryUploads.delete(scopeKey);
        setMessage(code?.includes('capacity') ? '已達附件容量上限。' : '未能保存這個檔案，請核對格式和大小。');
      } else if (failure.status === 403 || failure.status === 401) {
        setMessage('目前沒有這個家庭附件庫的上傳權限。'); env.accessError(failure);
      } else if (failure.status === 404) {
        setMessage('原上傳尚未找到，請選回同一原件繼續。');
      } else setMessage('未能確認保存結果，請查回原上傳。');
    } finally {
      clearTimeout(timeout); selected?.dispose?.();
      if (active.current === job) { active.current = null; if (env.current()) setBusy(false); }
    }
  }
  const recover = useRef(run); recover.current = run;
  useEffect(() => {
    setBusy(false);
    if (enabled && owner.libraryUploads.has(scopeKey)) void recover.current();
    return () => { active.current?.abort(); active.current = null; };
  }, [scopeKey, enabled, owner]);
  const disabled = !enabled || busy;
  return <View><Text>{spaceName} · {env.childName}</Text>
    {tab === 'photos' ? <PhotoFilePicker disabled={disabled} onPick={photo => void run(photoAttachment(photo))} onError={setMessage} />
      : <AssistantAttachmentPicker kind={tab === 'voices' ? 'voice' : 'file'} disabled={disabled} onPick={file => void run(file)} onError={setMessage} />}
    {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
    {owner.libraryUploads.has(scopeKey) ? <AppButton label="查回原上傳" variant="quiet" disabled={disabled} onPress={() => void run()} /> : null}
  </View>;
}
