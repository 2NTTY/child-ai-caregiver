import { useLayoutEffect, useRef } from 'react';
import { useRouter, usePathname, type Href } from 'expo-router';
import { usePreviewNavigation } from '../preview/PreviewNavigationGuard';
import { useCareWorkspace } from '../workspaces/CareWorkspace';
import { useProfileWorkspace } from '../workspaces/ProfileWorkspace';
import { useTasksWorkspace } from '../workspaces/TasksWorkspace';
import { useGrowthWorkspace } from '../workspaces/GrowthWorkspace';
import { usePreparationWorkspace } from '../workspaces/PreparationWorkspace';
import { useProductionSettingsDomains, useProductionContactDomain } from './SettingsDomains';
import { useProductionHomeValue } from './ProductionProvider';
import { headerOperationHints, type HeaderOperationInput } from '../header-operation-hints';
import { clearOperationReveal, discardOperationRevealOutside, requestOperationReveal, type OperationRevealTarget } from '../operation-reveal';

/** Existing public owners only. No extra reads, inferred counts or global attention promise. */
export function useHeaderOperationHints() {
  const production = useProductionHomeValue(), care = useCareWorkspace(), profile = useProfileWorkspace(), tasks = useTasksWorkspace();
  const growth = useGrowthWorkspace(), preparation = usePreparationWorkspace();
  const contact = useProductionContactDomain(), { modelSettings } = useProductionSettingsDomains();
  const router = useRouter(), pathname = usePathname(), leave = usePreviewNavigation();
  const scope = production.scopeKey, identity = production.identityKey;
  const current = useRef({ scope, identity }); current.current = { scope, identity };
  useLayoutEffect(() => { clearOperationReveal(); return clearOperationReveal; }, [scope, identity]);
  useLayoutEffect(() => { discardOperationRevealOutside(pathname); }, [pathname]);
  const open = (path: string, expected: string, account = false, reveal?: OperationRevealTarget) => () => {
    const valid = () => (account ? current.current.identity : current.current.scope) === expected;
    if (!valid()) return;
    leave(() => {
      if (!valid()) return;
      if (reveal) requestOperationReveal(expected, reveal);
      router.push(path as Href);
    }, 'workspace');
  };
  const entries: HeaderOperationInput[] = [];
  if (identity) entries.push({ id: 'create-child', page: '建立孩子', state: production.model.operation.state,
    onReview: open('/guide', identity, true, 'create-child') });
  if (scope && care?.scopeKey === scope && care.model.access !== 'lost') entries.push({ id: 'care', page: '核對', state: care.model.operation.state, onReview: open('/care', scope) });
  if (scope && profile?.scopeKey === scope && profile.model.access !== 'lost') entries.push({ id: 'profile', page: '檔案', state: profile.model.operation.state, onReview: open('/profile', scope, false, 'profile') });
  if (scope && tasks?.scopeKey === scope && tasks.model.access !== 'lost') entries.push({ id: 'tasks', page: '待辦', state: tasks.model.operation.state, onReview: open('/tasks', scope) });
  if (scope && growth?.scopeKey === scope && growth.model.access !== 'lost') entries.push({ id: 'growth', page: '關注', state: growth.model.operation, onReview: open('/growth?tab=concerns', scope) });
  if (scope && preparation?.scopeKey === scope && preparation.model.operation && preparation.recovery) entries.push({ id: 'preparation', page: '準備單', state: preparation.model.operation.state, onReview: open('/growth?tab=preparation', scope) });
  if (scope && contact.model.scopeKey === scope && contact.model.access !== 'lost') entries.push({ id: 'contact', page: '聯絡', state: contact.model.operation, onReview: open('/contact', scope) });
  if (identity && modelSettings.model.scopeKey === identity && modelSettings.model.authorized) entries.push({ id: 'model-settings', page: '模型設定', state: modelSettings.model.operation, onReview: open('/settings?section=model', identity, true) });
  return headerOperationHints(entries);
}
