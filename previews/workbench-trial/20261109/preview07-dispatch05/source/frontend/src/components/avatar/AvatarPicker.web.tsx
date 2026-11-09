import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { readAvatarFile } from '../../platform/avatar-picker';
import type { AvatarLane, AvatarSnapshot } from '../../production/AvatarOwner';
import { AppButton } from '../ui';
export function AvatarPicker({ lane, state }: { lane: AvatarLane; state: AvatarSnapshot }) {
  const input = useRef<HTMLInputElement>(null), attempt = useRef<number | null>(null), alive = useRef(true);
  const [reading, setReading] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (attempt.current !== null) lane.cancelPicker(attempt.current); }; }, [lane, state.key]);
  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0], ticket = attempt.current; event.target.value = '';
    if (ticket === null) return;
    const signal = lane.selectionSignal(ticket);
    if (!file || !state.policy || !signal) { lane.cancelPicker(ticket); attempt.current = null; return; }
    setReading(true);
    try { const image = await readAvatarFile(file, state.policy, signal); if (!alive.current || signal.aborted) image.dispose(); else lane.select(ticket, image); }
    catch { if (alive.current && !signal.aborted) lane.selectionFailed(ticket); }
    finally { if (attempt.current === ticket) attempt.current = null; if (alive.current) setReading(false); }
  }
  return <><input ref={input} type="file" accept={state.policy?.acceptedMimeTypes.join(',')} aria-hidden tabIndex={-1} style={{ display: 'none' }} onChange={event => { void read(event); }} />
    <AppButton label="選擇圖片" variant="secondary" loading={reading} disabled={reading || state.busy || state.unknown || !state.avatar?.canManage || !state.available}
      onPress={() => { attempt.current = lane.beginSelection(); if (attempt.current !== null) input.current?.click(); }} /></>;
}
