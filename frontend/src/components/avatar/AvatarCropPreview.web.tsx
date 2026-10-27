import { useId, useLayoutEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { avatarCropFromArea, avatarCropRect } from '../../avatar-image';
import { chineseFont, colors } from '../../theme';
import type { AvatarCropPreviewProps } from './AvatarCropPreview';

/** Presentation state only; the shared owner retains the authoritative pending crop. */
export function AvatarCropPreview({ image, crop, maxZoom, locked, onChange }: AvatarCropPreviewProps) {
  const labelId = useId();
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
  return <div style={{ width: '100%', maxWidth: 320, alignSelf: 'center', fontFamily: chineseFont, color: colors.muted }}>
    <div ref={viewport} style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 12, background: colors.ink }}>
      {/* Keep cropper layout and pointer pixels equal inside the app's existing CSS zoom. */}
      {pageScale !== null ? <div style={{ position: 'absolute', width: '100%', height: '100%', zoom: 1 / pageScale }}>
      <Cropper image={image.uri} crop={position} zoom={zoom} aspect={1} minZoom={1} maxZoom={maxZoom}
        cropShape="round" showGrid={false} objectFit="cover" initialCroppedAreaPercentages={initialArea}
        onCropChange={value => { if (!locked) setPosition(value); }} onZoomChange={value => { if (!locked) setZoom(value); }}
        onTouchRequest={() => !locked} onWheelRequest={() => !locked}
        cropperProps={{ 'aria-label': '頭像裁切範圍；可拖曳或用方向鍵移動', tabIndex: locked ? -1 : 0 }}
        style={{ containerStyle: { pointerEvents: locked ? 'none' : 'auto' } }}
        onCropAreaChange={area => {
          if (locked) return;
          const next = avatarCropFromArea(image.width, image.height, area, maxZoom);
          if (Math.abs(next.centerX - crop.centerX) > 1e-9 || Math.abs(next.centerY - crop.centerY) > 1e-9 || Math.abs(next.zoom - crop.zoom) > 1e-9) onChange(next);
        }} />
      </div> : null}
    </div>
    <p style={{ margin: '10px 0', fontSize: 14 }}>拖曳圖片調整位置；用滾輪、雙指或下方滑桿縮放。</p>
    <label htmlFor={labelId} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
      縮放<input id={labelId} type="range" min={1} max={maxZoom} step={0.01} value={zoom} disabled={locked}
        aria-label="頭像縮放" onChange={event => setZoom(Number(event.target.value))} style={{ flex: 1, minWidth: 0, accentColor: colors.teal }} />
    </label>
  </div>;
}
