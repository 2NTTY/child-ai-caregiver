import { getAcceptanceTrace } from '../tasks-interactive-qa/trace';
import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { TasksChoiceSceneContext } from './TasksChoiceSceneContext';
import type { OverlayTicket } from './scene-barrier';
import { createOverlayCloseCapture, shouldRevealOverlay } from './overlay-close-capture';
type PhysicalLifetime = { requested: boolean; unfinished: boolean; completionGeneration: object };
/** Only a new opening is delayed: reservation revokes selection before physical reveal. */
export function useSceneObservedOverlay(visible: boolean, onClosed?: () => void) {
  const scene = useContext(TasksChoiceSceneContext), instance = useRef({});
  const live = useRef<OverlayTicket | null>(null);
  // Layout-written only; the current capture is never read as product authority.
  const committedCapture=useRef<(() => void)|null>(null);
  // A closing surface outlives requested=false and may outlive its coordinator.
  const physical = useRef<PhysicalLifetime | null>(null);
  const [prepared, setPrepared] = useState(false);
  const physicalVisible = shouldRevealOverlay(visible, !!scene && !scene.read().retired, prepared);
  // This render may be committed again by replay. Never retarget its completion.
  let capturedLifetime: PhysicalLifetime | null = null, capturedGeneration: object | null = null;
  let captured = false, completed = false;
  const capturedClosingIntent = !visible;
  function completePhysical(accepted: boolean) {
    if (accepted && completed && capturedClosingIntent && capturedLifetime && !capturedLifetime.requested
      && capturedLifetime.completionGeneration === capturedGeneration) capturedLifetime.unfinished = false;
  }
  const capture = createOverlayCloseCapture(() => {
    onClosed?.();
    completed = true;
    if (!scene) completePhysical(true);
  }, ticket => { completePhysical(scene?.closed(ticket) === true); });
  useLayoutEffect(() => {
    return () => {
      const trace=getAcceptanceTrace();
      trace.witness('overlay-cleanup',{hook:trace.identity(instance.current),physical:trace.identity(physical.current),
        generation:trace.identity(physical.current?.completionGeneration),confirm:trace.identity(committedCapture.current),
        coordinator:trace.identity(scene),ticket:trace.identity(live.current),unfinished:physical.current?.unfinished??false});
      if (physical.current) physical.current.completionGeneration = {};
      if (live.current) scene?.abandon(live.current);
      live.current = null;
    };
  }, [scene]);
  useLayoutEffect(() => {
    if (visible && !physical.current?.requested) physical.current = { requested: true, unfinished: true, completionGeneration: {} };
    else if (!visible && physical.current) physical.current.requested = false;
    if (scene && !scene.read().retired) {
      if (visible) {
        const observed = scene.read().overlays.find(item => item.ticket === live.current);
        if (!observed || observed.phase === 'closing' || observed.phase === 'unknown') {
          if (physical.current) physical.current.completionGeneration = {};
          live.current = scene.reserve(instance.current);
        }
        if (physicalVisible && live.current) scene.shown(live.current);
      } else {
        if (!live.current && physical.current?.unfinished) {
          // We have no transferable close proof for this coordinator. Represent
          // the real unfinished lifetime conservatively; old callbacks stay old.
          physical.current.completionGeneration = {};
          live.current = scene.reserve(instance.current);
          if (live.current) scene.abandon(live.current);
        }
        const observed = scene.read().overlays.find(item => item.ticket === live.current);
        if (live.current && observed && observed.phase !== 'closing' && observed.phase !== 'unknown') scene.closing(live.current);
      }
    }
    if (!captured) {
      captured = true; capturedLifetime = physical.current;
      capturedGeneration = capturedLifetime?.completionGeneration ?? null;
    }
    // Child layout close callbacks may arrive before this parent layout effect.
    // Commit drains them only after the matching ticket has entered closing.
    capture.commit(live.current);
    committedCapture.current=capture.closed;
    const trace=getAcceptanceTrace();
    trace.witness('overlay-capture',{capture:trace.identity(capture),hook:trace.identity(instance.current),physical:trace.identity(physical.current),
      generation:trace.identity(physical.current?.completionGeneration),confirm:trace.identity(capture.closed),
      coordinator:trace.identity(scene),ticket:trace.identity(live.current),visible,unfinished:physical.current?.unfinished??false});
    // No coordinator can accept a ticket here. Require this render's actual
    // closing intent and its still-current local generation proof instead.
    if (!scene) completePhysical(true);
    if (prepared !== visible) setPrepared(visible);
  });
  return { visible: physicalVisible, closed: capture.closed, coordinator: scene };
}
