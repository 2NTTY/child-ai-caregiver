import { Fragment, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { Text } from 'react-native-paper';
import type { AppButtonAppearance } from '../../components/ui';
import { describeCareHeader, type CareActionPresentation } from './presentation';
import { careStyles as styles, careButtonAppearance } from './styles';

export interface CareTasksHeaderProps {
  /** Care deliberately has no compact-only menu or title typography branch. */
  readonly compact: boolean;
  readonly access: 'editable' | 'read_only' | 'lost';
  readonly disabled: boolean;
  readonly showPanel: boolean;
  /** Existing host controls/refs/guarded callbacks. No new action owner. */
  readonly renderAction: (action: CareActionPresentation, appearance: AppButtonAppearance) => ReactNode;
}
/** Full source Workspace Root/Header/Heading/Actions shape without its context. */
export function CareTasksHeader({ access, disabled, showPanel, renderAction }: CareTasksHeaderProps) {
  const header = describeCareHeader(access, disabled, showPanel);
  return <View style={styles.root}>
    <View testID="workspace-header" style={styles.heading}>
      <View style={styles.headingCopy}>
        <Text accessibilityRole="header" {...(Platform.OS === 'web' ? { 'aria-level': 1 } : {})} style={styles.headingTitle}>{header.title}</Text>
      </View>
      {header.actions.length > 0 ? <View style={styles.actions}>
        <View testID="tasks-page-actions" style={styles.headerActions}>
          {header.actions.map(action => <Fragment key={action.id}>{renderAction(action, careButtonAppearance(action.variant, action.density))}</Fragment>)}
        </View>
      </View> : null}
    </View>
  </View>;
}
