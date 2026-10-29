import type { HomeChild } from '../view-model';
import type { ProfileViewModel } from '../profile-view-model';
import { childProfileAgeLabel } from '../child-overview-view-model';

/** Shared by home and settings; never turns unloaded siblings into confirmed profiles. */
export function projectScopedHomeChildren(children: HomeChild[], selectedChildId: string | null, scopeKey: string | null, profile: { scopeKey: string; model: ProfileViewModel } | null): HomeChild[] {
  const current = scopeKey && profile?.scopeKey === scopeKey && profile.model.child?.id === selectedChildId ? profile.model : null;
  const data = current && current.access !== 'lost' && !current.needsRefresh ? current.current?.data : null;
  return children.map(child => child.id !== selectedChildId ? child : { ...child,
    ageLabel: data ? childProfileAgeLabel(data) : '年齡資料未確認',
    regionLabel: data?.region ?? '地區未提供', allergiesLabel: data?.allergies ?? null,
    profileConfirmed: !!data && !!current?.current?.confirmedAtLabel,
  });
}
