import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import type { AppButtonAppearance } from '../../components/ui';
import { visibleCareSections, describeCarePagination, describeCareLoadMore, type CareDateSection, type CarePaginationInput, type CareLoadMoreInput, type CareActionPresentation } from './presentation';
import { careStyles as styles, careButtonAppearance } from './styles';

export interface CareDateListProps<T> {
  readonly sections: readonly CareDateSection<T>[];
  readonly readUnavailable: boolean;
  /** Accepted filters/context region, unchanged. No duplicate search/range state. */
  readonly context: ReactNode;
  /** Host read/empty/recovery/announcement subtree, optionally using CareReadState. */
  readonly readState: ReactNode;
  /** Owner MotionList, keyExtractor, eligibility, row ref and guarded actions. */
  readonly renderRows: (section: CareDateSection<T>) => ReactNode;
  readonly pagination: ReactNode;
}
export function CareDateList<T>({ sections, readUnavailable, context, readState, renderRows, pagination }: CareDateListProps<T>) {
  return <View style={styles.scheduleList}>
    {context}
    {readState}
    {visibleCareSections(sections, readUnavailable).map(section => <View key={section.id} testID={`task-time-group-${section.id}`} style={styles.timeGroup}>
      <View style={styles.groupHeading}>
        <Text accessibilityRole="header" aria-level={2} style={styles.groupTitle}>{section.label}</Text>
        <Text style={styles.meta}>{section.items.length} 項</Text>
      </View>
      {renderRows(section)}
    </View>)}
    {pagination}
  </View>;
}
export interface CareActionRenderer {
  readonly renderAction: (action: CareActionPresentation, appearance: AppButtonAppearance) => ReactNode;
}
/** Paging never mutates/clamps the owner page or captures a callback. */
export function CareDateListPagination(props: CarePaginationInput & CareActionRenderer) {
  const pagination = describeCarePagination(props);
  if (!pagination) return null;
  return <View style={styles.pagination}>
    {props.renderAction(pagination.previous, careButtonAppearance('quiet', 'compact'))}
    <Text style={styles.meta}>{pagination.label}</Text>
    {props.renderAction(pagination.next, careButtonAppearance('quiet', 'compact'))}
  </View>;
}
/** Host places this AFTER its existing AppTabPanel, not inside the schedule list. */
export function CareDateListLoadMore(props: CareLoadMoreInput & CareActionRenderer) {
  const more = describeCareLoadMore(props);
  if (!more) return null;
  return <View style={styles.loadMore}>
    <Text style={styles.meta}>{more.notice}</Text>
    {props.renderAction(more.action, careButtonAppearance('secondary', 'standard'))}
  </View>;
}
