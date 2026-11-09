import { useRef, useState, useEffect } from 'react';
import { pickAvatarImage } from '../../platform/avatar-picker';
import type { AvatarLane, AvatarSnapshot } from '../../production/AvatarOwner';
import { AppButton } from '../ui';
export function AvatarPicker({ lane, state }: { lane: AvatarLane; state: AvatarSnapshot }) {
  const [reading, setReading] = useState(false), alive = useRef(true), pending = useRef<number | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (pending.current !== null) lane.cancelPicker(pending.current); }; }, [lane, state.key]);
  async function pick() {
    const attempt = lane.beginSelection(); if (attempt === null || !state.policy) return;
    const signal = lane.selectionSignal(attempt); if (!signal) return;
    pending.current = attempt; setReading(true);
    try { const image = await pickAvatarImage(state.policy, signal); if (image) { if (!alive.current || signal.aborted) image.dispose(); else lane.select(attempt, image); } }
    catch { if (alive.current && !signal.aborted) lane.selectionFailed(attempt); }
    finally { if (pending.current === attempt) pending.current = null; if (alive.current) setReading(false); }
  }
  return <AppButton label="選擇圖片" variant="secondary" disabled={reading || state.busy || state.unknown || !state.avatar?.canManage || !state.available} loading={reading} onPress={() => { void pick(); }} />;
}
