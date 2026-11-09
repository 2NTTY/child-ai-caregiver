import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { PhotoAttachment, PhotoMessageReference } from '../../../src/shared/photos';
import { PhotoApiError } from '../../../src/client/photo-api';
import { readBlobBytes } from '../../../src/client/blob-bytes';
import { photoPreview } from '../platform/photo-bytes';
import { AppButton } from '../components/ui';
import { useDomainEnvironment } from './useDomainEnvironment';

/** Read the same private original, including photos reused in more than one message. */
export function ChatPhotoMessage({ photo }: { photo: PhotoMessageReference }) {
  const env = useDomainEnvironment(), api = env.owner.chatPhotoApi;
  const [preview, setPreview] = useState<ReturnType<typeof photoPreview> | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null), resource = useRef<ReturnType<typeof photoPreview> | null>(null);
  useEffect(() => () => { request.current?.abort(); resource.current?.dispose(); }, [env.scopeKey,photo.id]);
  const matches = (item: PhotoAttachment) => item.state === 'ready' && !item.recoveryPending && item.version >= photo.version
    && item.id === photo.id && item.sha256 === photo.sha256 && item.bytes === photo.bytes && item.mimeType === photo.mimeType
    && item.fileName === photo.fileName && item.source === photo.source;
  const metadata = useQuery({ queryKey: ['production',env.scopeKey,'chat-photo',photo.id,photo.version],
    enabled: !!env.childId && !!env.userId && env.online, retry: false,
    queryFn: ({signal}) => api.photo(env.childId!,photo.id,signal,env.userId!) });
  const readable = !metadata.isError && !!metadata.data && matches(metadata.data);
  useEffect(() => {
    if (metadata.error instanceof PhotoApiError && [401,403].includes(metadata.error.status)) env.accessError(metadata.error);
    if (metadata.isError || metadata.data && !matches(metadata.data)) { resource.current?.dispose(); resource.current=null; setPreview(null); }
  }, [metadata.error,metadata.data]);
  async function open() {
    if (!env.current() || !env.childId || !env.userId || !env.online || request.current) return;
    const controller = new AbortController(); request.current=controller; setBusy(true); setNotice(null);
    const current = () => env.current() && !controller.signal.aborted;
    try {
      const item = await api.photo(env.childId,photo.id,controller.signal,env.userId);
      if (!matches(item)) throw new PhotoApiError(410);
      const bytes = await readBlobBytes(await api.content(item,controller.signal,env.userId));
      if (!current()) return;
      env.queryClient.setQueryData(['production',env.scopeKey,'chat-photo',photo.id,photo.version],item);
      const image = photoPreview(bytes,item.mimeType); resource.current?.dispose(); resource.current=image; setPreview(image);
    } catch(error) {
      if (current()) { resource.current?.dispose(); resource.current=null; setPreview(null); setNotice('未能讀取原照片，請核對連線或照片是否仍可使用。');
        if(error instanceof PhotoApiError && [401,403].includes(error.status))env.accessError(error); }
    } finally { if(request.current===controller)request.current=null; if(current())setBusy(false); }
  }
  return <View>
    <Text>{readable ? photo.fileName : metadata.data || metadata.isError ? '照片目前不可讀取' : '照片附件'}</Text>
    {preview && readable ? <Image source={{uri:preview.uri}} resizeMode="contain" accessibilityLabel="聊天照片" style={{width:'100%',height:220}}/> : null}
    {!preview || !readable ? <AppButton label="查看照片" variant="quiet" loading={busy} disabled={!env.online||busy||!!metadata.data&&!readable}
      onPress={() => { void open(); }}/>:null}
    {notice ? <Text accessibilityRole="alert">{notice}</Text> : null}
  </View>;
}
