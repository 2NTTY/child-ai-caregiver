import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseKnowledgeSource } from "../server/knowledge-inputs.ts";
import { validateKnowledgeAssessment } from "../server/knowledge-review-assessment.ts";
import { LOCAL_OFFICIAL_SEED_IDS, buildLocalOfficialSeedAssessment } from "../scripts/local-knowledge-assessments.ts";

test("local official seed assessments validate all five DH sources cleanly", async () => {
  const manifest = JSON.parse(await readFile(new URL("../knowledge/local-development-seed.json", import.meta.url), "utf8"));
  const rawSources = JSON.parse(await readFile(new URL("../knowledge/hk-official-seed.json", import.meta.url), "utf8"));
  const parsed = rawSources.map((item: unknown) => parseKnowledgeSource(item));
  assert.deepEqual(parsed.map((item: { sourceId: string }) => item.sourceId), [...LOCAL_OFFICIAL_SEED_IDS]);
  for (const source of parsed) {
    const assessment = buildLocalOfficialSeedAssessment(source, manifest);
    assert.equal(assessment.decision, "approve");
    assert.notEqual(assessment.growthRuleImpact, "requires_review");
    const validated = validateKnowledgeAssessment(assessment, source, null);
    assert.equal(validated.changes.length, source.chunks.length);
  }
});

test("local review templates reject changed source content instead of approving a new edition", async () => {
  const rawSources = JSON.parse(await readFile(new URL("../knowledge/hk-official-seed.json", import.meta.url), "utf8"));
  for (const raw of rawSources.slice(1)) {
    const changed = parseKnowledgeSource(raw);
    changed.chunks[0].text += " Unreviewed change.";
    assert.throws(() => buildLocalOfficialSeedAssessment(changed), /new meaning review is required/, changed.sourceId);
  }
});

test("local review templates reject changed applicability but allow a refreshed fetch timestamp", async () => {
  const rawSources = JSON.parse(await readFile(new URL("../knowledge/hk-official-seed.json", import.meta.url), "utf8"));
  for (const raw of rawSources.slice(1)) {
    const changed = parseKnowledgeSource(raw);
    changed.chunks[0].applicability.conditions.push("Unreviewed condition");
    assert.throws(() => buildLocalOfficialSeedAssessment(changed), /new meaning review is required/, changed.sourceId);
    const refreshed = parseKnowledgeSource(raw);
    refreshed.fetchedAt = "2026-11-11T00:00:00.000Z";
    assert.equal(buildLocalOfficialSeedAssessment(refreshed).decision, "approve");
  }
});

