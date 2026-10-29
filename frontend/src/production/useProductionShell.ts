import { useProductionChrome } from './ProductionProvider';
import { useProfileWorkspace } from '../workspaces/ProfileWorkspace';
import { projectScopedHomeChildren } from './scoped-child-projection';

/** The shell reads identity and operation context, not composer or unrelated lists. */
export function useProductionShell() {
  const chrome = useProductionChrome(), profile = useProfileWorkspace();
  const currentProfile = profile?.scopeKey === chrome.scopeKey ? profile.model : null;
  return { ...chrome, actions: { selectChild: chrome.selectChild }, model: { ...chrome.model,
    children: projectScopedHomeChildren(chrome.model.children, chrome.model.selectedChildId, chrome.scopeKey, profile),
    profileLoad: currentProfile?.reading && !currentProfile.current ? 'loading' as const
      : currentProfile?.current && !currentProfile.needsRefresh ? 'ready' as const : chrome.model.profileLoad,
  } };
}
