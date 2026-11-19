'use dom';
import { useEffect, useRef } from 'react';
import type { DOMProps } from 'expo/dom';

export default function CharacterFrame({ src, gesture, onState }: {
  src: string; gesture: number; onState(ready: boolean): Promise<void>; dom?: DOMProps;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const callback = useRef(onState);
  callback.current = onState;
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !['ready', 'failed'].includes(event.data?.companion)) return;
      void callback.current(event.data.companion === 'ready');
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  useEffect(() => { if (gesture) frame.current?.contentWindow?.postMessage('greet', '*'); }, [gesture]);
  return <iframe ref={frame} title="Zundamon" tabIndex={-1} aria-hidden sandbox="allow-scripts" referrerPolicy="no-referrer"
    src={src} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: 'none', background: 'transparent' }} />;
}
