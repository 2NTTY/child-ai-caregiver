/** Only the supplied shell presentation fields. No production owner or availability. */
import type {Dispatch,SetStateAction} from 'react';
import type {HomeActions,HomeViewModel} from '../view-model';
import type {StartupReadiness} from '../startup/dataReadiness';
import type {QuickInputKind} from '../components/navigation/quick-input-gesture';
export interface HostPort {
 model: HomeViewModel; actions: HomeActions; scopeKey: string; identityKey: string;
 notice: string; dismissNotice(): void;
 chatDraft: string; setChatDraft: Dispatch<SetStateAction<string>>; openAgentDraft(focusText?: boolean): void;
}
export interface SwitchReadiness {
 key: string; state: StartupReadiness; retry?: (additional?: readonly string[]) => void;
}
/** Bell consumes only scope identity; this harness ALWAYS returns null. */
export interface HistoryScopePort {readonly scopeKey: string;}
export interface NotificationPortProps {owner: HistoryScopePort|null; recent?: boolean;}
export interface QuickInputPortProps {supportedKinds?: readonly QuickInputKind[];}
