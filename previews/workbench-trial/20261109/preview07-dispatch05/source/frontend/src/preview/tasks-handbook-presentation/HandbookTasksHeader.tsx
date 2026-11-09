import { Fragment, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { describeHandbookHeader, type HandbookHeaderAction } from './presentation';
import { handbookStyles as styles, handbookActionAppearance, type HandbookActionAppearance } from './styles';

export interface HandbookTasksHeaderProps {
  readonly compact: boolean;
  readonly access: 'editable' | 'read_only' | 'lost';
  /** Already includes host occupancy/selection/scene restrictions. Cannot grant access. */
  readonly disabled: boolean;
  /** Existing host controls/refs/guarded callbacks, with the supplied source appearance. */
  readonly renderAction: (action: HandbookHeaderAction, appearance: HandbookActionAppearance) => ReactNode;
}
/** JournalHeading + TasksView pageActions presentation. No owner or new action dispatcher. */
export function HandbookTasksHeader({ compact, access, disabled, renderAction }: HandbookTasksHeaderProps) {
  const heading = describeHandbookHeader(access, disabled);
  return <View style={styles.heading}>
    <View style={styles.headingCopy}>
      <Text accessibilityRole="header" aria-level={1} style={[styles.headingTitle, compact && styles.compactTitle]}>{heading.title}</Text>
    </View>
    {heading.actions.length > 0 ? <View style={styles.actions}>
      {heading.actions.map(action => <Fragment key={action.id}>{renderAction(action, handbookActionAppearance[action.variant])}</Fragment>)}
    </View> : null}
  </View>;
}
