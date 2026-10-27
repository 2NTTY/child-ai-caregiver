import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { chineseFont, colors } from '../../theme';

/** Name always belongs to the current target; no cross-child image or initial cache. */
export function AvatarView({ name, uri, size = 56, subtle = false }: { name: string; uri: string | null; size?: number; subtle?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setFailed(null), [uri]);
  return <View accessibilityLabel={`${name || '目前對象'}的頭像`} accessibilityRole="image" style={[styles.avatar, subtle && styles.subtle, { width: size, height: size, borderRadius: size / 2 }]}>
    {uri && failed !== uri ? <Image source={{ uri }} accessible={false} onError={() => setFailed(uri)} style={{ width: size, height: size }} />
      : <Text accessible={false} style={[styles.initial, subtle && styles.subtleInitial, { fontSize: Math.round(size * .42) }]}>{Array.from(name.trim())[0] || '育'}</Text>}
  </View>;
}
const styles = StyleSheet.create({ avatar: { overflow: 'hidden', backgroundColor: colors.teal, alignItems: 'center', justifyContent: 'center' },
  subtle: { backgroundColor: colors.paleTeal, borderWidth: 1, borderColor: colors.sage }, subtleInitial: { color: colors.teal },
  initial: { fontFamily: chineseFont, color: colors.white, fontWeight: '800' } });
