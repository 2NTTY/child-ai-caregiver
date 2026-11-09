import {useId, useState, type ReactNode} from 'react';
import {Pressable, View} from 'react-native';
import {Text} from 'react-native-paper';
import {MotionDisclosure} from '../../motion';
import {AppIcon} from '../AppIcon';
import {summaryStyles as s} from './summary-styles';

// Summary evidence stays mounted while hidden so reading and form state survive.
export function SummaryDisclosure({label, scopeKey, children, expanded, onExpandedChange, appearance = "button"}: {
  label: string; scopeKey: string; children: ReactNode;
  appearance?: "button" | "list";
  expanded?: boolean; onExpandedChange?: (expanded: boolean) => void;
}) {
  const id = useId();
  const [local, setLocal] = useState({scopeKey, open: false});
  const open = expanded ?? (local.scopeKey === scopeKey && local.open);
  return <View style={s.disclosure}>
    <Pressable nativeID={`${id}-trigger`} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{expanded: open}} aria-expanded={open} aria-controls={`${id}-content`}
      onPress={() => {setLocal({scopeKey, open: !open}); onExpandedChange?.(!open);}}
      style={({pressed}) => [s.disclosureTrigger, appearance === "list" && s.disclosureListTrigger, pressed && s.pressed]}>
      <Text style={s.disclosureLabel}>{label}</Text><AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={18} />
    </Pressable>
    <MotionDisclosure expanded={open} scopeKey={scopeKey} nativeID={`${id}-content`}>
      <View style={s.disclosureContent}>{children}</View>
    </MotionDisclosure>
  </View>;
}
