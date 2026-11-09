import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { visibleHandbookSections, type HandbookDateSection } from './presentation';
import { handbookStyles as styles } from './styles';

export interface HandbookDateListProps<T> {
  readonly sections: readonly HandbookDateSection<T>[];
  readonly readUnavailable: boolean;
  /** Preserve the current host's context, read/empty/recovery and announcement subtree. */
  readonly beforeGroups: ReactNode;
  /** Preserve owner MotionList, keyExtractor, refs, motion eligibility and guarded actions. */
  readonly renderRows: (section: HandbookDateSection<T>) => ReactNode;
  readonly pagination: ReactNode;
}
/** Only the schedule-list subtree. Host load-more stays outside the existing tab panel. */
export function HandbookDateList<T>({ sections, readUnavailable, beforeGroups, renderRows, pagination }: HandbookDateListProps<T>) {
  return <View style={styles.scheduleList}>
    {beforeGroups}
    {visibleHandbookSections(sections, readUnavailable).map(section => <View key={section.id} testID={`task-time-group-${section.id}`} style={styles.timeGroup}>
      <View style={styles.groupHeading}>
        <Text accessibilityRole="header" aria-level={2} style={styles.groupTitle}>{section.label}</Text>
        <Text style={styles.meta}>{section.items.length} 項</Text>
      </View>
      {renderRows(section)}
    </View>)}
    {pagination}
  </View>;
}
