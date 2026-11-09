// Type-only presentation admission checks. This file belongs in src when executed.
import { PhotosView } from './components/photos/PhotosView';
import { SummaryView } from './components/summary/SummaryView';
import { TaskKnowledgeSummaryContent } from './production/TaskKnowledgeSummaryContent';
import type { PhotosActions, PhotosViewModel } from './photo-view-model';
import type { SummaryActions, SummaryViewModel } from './summary-view-model';
import type { AttachmentReviewCollections } from './components/photos/AttachmentLibrary';

declare const photoModel: PhotosViewModel;
declare const photoActions: PhotosActions;
declare const summaryModel: SummaryViewModel;
declare const summaryActions: SummaryActions;
declare const attachments: AttachmentReviewCollections;
const onCare = () => {}, onRecord = (_id: string) => {}, onTask = (_id: string) => {};
const photoBase = { model: photoModel, actions: photoActions, onCare };
const photoMissingScope = { ...photoBase, mode: 'production' as const, attachments, onChat() {}, onChatPhoto() {} };
// @ts-expect-error Production photos require an authoritative scope.
PhotosView(photoMissingScope);
const photoMissingAdapters = { ...photoBase, mode: 'production' as const, scopeKey: 'synthetic-scope' };
// @ts-expect-error Production photos require their live attachment/read/navigation adapters.
PhotosView(photoMissingAdapters);
PhotosView({ ...photoMissingScope, scopeKey: 'synthetic-scope' });
PhotosView({ ...photoBase, mode: 'preview' });

const summaryBase = { model: summaryModel, actions: summaryActions, onRecord, onTask };
const recoveryMissingReturn = { ...summaryBase, mode: 'recovery' as const };
// @ts-expect-error Recovery always exposes a route back to the current workspace.
SummaryView(recoveryMissingReturn);
SummaryView({ ...recoveryMissingReturn, onReturn() {} });
SummaryView({ ...summaryBase, mode: 'report' });

const overviewMissingScope = { mode: 'overview' as const, onRecord, onTask };
// @ts-expect-error Overview requires both scopeKey and childId.
TaskKnowledgeSummaryContent(overviewMissingScope);
const overviewMissingChild = { ...overviewMissingScope, scopeKey: 'synthetic-scope' };
// @ts-expect-error A scope alone cannot select an overview child.
TaskKnowledgeSummaryContent(overviewMissingChild);
const overview = { ...overviewMissingChild, childId: 'synthetic-child' };
TaskKnowledgeSummaryContent(overview);
const contradictory = { ...overview, preparation: true };
// @ts-expect-error The old independent preparation boolean cannot contradict overview.
TaskKnowledgeSummaryContent(contradictory);
TaskKnowledgeSummaryContent({ mode: 'legacy-preparation', onRecord, onTask });
TaskKnowledgeSummaryContent({ mode: 'report', onRecord, onTask });
