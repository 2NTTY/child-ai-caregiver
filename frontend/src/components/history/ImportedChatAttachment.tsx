import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Text } from 'react-native-paper';
import type { ImportedChatMessage } from '../../../../src/shared/chat-imports';
import { ChatFileApiError } from '../../../../src/client/chat-file-api';
import { VoiceApiError } from '../../../../src/client/voice-api';
import { PhotoApiError } from '../../../../src/client/photo-api';
import { importedAttachmentView, type ImportedAttachmentMetadata } from '../../imported-chat-attachment';
import { forSharedModule, useDomainEnvironment } from '../../production/useDomainEnvironment';
import { ChatFileMessage } from '../../production/ChatFileMessage';
import { ChatPhotoMessage } from '../../production/ChatPhotoMessage';
import { VoiceMessage } from '../../production/VoiceMessage';
import { ReadStateNotice } from '../ReadStateNotice';
import { AppButton } from '../ui';

export function ImportedChatAttachment({ item }: { item: ImportedChatMessage }) {
  const env = forSharedModule(useDomainEnvironment(), 'private'), binding = item.attachment;
  const allowed = !!env.userId && !!env.childId && env.childId === item.childId && env.current();
  const read = useQuery({ queryKey: ['production', env.scopeKey, 'imported-chat-attachment', item.id, item.version, binding],
    enabled: allowed && env.online && !!binding, retry: false,
    queryFn: async ({ signal }): Promise<ImportedAttachmentMetadata> => {
      if (!allowed || !binding || !env.current() || signal.aborted) throw Error('imported_chat_scope_unavailable');
      const result: ImportedAttachmentMetadata = binding.kind === 'files'
        ? { kind: 'files', value: await env.owner.fileApi.get(item.childId, binding.resource.id, signal, env.userId!) }
        : binding.kind === 'voices'
          ? { kind: 'voices', value: await env.owner.voiceApi.get(item.childId, binding.resource.id, signal, env.userId!) }
          : { kind: 'photos', value: await env.owner.chatPhotoApi.photo(item.childId, binding.resource.id, signal, env.userId!) };
      if (!env.current() || signal.aborted) throw Error('imported_chat_scope_unavailable');
      return result;
    } });
  useEffect(() => { if (read.error instanceof ChatFileApiError || read.error instanceof VoiceApiError || read.error instanceof PhotoApiError)
    env.accessError(read.error); }, [read.error]);
  if (!allowed || !(item.message.file || item.message.voice || item.message.photo)) return null;
  if (!binding) return <Text>這次匯入沒有可讀取的本地附件原件。</Text>;
  if (!env.online) return <ReadStateNotice state="unavailable" title="連線後可讀取附件" />;
  if (read.isPending) return <ReadStateNotice state="loading" title="正在讀取附件資料…" />;
  if (read.isError) return <ReadStateNotice state="error" title="暫時讀不到附件">
    <AppButton label="重新讀取附件" variant="quiet" onPress={() => { void read.refetch(); }} />
  </ReadStateNotice>;
  const view = importedAttachmentView(item, read.data);
  if (!view) return <Text>附件已變更或目前不可讀取。</Text>;
  if (view.kind === 'files') return <ChatFileMessage file={view.reference} messageId={view.messageId} library />;
  if (view.kind === 'voices') return <VoiceMessage voice={view.reference} messageId={view.messageId} library />;
  return <ChatPhotoMessage photo={view.reference} />;
}
