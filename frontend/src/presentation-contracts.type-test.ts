// Compile-only contracts. This file is not imported by a route or runtime entry.
import type { ComponentProps } from "react";
import type { PhotosView } from "./components/photos/PhotosView";
import type { SummaryView } from "./components/summary/SummaryView";
import type { TaskKnowledgeSummaryContent } from "./production/TaskKnowledgeSummaryContent";
import type { PhotosActions, PhotosViewModel, PhotoItem } from "./photo-view-model";
import type { SummaryActions, SummaryViewModel } from "./summary-view-model";
import type { PhotoReaderNavigation } from "./navigation/usePhotoRouteSelection";
import type { AttachmentReviewCollections } from "./components/photos/AttachmentLibrary";

type PhotoProps = ComponentProps<typeof PhotosView>;
type SummaryProps = ComponentProps<typeof SummaryView>;
type KnowledgeProps = ComponentProps<typeof TaskKnowledgeSummaryContent>;
declare const photoModel: PhotosViewModel, photoActions: PhotosActions;
declare const summaryModel: SummaryViewModel, summaryActions: SummaryActions;
declare const navigation: PhotoReaderNavigation, attachments: AttachmentReviewCollections;
const onCare = () => {}, onRecord = (_id: string) => {}, onTask = (_id: string) => {};
const read = { navigation, attachments, onChat: () => {}, onChatPhoto: (_photo: PhotoItem) => {} };
const photo = { model: photoModel, actions: photoActions, onCare };
const production = { ...photo, mode: "production" as const, scopeKey: "synthetic-scope", read, capture: { capturePreferred: false } };
const preview = { ...photo, mode: "preview" as const };
const validProduction: PhotoProps = production;
const validPreviewWithoutLiveServices: PhotoProps = preview;
const { scopeKey: _scope, ...withoutScope } = production;
// @ts-expect-error Production photos must bind an authorized scope.
const invalidPhotoScope: PhotoProps = withoutScope;
const { read: _read, ...withoutRead } = production;
// @ts-expect-error Production photos require their real reader/attachment adapter.
const invalidPhotoRead: PhotoProps = withoutRead;
const { capture: _capture, ...withoutCapture } = production;
// @ts-expect-error Production capture intent is explicit; native/Web pickers remain platform-owned.
const invalidPhotoCapture: PhotoProps = withoutCapture;
const { onChatPhoto: _chatPhoto, ...incompleteRead } = read;
const missingLiveAction = { ...production, read: incompleteRead };
// @ts-expect-error The production saved-photo action cannot silently disappear.
const invalidLiveAction: PhotoProps = missingLiveAction;
const obsoletePhoto = { ...production, production: false };
// @ts-expect-error A legacy boolean must not contradict the explicit production mode.
const invalidPhotoBoolean: PhotoProps = obsoletePhoto;

const summary = { model: summaryModel, actions: summaryActions, onRecord, onTask };
const report = { ...summary, mode: "report" as const };
const recovery = { ...summary, mode: "recovery" as const, onReturn: () => {} };
const validReport: SummaryProps = report;
const validRecovery: SummaryProps = recovery;
const missingReturn = { ...summary, mode: "recovery" as const };
// @ts-expect-error A recovery reader must have a genuine return destination.
const invalidRecovery: SummaryProps = missingReturn;
const contradictoryRecovery = { ...report, recoveryMode: true };
// @ts-expect-error The old optional boolean cannot override the explicit report variant.
const invalidRecoveryBoolean: SummaryProps = contradictoryRecovery;

const knowledge = { onRecord, onTask };
const overview = { ...knowledge, mode: "overview" as const, scopeKey: "synthetic-scope", childId: "synthetic-child" };
const knowledgeReport = { ...knowledge, mode: "report" as const };
const legacy = { ...knowledge, mode: "legacy-preparation" as const };
const validOverview: KnowledgeProps = overview;
const validKnowledgeReport: KnowledgeProps = knowledgeReport;
const validLegacyWithoutAgent: KnowledgeProps = legacy;
const missingOverviewScope = { ...knowledge, mode: "overview" as const, childId: "synthetic-child" };
// @ts-expect-error Overview must be tied to an authorized scope.
const invalidOverviewScope: KnowledgeProps = missingOverviewScope;
const missingOverviewChild = { ...knowledge, mode: "overview" as const, scopeKey: "synthetic-scope" };
// @ts-expect-error Overview must name the child whose records it presents.
const invalidOverviewChild: KnowledgeProps = missingOverviewChild;
const contradictoryOverview = { ...overview, preparation: true };
// @ts-expect-error Overview cannot also be a legacy preparation editor.
const invalidOverviewPreparation: KnowledgeProps = contradictoryOverview;
const obsoletePresentation = { ...overview, presentation: "full" as const };
// @ts-expect-error The old presentation axis cannot override the explicit variant.
const invalidOverviewPresentation: KnowledgeProps = obsoletePresentation;

void [validProduction, validPreviewWithoutLiveServices, validReport, validRecovery,
  validOverview, validKnowledgeReport, validLegacyWithoutAgent];
