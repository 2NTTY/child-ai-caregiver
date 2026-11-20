'use dom';
import { useEffect, useRef } from 'react';
import type { DOMProps } from 'expo/dom';

export type CharacterAction = 'nod' | 'wave' | 'arrive';
export type CharacterMode = 'idle' | 'quiet' | 'hidden';

export default function CharacterFrame({ src, mode, action, serial, onState }: {
  src: string; mode: CharacterMode; action: CharacterAction; serial: number;
  onState(ready: boolean): Promise<void>; dom?: DOMProps;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const current = useRef({ mode, onState }); current.current = { mode, onState };
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !['ready', 'failed'].includes(event.data?.companion)) return;
      const ready = event.data.companion === 'ready';
      if (ready) frame.current?.contentWindow?.postMessage(current.current.mode, '*');
      void current.current.onState(ready);
    };
    window.addEventListener('message', listener);
    frame.current?.contentWindow?.postMessage('status', '*');
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => { frame.current?.contentWindow?.postMessage(mode, '*'); }, [mode]);
  useEffect(() => { if (serial) frame.current?.contentWindow?.postMessage(action, '*'); }, [action, serial]);
  return <iframe ref={frame} title="Zundamon" tabIndex={-1} aria-hidden sandbox="allow-scripts" referrerPolicy="no-referrer"
    onLoad={() => frame.current?.contentWindow?.postMessage('status', '*')} src={src}
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: 'none', background: 'transparent' }} />;
}
