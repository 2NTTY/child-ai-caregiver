// Keep one gate per mounted control, across scope-bound listener replacement.
export function createPointerClickGate() {
  let pending = false;
  return {
    beginActivation() { pending = false; },
    suppressNextClick() { pending = true; },
    consumeClick() {
      const suppress = pending;
      pending = false;
      return suppress;
    },
  };
}
