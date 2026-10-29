import { Image, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { AvatarCrop } from '../../../../src/shared/avatars';
import type { AvatarImage } from '../../avatar-image';
import { chineseFont, colors, readingType, spacing } from '../../theme';

export interface AvatarCropPreviewProps {
  image: Pick<AvatarImage, 'uri' | 'width' | 'height'>;
  crop: AvatarCrop; maxZoom: number; locked: boolean;
  onChange(crop: AvatarCrop): void;
}

/** Native selection already returns the system crop; do not ask users to crop it again. */
export function AvatarCropPreview({ image }: AvatarCropPreviewProps) {
  return <View style={styles.preview}>
    <Image accessibilityLabel="待保存的頭像預覽" source={{ uri: image.uri }} style={styles.image} />
    <Text style={styles.note}>已選好裁切範圍。按「保存頭像」後才會更新。</Text>
  </View>;
}
const styles = StyleSheet.create({ preview: { alignItems: 'center', gap: spacing.sm },
  image: { width: 160, height: 160, borderRadius: 80 },
  note: { fontFamily: chineseFont, color: colors.muted, ...readingType.body } });
