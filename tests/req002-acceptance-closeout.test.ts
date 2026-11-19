import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PLAN_TEXT = readFileSync(new URL("../PLAN.md", import.meta.url), "utf8");
const BACKLOG_TEXT = readFileSync(new URL("../docs/REQUIREMENTS_BACKLOG.md", import.meta.url), "utf8");

function sliceReq002CloseoutSection(markdown: string): string {
  const start = markdown.indexOf('<a id="req002-closeout01"></a>');
  assert.notEqual(start, -1, "PLAN.md must contain <a id=\"req002-closeout01\"></a>");
  return markdown.slice(start);
}

test("PLAN.md#agent-search-first links directly to #req002-closeout01 and drops stale pending copy", () => {
  const anchorStart = PLAN_TEXT.indexOf('<a id="agent-search-first"></a>');
  assert.notEqual(anchorStart, -1);
  const block = PLAN_TEXT.slice(anchorStart, anchorStart + 900);
  assert.ok(block.includes("[REQ-002 收束與 24 組／19 場景對照](#req002-closeout01)"));
  assert.equal(block.includes("此流程待驗。"), false);
});

test("PLAN.md#req002-closeout01 covers all 8 merged PRs, PR 3-6 candidates, 24 IDs, 19 scenarios, and 8 open decisions", () => {
  const section = sliceReq002CloseoutSection(PLAN_TEXT);

  for (const token of [
    "#600", "#601", "#602", "#606", "#607", "#608", "#640", "#634",
    "82f44a08", "4d54f7e4", "4c631853", "39f2f322", "3d6c6d3c", "a3b6a24f", "fcb231f3", "3425c8f3",
    "codex/req002-batch-reuse-and-repair", "2ddc0bbf",
    "codex/req002-schema-and-metadata-trace", "54029065",
    "codex/req002-live-benchmark-and-disconnect", "8e3b72ca",
    "codex/req002-acceptance-closeout",
  ]) {
    assert.ok(section.includes(token), `Missing PR reference ${token}`);
  }

  for (let i = 1; i <= 24; i += 1) {
    const id = String(i).padStart(2, "0");
    assert.ok(section.includes(`| **${id}** |`), `Missing matrix row ID ${id}`);
  }

  for (let i = 1; i <= 19; i += 1) {
    const id = `S72-${String(i).padStart(2, "0")}`;
    assert.ok(section.includes(`| **${id}** |`), `Missing §7.2 scenario row ${id}`);
  }

  assert.ok(section.includes("#### 5. REQ-002 §8 八項待決事項與不展開範圍結算"));
  for (let i = 1; i <= 8; i += 1) {
    assert.ok(section.includes(`${i}. **`), `Missing §8 open decision #${i}`);
  }
});

test("PLAN.md#req002-closeout01 preserves honest boundaries without claiming live, production, or native phone completion", () => {
  const section = sliceReq002CloseoutSection(PLAN_TEXT);
  assert.match(section, /NOT_PUSHED/u);
  assert.match(section, /--live/u);
  assert.match(section, /TalkBack／VoiceOver/u);
  assert.match(section, /仍屬工程離線已實作與合成驗證完成／真機與真模型待驗收狀態/u);
});

test("docs/REQUIREMENTS_BACKLOG.md removes stale 尚未實作 wording for REQ-002 while keeping live/mobile acceptance pending", () => {
  const req002SummaryLine = BACKLOG_TEXT.split(/\r?\n/u).find(line => line.startsWith("| REQ-002 |"));
  assert.ok(req002SummaryLine, "REQ-002 summary row must exist");
  assert.ok(req002SummaryLine.includes("../PLAN.md#req002-closeout01"));
  assert.equal(req002SummaryLine.includes("尚未實作"), false);

  const req002HeadingIdx = BACKLOG_TEXT.indexOf("# REQ-002｜Agent 提速、可見進度與分階段交付");
  assert.notEqual(req002HeadingIdx, -1);
  const req002Intro = BACKLOG_TEXT.slice(req002HeadingIdx, req002HeadingIdx + 1200);
  assert.ok(req002Intro.includes("../PLAN.md#req002-closeout01"));
  assert.equal(req002Intro.includes("**目前狀態：需求與建議實施計劃，尚未實作。**"), false);
  assert.ok(req002Intro.includes("不因離線合成測試通過而視為全包已驗收"));
});
