import type { Href } from 'expo-router';
import type { HomeDestination } from './view-model';

/** Only non-sensitive presentation identity is encoded; the owner still authorizes it. */
export type HomeTarget =
  | { destination: 'tasks'; taskId?: string }
  | { destination: 'growth'; concernId?: string }
  | { destination: Exclude<HomeDestination, 'tasks' | 'growth'> };

export function homeTargetHref(target: HomeDestination | HomeTarget): Href {
  if (typeof target === 'string') return `/${target}`;
  if (target.destination === 'tasks' && target.taskId) return `/tasks?taskId=${encodeURIComponent(target.taskId)}`;
  if (target.destination === 'growth' && target.concernId) return `/growth?concernId=${encodeURIComponent(target.concernId)}`;
  return `/${target.destination}`;
}
