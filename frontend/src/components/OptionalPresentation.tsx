import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { AppButton } from './ui';
import { colors, spacing } from '../theme';

class PresentationBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Call once at module scope. Only the view remounts; controllers and guards stay outside. */
export function createOptionalPresentation<Props extends object>(load: () => Promise<{ default: ComponentType<Props> }>, label: string) {
  const initial = lazy(load);
  return function OptionalPresentation(props: Props) {
    const [attempt, setAttempt] = useState(() => ({ View: initial, key: 0 }));
    const Feature = attempt.View;
    return <PresentationBoundary key={attempt.key} fallback={<View style={styles.status}>
      <Text role="status" style={styles.text}>暫時未能載入{label}。請重試，或使用本頁其他操作。</Text>
      <AppButton label={`重新載入${label}`} variant="secondary" onPress={() => setAttempt(current => ({ View: lazy(load), key: current.key + 1 }))} />
    </View>}>
      <Suspense fallback={<View style={styles.status}><Text role="status" style={styles.text}>正在載入{label}…</Text></View>}>
        <Feature {...props} />
      </Suspense>
    </PresentationBoundary>;
  };
}
const styles = StyleSheet.create({ status: { gap: spacing.md, paddingVertical: spacing.md }, text: { color: colors.muted } });
