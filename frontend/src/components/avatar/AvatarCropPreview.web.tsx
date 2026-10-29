import { useId, useLayoutEffect, useRef, useState } from 'react';
import Cropper, { getInitialCropFromCroppedAreaPercentages, type Area, type MediaSize, type Size } from 'react-easy-crop';
import { avatarCropFromArea, avatarCropRect } from '../../avatar-image';
import { chineseFont, colors } from '../../theme';
import { AppButton } from '../ui';
import type { AvatarCropPreviewProps } from './AvatarCropPreview';

/** Presentation state only; the shared owner retains the authoritative pending crop. */
export function AvatarCropPreview({ image, crop, maxZoom, locked, onChange }: AvatarCropPreviewProps) {
  const labelId = useId();
  const mounted = useRef(true);
  const live = useRef({ image, locked, onChange });
  useLayoutEffect(() => { live.current = { image, locked, onChange }; });
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && live.current.image === image;
  const editable = () => current() && !locked && !live.current.locked;
  const [mediaSize, setMediaSize] = useState<MediaSize | null>(null);
  const [cropSize, setCropSize] = useState<Size | null>(null);
  const area = useRef<Area | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [pageScale, setPageScale] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const layoutWidth = Number.parseFloat(getComputedStyle(element).width);
      if (layoutWidth > 0) {
        const scale = element.getBoundingClientRect().width / layoutWidth;
        if (scale > 0) setPageScale(previous => previous !== null && Math.abs(previous - scale) < 1e-6 ? previous : scale);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); window.addEventListener('resize', measure); measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(crop.zoom);
  const [initialArea] = useState(() => {
    const rect = avatarCropRect(image.width, image.height, crop);
    return { x: rect.left / image.width * 100, y: rect.top / image.height * 100,
      width: rect.size / image.width * 100, height: rect.size / image.height * 100 };
  });
  // Keep the mature cropper's measured geometry and coordinate conversion. This
  // only chooses a bounded percentage-area offset for a single-pointer action.
  const move = (dx: number, dy: number) => {
    if (!editable() || !area.current || !mediaSize || !cropSize) return;
    const previous = area.current;
    const nextArea = { ...previous,
      x: Math.max(0, Math.min(100 - previous.width, previous.x + dx * previous.width / 5)),
      y: Math.max(0, Math.min(100 - previous.height, previous.y + dy * previous.height / 5)) };
    const next = getInitialCropFromCroppedAreaPercentages(nextArea, mediaSize, 0, cropSize, 1, maxZoom);
    setPosition(next.crop); setZoom(next.zoom);
  };
  const controlsDisabled = locked || !mediaSize || !cropSize;
  return <div style={{ width: '100%', maxWidth: 320, alignSelf: 'center', fontFamily: chineseFont, color: colors.muted }}>
    <div ref={viewport} style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 12, background: colors.ink }}>
      {/* Keep cropper layout and pointer pixels equal inside the app's existing CSS zoom. */}
      {pageScale !== null ? <div style={{ position: 'absolute', width: '100%', height: '100%', zoom: 1 / pageScale }}>
      <Cropper image={image.uri} crop={position} zoom={zoom} aspect={1} minZoom={1} maxZoom={maxZoom}
        cropShape="round" showGrid={false} objectFit="cover" initialCroppedAreaPercentages={initialArea}
        onCropChange={value => { if (editable()) setPosition(value); }} onZoomChange={value => { if (editable()) setZoom(value); }}
        setMediaSize={value => { if (current()) setMediaSize(value); }} setCropSize={value => { if (current()) setCropSize(value); }}
        onTouchRequest={editable} onWheelRequest={editable}
        cropperProps={{ 'aria-label': '頭像裁切範圍；可拖曳或用方向鍵移動', tabIndex: locked ? -1 : 0 }}
        style={{ containerStyle: { pointerEvents: locked ? 'none' : 'auto' } }}
        onCropAreaChange={value => {
          if (!current()) return;
          area.current = value;
          if (!editable()) return;
          const next = avatarCropFromArea(image.width, image.height, value, maxZoom);
          if (Math.abs(next.centerX - crop.centerX) > 1e-9 || Math.abs(next.centerY - crop.centerY) > 1e-9 || Math.abs(next.zoom - crop.zoom) > 1e-9) live.current.onChange(next);
        }} />
      </div> : null}
    </div>
    <p style={{ margin: '10px 0', fontSize: 16, lineHeight: 1.5 }}>拖曳圖片，或用方向按鈕移動裁切範圍。用下方滑桿縮放。</p>
    <div role="group" aria-label="以按鈕移動裁切範圍" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
      <AppButton label="向左" accessibilityLabel="裁切範圍向左" variant="quiet" disabled={controlsDisabled} onPress={() => move(-1, 0)} />
      <AppButton label="向右" accessibilityLabel="裁切範圍向右" variant="quiet" disabled={controlsDisabled} onPress={() => move(1, 0)} />
      <AppButton label="向上" accessibilityLabel="裁切範圍向上" variant="quiet" disabled={controlsDisabled} onPress={() => move(0, -1)} />
      <AppButton label="向下" accessibilityLabel="裁切範圍向下" variant="quiet" disabled={controlsDisabled} onPress={() => move(0, 1)} />
    </div>
    <label htmlFor={labelId} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
      縮放<input id={labelId} type="range" min={1} max={maxZoom} step={0.01} value={zoom} disabled={locked}
        aria-label="頭像縮放" onChange={event => { if (editable()) setZoom(Number(event.target.value)); }} style={{ flex: 1, minWidth: 0, minHeight: 44, accentColor: colors.teal }} />
    </label>
  </div>;
}
