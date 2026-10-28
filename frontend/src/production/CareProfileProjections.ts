import type { CareRecord, CareRevision, CareValues, ChildProfile } from "../../../src/shared/care";
import { careKindOptions, type CareCaptureReview, type CareFormValues, type CareRecordView, type CareRevisionView } from "../care-view-model";
import type { ProfileRevisionView } from "../profile-view-model";

const time = (value: string) => new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
// A single-record history read supplies a real revision but no creation metadata.
export type CareSnapshot = CareRevision & Pick<CareRecord, "id" | "childId"> & { createdAt: string | null };
function importedConfirmationBasis(value: Pick<ChildProfile, "importedFrom">) {
  let basis = value.importedFrom?.current.source.confirmationBasis ?? null;
  for (const link of value.importedFrom?.previous ?? []) {
    if (basis !== "imported_source") break;
    basis = link.source.confirmationBasis;
  }
  return basis === "imported_source" ? null : basis;
}
function importedConfirmationLabel(value: Pick<ChildProfile, "confirmedBy" | "importedFrom">) {
  const basis = importedConfirmationBasis(value);
  return `${basis === null ? "來源資料" : "來源確認"}：${value.confirmedBy ?? "未提供確認人"}${basis === "preauthorized_user_statement"
    ? "（預先授權保存的使用者陳述；並非逐項確認的健康事實）" : ""}`;
}
export function careRevisionView(revision: CareRevision, userId: string | null): CareRevisionView {
  const { quantity, eventTime } = revision.details;
  return {
    version: revision.version,
    values: { kind: revision.details.kind, text: revision.text, source: revision.source,
      quantityRaw: quantity?.rawValue ?? "", quantityUnit: quantity?.unit ?? "", quantityPrecision: quantity?.precision ?? "approximate",
      eventTimeRaw: eventTime.rawText, reason: revision.reason },
    eventTimePrecision: eventTime.precision, timeZoneLabel: eventTime.timeZone,
    confirmedByLabel: revision.confirmationBasis === "imported_source" ? importedConfirmationLabel(revision)
      : `${revision.confirmedBy === userId ? "你" : revision.confirmedBy}${revision.confirmationBasis === "preauthorized_user_statement" ? "（預先授權保存的使用者陳述）" : ""}`,
    confirmedAtLabel: time(revision.confirmedAt),
  };
}
export function careRecordView(record: CareSnapshot, userId: string | null): CareRecordView {
  return { id: record.id, childId: record.childId, title: careKindOptions.find(item => item.value === record.details.kind)?.label ?? "照顧記錄",
    createdAtLabel: record.createdAt ? time(record.createdAt) : "未提供加入日期", current: careRevisionView(record, userId), history: [] };
}
export function careValuesFromForm(values: CareFormValues, basis: CareRevision | null): CareValues {
  // Unchanged raw time retains the original instant and precision. Edited raw text never invents an instant.
  const eventTime = basis?.details.eventTime.rawText === values.eventTimeRaw ? basis.details.eventTime
    : { rawText: values.eventTimeRaw, at: null, timeZone: basis?.details.eventTime.timeZone ?? "Asia/Hong_Kong",
      precision: values.eventTimeRaw ? "approximate" as const : "unknown" as const };
  return { text: values.text, source: values.source, details: { kind: values.kind,
    quantity: values.quantityRaw === "" && values.quantityUnit === "" ? null
      : { rawValue: values.quantityRaw, unit: values.quantityUnit, precision: values.quantityPrecision }, eventTime } };
}
export function profileRevisionView(profile: ChildProfile, userId: string | null): ProfileRevisionView {
  return { version: profile.version, data: profile.data,
    confirmedByLabel: profile.confirmationBasis === "imported_source" ? importedConfirmationLabel(profile)
      : profile.confirmedBy === null ? null : profile.confirmedBy === userId ? "你" : profile.confirmedBy,
    confirmedAtLabel: profile.confirmedAt ? time(profile.confirmedAt) : null, reason: profile.reason };
}
export function savedRecordReview(record: CareSnapshot, userId: string | null): CareCaptureReview {
  const savedRecord = careRecordView(record, userId);
  const imported = record.confirmationBasis === "imported_source";
  const sourceBasis = imported ? importedConfirmationBasis(record) : null;
  const statement = record.confirmationBasis === "preauthorized_user_statement"
    || imported && sourceBasis === "preauthorized_user_statement";
  const resolutionLabel = imported
    ? statement ? "已按來源的預先授權保存使用者陳述匯入；並非逐項確認的健康事實"
      : sourceBasis === "explicit" ? "已按來源確認資料匯入保存" : "已按來源資料匯入保存"
    : statement ? "已按預先授權保存使用者陳述；並非逐項確認的健康事實" : "已明確確認保存";
  // This is a read-only record projection, not a fabricated chat capture or pending proposal.
  return { id: `record:${record.id}`, version: record.version, childId: record.childId,
    title: savedRecord.title, createdAtLabel: savedRecord.createdAtLabel, originalText: record.text,
    sourceLabel: record.source, sourceId: record.id, sourceVersion: String(record.version),
    sourceScope: "family", sourceState: "ready", proposedValues: savedRecord.current.values,
    target: { kind: "create", scope: "family" }, targetDomain: "care_event", writeState: "saved",
    reviewRequirement: "optional", reviewState: imported || statement ? "not_required" : "confirmed",
    resolution: { label: resolutionLabel, recordId: record.id, recordVersion: record.version },
    uncertainties: [], savedRecord };
}
