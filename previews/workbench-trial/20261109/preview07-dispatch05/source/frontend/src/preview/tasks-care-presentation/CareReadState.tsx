import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native-paper';
import { describeCareReadNotice, type CareReadNoticeInput } from './presentation';
import { careStyles as styles } from './styles';

export interface CareEmptyStateProps {
  readonly title: string;
  readonly detail?: string;
  readonly testID?: string;
  readonly announcement: ReactNode;
  /** Existing owner clear action, using the accepted filters adapter when selected. */
  readonly children?: ReactNode;
}
/** Source EmptyListCard content. No icon is drawn by the historical component. */
export function CareEmptyState({ title, detail, testID = 'tasks-empty-card', announcement, children }: CareEmptyStateProps) {
  return <>
    {announcement}
    <View testID={testID} style={styles.emptyCard}>
      <View style={styles.emptyHeading}><Text style={styles.emptyTitle}>{title}</Text></View>
      {detail && detail !== title ? <Text style={styles.emptyDetail}>{detail}</Text> : null}
      {children}
    </View>
  </>;
}
export interface CareReadSurface {
  readonly testID: string;
  readonly padded: true;
  readonly style: StyleProp<ViewStyle>;
  readonly children: ReactNode;
}
export interface CareReadStateProps extends CareReadNoticeInput {
  /** Resolved by the EXISTING host read lifecycle, including its 500ms delay/scope. */
  readonly visible: boolean;
  readonly announcement: ReactNode;
  /** Existing spinner/reduced-motion node with Care indicator appearance if selected. */
  readonly indicator: ReactNode;
  /** Existing recovery action and its host authorization/disabled state. */
  readonly children?: ReactNode;
  /** Keep the existing host BackgroundSurface and ancestry; no source provider. */
  readonly renderSurface: (surface: CareReadSurface) => ReactNode;
}
/** Pure controlled content. Never computes read availability, starts a timer or reloads. */
export function CareReadState(props: CareReadStateProps) {
  const notice = describeCareReadNotice(props);
  if (!props.visible || props.state === 'ready') return <>{props.announcement}</>;
  if (props.state === 'empty') return <CareEmptyState title={notice.heading} detail={notice.detail} testID="read-state-empty" announcement={props.announcement}>{props.children}</CareEmptyState>;
  const content = <>
    {props.state === 'loading' ? props.indicator : null}
    <View style={styles.readCopy}>
      <Text accessibilityRole={notice.headingRole} aria-level={notice.headingLevel} style={props.title ? styles.readTitle : styles.readBody}>{notice.heading}</Text>
      {notice.detail ? <Text style={styles.readBody}>{notice.detail}</Text> : null}
      {props.children}
    </View>
  </>;
  return <>
    {props.announcement}
    {props.renderSurface({ testID: `read-state-${props.state}`, padded: true, style: [styles.readNotice, props.state === 'error' && styles.readError], children: content })}
  </>;
}
