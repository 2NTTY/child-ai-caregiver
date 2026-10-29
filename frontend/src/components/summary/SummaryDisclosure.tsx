import {useId, useState, type ReactNode} from 'react';
import {View} from 'react-native';
import {MotionDisclosure} from '../../motion';
import {AppButton} from '../ui';
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
    <AppButton nativeID={`${id}-trigger`} label={label} variant="quiet" expanded={open} controls={`${id}-content`}
      onPress={() => {setLocal({scopeKey, open: !open}); onExpandedChange?.(!open);}}
      style={[s.disclosureTrigger, appearance === "list" && s.disclosureListTrigger]} />
    <MotionDisclosure expanded={open} scopeKey={scopeKey} nativeID={`${id}-content`}>
      <View style={s.disclosureContent}>{children}</View>
    </MotionDisclosure>
  </View>;
}
