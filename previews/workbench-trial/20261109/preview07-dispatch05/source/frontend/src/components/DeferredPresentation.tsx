import { Component, lazy, Suspense, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { AppButton } from './ui';

type BoundaryProps = { children: ReactNode; label: string; retry(): void };
class PresentationBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <View accessibilityLiveRegion="polite">
      <Text>未能載入{this.props.label}。原有草稿及操作狀態仍保留。</Text>
      <AppButton label={`重新載入${this.props.label}`} variant="secondary" onPress={this.props.retry} />
    </View> : this.props.children;
  }
}

/** Only presentation mounts here. Owners, drafts and navigation guards stay above this boundary. */
export function DeferredPresentation<P extends object>({ load, label, viewProps }: {
  load: () => Promise<{ default: ComponentType<P> }>;
  label: string;
  viewProps: P;
}) {
  const [attempt, setAttempt] = useState(0);
  const Content = useMemo(() => lazy(load), [load, attempt]);
  return <PresentationBoundary key={attempt} label={label} retry={() => setAttempt(value => value + 1)}>
    <Suspense fallback={<Text accessibilityLiveRegion="polite">正在載入{label}…</Text>}>
      <Content {...viewProps} />
    </Suspense>
  </PresentationBoundary>;
}
