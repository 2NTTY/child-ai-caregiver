import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from '../../theme';

/** The library supplies its current edition; chat supplies the edition stored with the answer. */
export function SourceDocumentCard({ title, byline, children, testID }: {
  title: string; byline: string; children: ReactNode; testID?: string;
}) {
  return <View testID={testID} style={styles.card}>
    <Text accessibilityRole="header" selectable style={styles.title}>{title}</Text>
    {byline ? <Text style={styles.byline}>{byline}</Text> : null}
    {children}
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.canvas, borderRadius: radius.small, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, flexShrink: 1 },
  byline: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
});
