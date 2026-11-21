import type { ReactNode, Ref } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { AppDialog } from '../AppDialog';
import { AppIcon, type AppIconName } from '../AppIcon';
import { chineseFont, colors, spacing } from '../../theme';

export type PersonalCardRows = {
  current: ReactNode[]; inactive: ReactNode[]; add: ReactNode; status: ReactNode; ready: boolean;
};
export function LibraryAction({ label, name = label, onPress, disabled, tone = 'plain', icon, buttonRef, expanded }: {
  label?: string; name?: string; onPress(): void; disabled?: boolean; tone?: 'plain' | 'shop' | 'join'; icon?: AppIconName; buttonRef?: Ref<View>; expanded?: boolean;
}) {
  const content = <>{icon ? <AppIcon name={icon} size={18} color={colors.deepTeal} /> : null}{label ? <Text style={s.actionText}>{label}</Text> : null}</>;
  return <Pressable ref={buttonRef} accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ disabled: !!disabled, expanded }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [s.action, tone === 'plain' && s.plain, disabled && s.disabled, pressed && (tone === 'plain' ? s.pressed : s.tintPressed)]}>
    {tone === 'plain' ? content : <View style={[s.tint, tone === 'shop' ? s.shop : s.join]}>{content}</View>}
  </Pressable>;
}
export function LibraryRow({ title, subtitle, art, action, onOpen, label, rowRef, testID, disabled }: {
  title: string; subtitle: string; art: 'health' | 'platform' | 'document' | 'directory' | 'bulletin';
  action?: ReactNode; onOpen?: () => void; label?: string; rowRef?: Ref<View>; testID?: string; disabled?: boolean;
}) {
  const body = <><View aria-hidden style={[s.art, art === 'health' ? s.health : art === 'bulletin' ? s.bulletin : s.document]}>
    {art === 'health' ? <><View style={s.leaf} /><View style={s.sun} /></> : <AppIcon name={art === 'document' || art === 'platform' ? 'book-open-variant' : 'file-document-outline'} size={24} />}
  </View><View style={s.copy}><Text style={s.name}>{title}</Text><Text style={s.meta}>{subtitle}</Text></View></>;
  return <View style={s.row} testID={testID}>{onOpen ? <Pressable ref={rowRef} accessibilityRole="button" accessibilityLabel={label ?? title}
    disabled={disabled} onPress={onOpen} style={({pressed}) => [s.open, pressed && s.pressed]}>{body}</Pressable> : <View style={s.open}>{body}</View>}{action}</View>;
}
export function SourceLibrary({ personal, shop, platformRows, ready, status }: {
  personal?: PersonalCardRows; shop?: ReactNode; platformRows?: ReactNode[]; ready: boolean; status?: ReactNode;
}) {
  return <View style={s.home}><View style={s.head}><Text accessibilityRole="header" style={s.title}>參考資料</Text>{shop}</View>
    <View><View style={s.group}><Text accessibilityRole="header" style={s.section}>目前的卡</Text>{personal?.add}</View>
      {personal?.current}{platformRows}
      {ready && (!personal || personal.ready) && !personal?.current.length && !platformRows?.length ? <Text style={s.empty}>尚未加入來源卡</Text> : null}
    </View>
    {personal?.inactive.length ? <View><View style={s.group}><Text accessibilityRole="header" style={s.section}>未啟用的個人卡</Text></View>{personal.inactive}</View> : null}
    {personal?.status}{status}
  </View>;
}
export function LibrarySheet({ title, close, children, wide, closeDisabled, action }: {
  title: string; close(): void; children: ReactNode; wide?: boolean; closeDisabled?: boolean; action?: ReactNode;
}) {
  return <AppDialog visible onDismiss={closeDisabled ? undefined : close} accessibilityLabel={title} style={wide ? s.wideSheet : s.sheet}>
    <View style={s.sheetHead}><Text accessibilityRole="header" style={[s.section, s.sheetTitle]}>{title}</Text>{action}
      <LibraryAction icon="close" name="關閉" disabled={closeDisabled} onPress={close} /></View>
    <AppDialog.ScrollArea style={s.scroll}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>{children}</ScrollView></AppDialog.ScrollArea>
  </AppDialog>;
}
const s = StyleSheet.create({
  home: { minWidth: 0, gap: spacing.xl },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: spacing.xs },
  title: { fontFamily: chineseFont, color: '#173C3A', fontWeight: '700', fontSize: 26, lineHeight: 34 },
  section: { fontFamily: chineseFont, color: '#173C3A', fontWeight: '700', fontSize: 18, lineHeight: 25, flexShrink: 1 },
  group: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', borderBottomWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center', paddingVertical: spacing.sm, minHeight: 65, borderBottomWidth: 1, borderColor: colors.softLine },
  open: { minHeight: 48, minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  art: { width: 40, height: 46, borderRadius: 6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  health: { backgroundColor: '#A6D5BD' }, leaf: { position: 'absolute', width: 27, height: 45, left: 3, top: 11, borderTopLeftRadius: 26, borderTopRightRadius: 8, backgroundColor: '#326E58', transform: [{rotate:'-12deg'}] },
  sun: { width: 15, height: 15, position: 'absolute', right: 5, top: 5, borderRadius: 8, backgroundColor: '#F6D858' },
  bulletin: { backgroundColor: '#F9D99D' }, document: { backgroundColor: '#CFDFEC' },
  copy: { flex: 1, minWidth: 0, gap: 2 }, name: { fontFamily: chineseFont, fontSize: 16, lineHeight: 22, fontWeight: '700', color: '#173C3A' },
  meta: { fontFamily: chineseFont, fontSize: 12, lineHeight: 18, color: '#526862' }, empty: { paddingVertical: 16, color: colors.muted },
  action: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
  plain: { gap: 4, paddingHorizontal: 5, borderRadius: 8 },
  tint: { minHeight: 26, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 8 },
  tintPressed: { opacity: 0.8 },
  actionText: { fontFamily: chineseFont, fontWeight: '600', fontSize: 13, lineHeight: 19, color: colors.ink, flexShrink: 1 },
  shop: { backgroundColor: '#D7EEE4', paddingHorizontal: 9 }, join: { backgroundColor: '#F5D65E', paddingHorizontal: 12 },
  disabled: { opacity: 0.52 }, pressed: { backgroundColor: colors.pressedOverlay },
  sheet: { maxWidth: 405 }, wideSheet: { maxWidth: 720 }, sheetHead: { marginTop: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 4, gap: 8, borderBottomWidth: 1, borderColor: colors.softLine },
  sheetTitle: { flex: 1 }, scroll: { paddingHorizontal: 0, flexShrink: 1 }, content: { minWidth: 0, paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
});
