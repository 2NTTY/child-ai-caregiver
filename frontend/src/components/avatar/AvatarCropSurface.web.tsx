import { createOptionalPresentation } from '../OptionalPresentation';
import type { AvatarCropPreviewProps } from './AvatarCropPreview';

export const AvatarCropSurface = createOptionalPresentation<AvatarCropPreviewProps>(
  () => import('./AvatarCropPreview.web').then(module => ({ default: module.AvatarCropPreview })), '頭像裁切');
