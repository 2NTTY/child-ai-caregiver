import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'expo-router';
import { AppButton } from '../components/ui';
import { useProduction } from './ProductionProvider';
export function AdminEntry() {
  const { owner, userId, auth } = useProduction(), admin = owner.adminOwner, router = useRouter();
  const state = useSyncExternalStore(admin.subscribe, admin.getSnapshot, admin.getSnapshot);
  useEffect(() => { if (userId && auth === 'signedIn') { admin.setUser(userId); void admin.checkAccess(); } }, [admin, userId, auth]);
  return auth === 'signedIn' && state.userId === userId && state.access === 'allowed'
    ? <AppButton label="網站管理後台" variant="secondary" onPress={() => router.push('/admin')} /> : null;
}
