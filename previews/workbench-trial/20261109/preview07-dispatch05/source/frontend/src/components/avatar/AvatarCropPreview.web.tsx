import { DeferredPresentation } from '../DeferredPresentation';
import type { AvatarCropPreviewProps } from './AvatarCropPreview';

const loadCrop = () => import('./AvatarCropPreviewContent.web');
export function AvatarCropPreview(props: AvatarCropPreviewProps) {
  return <DeferredPresentation load={loadCrop} label="頭像裁切" viewProps={props} />;
}
