import { useSyncExternalStore } from 'react';

export type OperationRevealTarget = 'create-child' | 'profile';
export type OperationOpenRequest = { key: number; scopeKey: string; consume(): void };
type Request = { key: number; scopeKey: string; target: OperationRevealTarget };
let sequence = 0, pending: Request | null = null;
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** One ephemeral UI reveal intent. No draft, business state, credentials or network work. */
export function requestOperationReveal(scopeKey: string, target: OperationRevealTarget) {
  pending = { key: ++sequence, scopeKey, target }; publish();
}
export function discardOperationRevealOutside(pathname: string) {
  if (pending && pathname !== (pending.target === 'create-child' ? '/guide' : '/profile')) clearOperationReveal();
}
export function clearOperationReveal() { if (pending) { pending = null; publish(); } }
export function useOperationReveal(scopeKey: string, target: OperationRevealTarget): OperationOpenRequest | undefined {
  const request = useSyncExternalStore(subscribe, () => pending, () => null);
  if (!request || request.scopeKey !== scopeKey || request.target !== target) return undefined;
  return { key: request.key, scopeKey, consume() {
    if (pending?.key === request.key) { pending = null; publish(); }
  } };
}
