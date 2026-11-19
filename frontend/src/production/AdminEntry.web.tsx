import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';
import { AppButton } from '../components/ui';
import { useProduction } from './ProductionProvider';
export function AdminEntry({ sourceId }: { sourceId?: string }) {
  const { owner, userId, auth } = useProduction(), admin = owner.adminOwner, router = useRouter();
  const state = useSyncExternalStore(admin.subscribe, admin.getSnapshot, admin.getSnapshot);
  useEffect(() => { if (userId && auth === 'signedIn') { admin.setUser(userId); if (!sourceId || admin.getSnapshot().access === 'unread') void admin.checkAccess(); } }, [admin, userId, auth, sourceId]);
  return auth === 'signedIn' && state.userId === userId && state.access === 'allowed'
    ? <AppButton label={sourceId ? '維護文件整理方式' : '網站管理後台'} variant="secondary" onPress={() => router.push(sourceId ? { pathname:'/admin', params:{ source:sourceId } } : '/admin')} /> : null;
}
