import type { Href } from 'expo-router';
import type { HomeDestination } from './view-model';

// Navigation identity only: never put private text, draft or operation data in URLs.
export type HomeTarget =
  | { destination: 'tasks'; taskId?: string }
  | { destination: 'growth'; concernId?: string }
  | { destination: Exclude<HomeDestination, 'tasks' | 'growth'> };
export function homeTargetHref(target: HomeDestination | HomeTarget): Href {
  const value = typeof target === 'string' ? { destination: target } : target;
  if (value.destination === 'tasks' && 'taskId' in value && value.taskId) return { pathname: '/tasks', params: { taskId: value.taskId } };
  if (value.destination === 'growth' && 'concernId' in value && value.concernId) return { pathname: '/growth', params: { concernId: value.concernId } };
  return `/${value.destination}` as Href;
}
