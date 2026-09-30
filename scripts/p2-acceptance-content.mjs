import { createHash } from "node:crypto";

const TIME_ZONE = "Asia/Hong_Kong";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function check(condition, code) {
  if (!condition) throw new Error(code);
}

// Prepared public-API flow. Importing this module does not execute acceptance.
export async function verifyContent({ client, owner, caregiver, child, photo, now }) {
  check(UUID.test(child?.id ?? ""), "content_child_invalid");
  check(now instanceof Date && Number.isFinite(now.getTime()), "content_time_invalid");
  check(photo?.mimeType === "image/png" && typeof photo.base64 === "string"
    && /^[a-f0-9]{64}$/u.test(photo.sha256 ?? "")
    && Number.isInteger(photo.bytes) && photo.bytes > 0, "content_photo_invalid");

  const checks = [];
  let calls = 0;
  async function request(actor, path, body, expectedStatus = 200) {
    check(++calls <= 28, "content_call_limit");
    try {
      return await client.request(actor, path, body, expectedStatus);
    } catch {
      throw new Error("content_request_failed");
    }
  }
  async function write(actor, path, payload) {
    check(++calls <= 28, "content_call_limit");
    try {
      return await client.write(actor, path, payload);
    } catch {
      throw new Error("content_write_failed");
    }
  }

  const childPath = "/children/" + child.id;
  const eventAt = now.toISOString();
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const startDay = ["year", "month", "day"]
    .map(type => parts.find(part => part.type === type)?.value).join("-");
  const period = { startDay, period: "day", timeZone: TIME_ZONE };
  const summaryPath = childPath + "/summary?" + new URLSearchParams(period);
  const photoSource = "S16 synthetic photo";
  const feedingValues = {
    text: "Synthetic feeding: approximately 120 ml.",
    source: "Synthetic manual photo review",
    details: {
      kind: "feeding",
      quantity: { rawValue: "120", unit: "ml", precision: "approximate" },
      eventTime: { rawText: eventAt, at: eventAt, timeZone: TIME_ZONE, precision: "exact" },
    },
  };

  const reserved = (await write(owner, childPath + "/photos", {
    fileName: "s16-synthetic.png", mimeType: photo.mimeType,
    bytes: photo.bytes, sha256: photo.sha256, source: photoSource,
  }))?.photo;
  check(UUID.test(reserved?.id ?? "") && reserved.state === "reserved"
    && reserved.visibility === "private", "content_photo_reserve_invalid");
  const photoId = reserved.id;
  const photoPath = childPath + "/photos/" + photoId;

  const uploaded = (await request(owner, photoPath + "/content", { base64: photo.base64 }))?.photo;
  check(uploaded?.id === photoId && uploaded.state === "ready", "content_photo_upload_invalid");
  const restored = await request(owner, photoPath + "/content");
  check(Buffer.isBuffer(restored) && restored.length === photo.bytes
    && createHash("sha256").update(restored).digest("hex") === photo.sha256, "content_photo_round_trip_invalid");
  const metadata = uploaded;
  check(metadata?.id === photoId && metadata.childId === child.id && metadata.state === "ready"
    && metadata.visibility === "private" && metadata.sha256 === photo.sha256
    && metadata.bytes === photo.bytes && metadata.mimeType === photo.mimeType
    && metadata.source === photoSource && typeof metadata.createdAt === "string"
    && Number.isInteger(metadata.version) && metadata.version >= 0
    && metadata.extraction?.state === "not_requested", "content_photo_metadata_invalid");
  await request(caregiver, photoPath, undefined, 404);
  checks.push("photo_private_upload_metadata_integrity");

  const photoConfirmation = await write(owner, photoPath + "/confirm", {
    expectedVersion: metadata.version, confirmShared: true, values: feedingValues,
  });
  const photoRecordId = photoConfirmation?.recordId;
  const confirmedPhoto = photoConfirmation?.photo;
  check(UUID.test(photoRecordId ?? "") && confirmedPhoto?.id === photoId
    && confirmedPhoto.recordId === photoRecordId && confirmedPhoto.visibility === "shared"
    && Number.isInteger(confirmedPhoto.version), "content_photo_confirmation_invalid");
  const sharedPhoto = (await request(caregiver, photoPath))?.photo;
  check(sharedPhoto?.id === photoId && sharedPhoto.visibility === "shared"
    && sharedPhoto.recordId === photoRecordId && sharedPhoto.sha256 === photo.sha256
    && sharedPhoto.state === "ready" && sharedPhoto.extraction?.state === "not_requested",
  "content_photo_shared_read_invalid");
  checks.push("photo_manual_confirmation_shared");

  const originalText = "  Synthetic reference: 900 ml is a source example.\n  Original spacing is retained.  \n";
  const sourceLabel = "S16 synthetic source";
  const sourceUrl = "https://syntheticexample.invalid/p2-content";
  const sourceDateText = "2026-01-01 (synthetic source date)";
  const inputHash = createHash("sha256").update(originalText, "utf8").digest("hex");
  const createdInput = (await write(owner, childPath + "/inputs", {
    kind: "paste", text: originalText, sourceLabel, sourceUrl, sourceDateText,
  }))?.input;
  check(UUID.test(createdInput?.id ?? ""), "content_input_create_invalid");
  const inputId = createdInput.id;
  const inputPath = childPath + "/inputs/" + inputId;
  const savedInput = (await request(owner, inputPath))?.input;
  check(savedInput?.id === inputId && savedInput.childId === child.id
    && savedInput.kind === "paste" && savedInput.text === originalText
    && savedInput.sourceLabel === sourceLabel && savedInput.sourceUrl === sourceUrl
    && savedInput.sourceDateText === sourceDateText && savedInput.sha256 === inputHash
    && savedInput.fetchState === "ready" && savedInput.retrievedAt === null
    && savedInput.extraction?.state === "not_requested" && typeof savedInput.createdAt === "string"
    && Number.isInteger(savedInput.version), "content_input_preservation_invalid");
  await request(caregiver, inputPath, undefined, 404);
  checks.push("paste_original_text_and_source_metadata_preserved");

  const inputConfirmation = await write(owner, inputPath + "/confirm", {
    expectedVersion: savedInput.version, confirmShared: true,
    kind: "reference", confirmChildFact: false,
    values: {
      text: originalText, source: "Synthetic reference review",
      details: {
        kind: "feeding",
        quantity: { rawValue: "900", unit: "ml", precision: "exact" },
        eventTime: { rawText: eventAt, at: eventAt, timeZone: TIME_ZONE, precision: "exact" },
      },
    },
  });
  const inputRecordId = inputConfirmation?.recordId;
  const confirmedInput = inputConfirmation?.input;
  check(UUID.test(inputRecordId ?? "") && inputRecordId !== photoRecordId
    && confirmedInput?.id === inputId && confirmedInput.recordId === inputRecordId
    && confirmedInput.confirmationKind === "reference" && Number.isInteger(confirmedInput.version),
  "content_reference_confirmation_invalid");
  await request(caregiver, inputPath, undefined, 404);

  const carePage = await request(caregiver, childPath + "/care/search", {});
  check(Array.isArray(carePage?.records) && carePage.records.length === 2, "content_care_page_invalid");
  const feeding = carePage.records.find(record => record?.id === photoRecordId);
  const reference = carePage.records.find(record => record?.id === inputRecordId);
  check(feeding?.text === feedingValues.text && feeding.childId === child.id
    && feeding.details?.kind === "feeding" && feeding.details.quantity?.rawValue === "120"
    && feeding.details.quantity.unit === "ml" && feeding.details.quantity.precision === "approximate"
    && feeding.details.eventTime?.at === eventAt && feeding.details.eventTime.rawText === eventAt
    && feeding.details.eventTime.timeZone === TIME_ZONE && feeding.details.eventTime.precision === "exact"
    && feeding.source.includes(photoId) && feeding.source.includes(photo.sha256), "content_feeding_record_invalid");
  check(reference?.text === originalText && reference.childId === child.id
    && reference.details?.kind === "note" && reference.details.quantity === null
    && reference.details.eventTime?.at === null && reference.details.eventTime.rawText === ""
    && reference.details.eventTime.timeZone === TIME_ZONE && reference.details.eventTime.precision === "unknown"
    && reference.source.includes(inputId) && reference.source.includes(inputHash), "content_reference_record_invalid");
  checks.push("reference_shared_note_has_no_quantity_or_event_time");

  const summary = await request(caregiver, summaryPath);
  check(summary?.childId === child.id && summary.period?.startDay === startDay
    && summary.period.period === "day" && summary.period.timeZone === TIME_ZONE
    && summary.counts?.feeding === 1 && summary.counts.note === 0
    && Array.isArray(summary.records) && summary.records.length === 1
    && summary.records[0]?.id === photoRecordId
    && summary.missing?.unknownEventTime === 1 && summary.missing.invalidQuantities === 0
    && Array.isArray(summary.metrics) && summary.metrics.length === 1
    && typeof summary.basisVersion === "string" && Number.isInteger(summary.preparation?.version),
  "content_day_summary_invalid");
  const metric = summary.metrics[0];
  check(metric?.kind === "feeding" && metric.unit === "mL" && metric.total === "120"
    && metric.samples === 1 && metric.approximate === 1
    && Array.isArray(metric.recordIds) && metric.recordIds.length === 1
    && metric.recordIds[0] === photoRecordId, "content_summary_metric_invalid");
  checks.push("hong_kong_day_summary_only_approximate_120ml_feeding");

  const question = "Review the synthetic feeding record.";
  const checklistText = "Bring the synthetic record.";
  const preparation = (await write(owner, childPath + "/visit-preparation", {
    expectedVersion: summary.preparation.version, basisVersion: summary.basisVersion,
    confirmShared: true, appointmentTaskId: null, questions: [question],
    checklist: [{ text: checklistText, done: false }], reviewed: true, period,
  }))?.preparation;
  check(preparation?.version === summary.preparation.version + 1
    && preparation.reviewed === true && typeof preparation.reviewedBasis === "string",
  "content_preparation_save_invalid");
  const preparedSummary = await request(caregiver, summaryPath);
  const savedPreparation = preparedSummary?.preparation;
  check(preparedSummary?.reviewCurrent === true && savedPreparation?.version === preparation.version
    && savedPreparation.appointmentTaskId === null && savedPreparation.reviewed === true
    && savedPreparation.reviewedBasis === preparedSummary.basisVersion
    && savedPreparation.period?.startDay === startDay && savedPreparation.period.period === "day"
    && savedPreparation.period.timeZone === TIME_ZONE
    && Array.isArray(savedPreparation.questions) && savedPreparation.questions.length === 1
    && savedPreparation.questions[0] === question
    && Array.isArray(savedPreparation.checklist) && savedPreparation.checklist.length === 1
    && savedPreparation.checklist[0]?.text === checklistText && savedPreparation.checklist[0].done === false,
  "content_preparation_read_invalid");
  checks.push("visit_preparation_persisted_and_current");

  const inputDeletion = await write(owner, inputPath + "/delete", {
    expectedVersion: confirmedInput.version, confirmDelete: true,
  });
  check(inputDeletion?.deleted === true, "content_input_delete_invalid");
  await request(owner, inputPath, undefined, 404);
  const photoDeletion = await write(owner, photoPath + "/delete", {
    expectedVersion: confirmedPhoto.version, confirmDelete: true,
  });
  check(photoDeletion?.deleted === true && photoDeletion.cleanupPending === true,
    "content_photo_delete_invalid");
  await request(owner, photoPath, undefined, 404);
  const cleanedCare = await request(caregiver, childPath + "/care/search", {});
  check(Array.isArray(cleanedCare?.records) && cleanedCare.records.length === 0,
    "content_linked_records_delete_invalid");
  checks.push("module_input_photo_and_linked_records_deleted");

  const cleanedSummary = await request(caregiver, summaryPath);
  check(Array.isArray(cleanedSummary?.records) && cleanedSummary.records.length === 0
    && Array.isArray(cleanedSummary.metrics) && cleanedSummary.metrics.length === 0
    && cleanedSummary.counts?.feeding === 0 && cleanedSummary.counts.note === 0
    && cleanedSummary.missing?.unknownEventTime === 0
    && cleanedSummary.reviewCurrent === false
    && cleanedSummary.basisVersion !== savedPreparation.reviewedBasis
    && cleanedSummary.preparation?.version === preparation.version,
  "content_deleted_summary_basis_invalid");
  checks.push("deleted_sources_invalidate_summary_review");

  return { checks, photoId, inputId, recordIds: [photoRecordId, inputRecordId] };
}
