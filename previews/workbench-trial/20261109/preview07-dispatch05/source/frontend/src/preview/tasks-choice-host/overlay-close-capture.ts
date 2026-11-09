import { getAcceptanceTrace, recordDrawerLatch } from '../tasks-interactive-qa/trace';
import type { OverlayTicket } from './scene-barrier';
/** One render may be committed more than once during effect replay. Never retarget its callback. */
export function createOverlayCloseCapture(onClosed: (() => void) | undefined, confirm: (ticket: OverlayTicket) => void) {
  let ticket: OverlayTicket | null = null;
  let committed = false, completed = false, confirmed = false;
  function observe(event:string) {
    const trace=getAcceptanceTrace();trace.witness(event,{capture:trace.identity(capture),closed:trace.identity(capture.closed),
      confirm:trace.identity(confirm),ticket:trace.identity(ticket),committed,completed,confirmed});
  }
  function drain() {
    if (committed && completed && ticket && !confirmed) {
      confirmed = true;observe('close-capture-confirm-before');confirm(ticket);observe('close-capture-confirmed');
    }
  }
  const capture=Object.freeze({
    commit(next: OverlayTicket | null) {
      if (committed) return;
      committed = true; ticket = next; drain();
    },
    closed() {
      observe('close-capture-closed-before');onClosed?.();
      completed = true; drain();observe('close-capture-closed-after');
    },
  });
  return capture;
}

/** Visibility may advance only after the reservation layout commit. */
export function shouldRevealOverlay(requested: boolean, liveScene: boolean, prepared: boolean) {
  return requested && (!liveScene || prepared);
}
/** Each close owns a separate latch; no completion can migrate to a reopened generation. */
export function createDrawerCloseLatch(confirm: () => void) {
  const identity={};
  let animation = false, focus = false, confirmed = false;
  const observe=()=>recordDrawerLatch(identity,confirm,animation,focus,confirmed);
  observe();
  function drain() { if (animation && focus && !confirmed) { confirmed = true; observe(); confirm(); } }
  return Object.freeze({
    animation() { animation = true; observe(); drain(); },
    focus() { focus = true; observe(); drain(); },
  });
}
