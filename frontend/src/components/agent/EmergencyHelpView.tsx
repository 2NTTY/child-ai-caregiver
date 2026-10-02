import {Link} from 'expo-router';
import {Platform, Pressable, StyleSheet, View} from 'react-native';
import {Text} from 'react-native-paper';
import {chineseFont, colors, mobileLayout, spacing, typeScale} from '../../theme';
import {AppIcon} from '../AppIcon';
import {SectionCard, SectionHeader} from '../ui';

export interface EmergencyHelpData {text: string; checkedOn: string; sources: readonly {title: string; url: string}[]}
export function EmergencyHelpView({help}: {help: EmergencyHelpData}) {
  return <SectionCard testID="emergency-help"><SectionHeader title="緊急求助" icon="information-outline" />
    <Text style={s.body}>{help.text}</Text><View style={s.links}>{help.sources.map(source => <Link key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" asChild><Pressable accessibilityRole="link" accessibilityLabel={source.title} accessibilityHint="在瀏覽器開啟官方頁" style={s.link} {...(Platform.OS === 'web' ? {hrefAttrs: {target: '_blank', rel: 'noopener noreferrer'}} : {})}><Text style={s.linkText}>{source.title}</Text><AppIcon name="arrow-right" size={20} /></Pressable></Link>)}</View>
    <Text style={s.meta}>官方內容核對：{help.checkedOn}。此入口保持可見，不會自動致電或判斷緊急程度。</Text>
  </SectionCard>;
}
const s = StyleSheet.create({
  body: {fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23},
  meta: {fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20},
  links: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md},
  link: {minHeight: mobileLayout.touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '100%'},
  linkText: {fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, lineHeight: 23, textDecorationLine: 'underline', flexShrink: 1},
});
