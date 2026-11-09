import { Linking, View } from 'react-native';
import { Text } from 'react-native-paper';
import { OFFICIAL_HELP, type OfficialHelpId } from '../../../../src/shared/agent-feedback';
import { AppButton } from '../ui';

/** Published fixed content; no modal, diagnosis or inferred permission. */
export function OfficialHelpCards({ ids }: { ids: readonly OfficialHelpId[] }) {
  return <>{[...new Set(ids)].map(id => {
    const card = OFFICIAL_HELP[id]; if (!card) return null;
    return <View key={id} testID="official-help-card" accessibilityLabel={card.title} accessibilityLiveRegion="polite">
      <Text variant="titleSmall">{card.title}</Text><Text selectable>{card.text}</Text>
      {card.sources.map(source => <AppButton key={source.url} variant="quiet" density="compact" label={source.title}
        onPress={() => { void Linking.openURL(source.url).catch(() => {}); }} />)}
    </View>;
  })}</>;
}
