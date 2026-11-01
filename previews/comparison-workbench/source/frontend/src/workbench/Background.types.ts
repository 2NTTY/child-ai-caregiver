import type {ImageSourcePropType} from 'react-native';
import type {PickedBackgroundImage} from '../background-view-model';
export type BackgroundContextValue = {
  source: ImageSourcePropType; selected: PickedBackgroundImage | null;
  busy: boolean; notice: string;
  select(image: PickedBackgroundImage): Promise<void>;
  restore(): Promise<void>;
  imageFailed(image: PickedBackgroundImage): void;
};
