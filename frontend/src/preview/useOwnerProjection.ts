import { useCallback, useLayoutEffect, useRef, useState } from "react";

type Owner = { scopeKey: string; generation: number; active: boolean };
type Projection<T> = { owner: Owner; input: object; value: T };

// Only an immutable read projection crosses this bridge. The keyed sibling owns
// all writable state; consumers never become descendants of that keyed owner.
export function useOwnerProjection<T>(scopeKey: string, input: object) {
  const current = useRef<Owner>({ scopeKey, generation: 0, active: true });
  if (current.current.scopeKey !== scopeKey) {
    current.current = { scopeKey, generation: current.current.generation + 1, active: true };
  }
  const owner = current.current;
  const currentInput = useRef(input); currentInput.current = input;
  const [projection, setProjection] = useState<Projection<T> | null>(null);
  const isCurrent = useCallback(() => owner.active && current.current === owner && currentInput.current === input, [owner, input]);
  const publish = useCallback((value: T) => {
    if (!isCurrent()) return;
    setProjection(previous => !isCurrent() || previous?.owner === owner && previous.input === input && previous.value === value
      ? previous : { owner, input, value });
  }, [owner, input, isCurrent]);
  useLayoutEffect(() => {
    owner.active = true;
    return () => { owner.active = false; };
  }, [owner]);
  // Mask synchronously, including A -> B -> A and loading/authority input changes.
  const value = isCurrent() && projection?.owner === owner && projection.input === input ? projection.value : null;
  return { value, generation: owner.generation, publish, isCurrent };
}

export function ownerBoundCallbacks<T extends object>(callbacks: T, isCurrent: () => boolean): T {
  return Object.fromEntries(Object.entries(callbacks).map(([name, value]) => [name, typeof value === "function"
    ? (...args: unknown[]) => isCurrent() ? Reflect.apply(value, undefined, args) : undefined
    : value])) as T;
}
