import type {ReactNode} from 'react';
import type {StyleProp,ViewStyle} from 'react-native';
export type DirectionalPressableProps = {
  children: ReactNode; label: string; hint?: string; disabled?: boolean; expanded?: boolean; selected?: boolean; current?: boolean; testID?: string;
  style: StyleProp<ViewStyle>; scopeKey: string; onPress(): void; onExpand?(): void; onLongPress?(): void;
  onGestureStart(): void; onGestureMove(dx: number, dy: number): void;
  onGestureEnd(dx: number, dy: number, dragged: boolean): void; onGestureCancel(): void;
};
