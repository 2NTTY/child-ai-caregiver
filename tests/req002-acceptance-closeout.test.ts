import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const PLAN = readFileSync(new URL("../PLAN.md", import.meta.url), "utf8");
const BACKLOG = readFileSync(new URL("../docs/REQUIREMENTS_BACKLOG.md", import.meta.url), "utf8");
const COMBINED = "#675–#677 組合驗收：同一版本的離線定向檢查已通過";

function sectionAt(markdown: string, anchor: string): string {
  const marker = `<a id="${anchor}"></a>`;
  const [, section] = markdown.split(marker);
  assert.ok(section, `Missing section: ${anchor}`);
  return section.split(/\n<a id="/u, 1)[0];
}

function uniqueLine(section: string, prefix: string): string {
  const lines = section.split(/\r?\n/u).filter(line => line.startsWith(prefix));
  assert.equal(lines.length, 1, `Expected exactly one row starting with ${prefix}`);
  return lines[0];
}

const closeout = sectionAt(PLAN, "req002-closeout01");

test("the active search entry links to the closeout and reports the verified offline gate", () => {
  const entry = sectionAt(PLAN, "agent-search-first").split("\n\n")[0];
  const line = uniqueLine(entry, "**主動通知交付後");
  assert.ok(line.includes("(#req002-closeout01)"));
  assert.ok(line.includes(COMBINED));
});

test("the matrix retains merged references, separate pinned branch receipts, 24 groups, 19 scenarios and 8 decisions", () => {
  const merged = [["600", "82f44a08"], ["601", "4d54f7e4"], ["602", "4c631853"], ["606", "39f2f322"],
    ["607", "3d6c6d3c"], ["608", "a3b6a24f"], ["640", "fcb231f3"], ["634", "3425c8f3"]];
  for (const [pr, sha] of merged) {
    const rows = closeout.split("\n").filter(row => row.includes(`/pull/${pr})`) && row.includes(sha));
    assert.equal(rows.length, 1);
    assert.match(rows[0], /Merged in `master`/u);
  }
  const snapshots = [
    ["3", "675", "codex/req002-batch-reuse-and-repair", "65bea4a3", "44490563606", "25 檔 231/231"],
    ["4", "676", "codex/req002-schema-and-metadata-trace", "5e7f60d2", "44490587749", "31 檔 284/284"],
    ["5", "677", "codex/req002-live-benchmark-and-disconnect", "8e3b72ca", "44490611318", "22 檔 220/220"],
    ["6", "678", "codex/req002-acceptance-closeout", "09b2a692", "44490633572", "22 檔 218/218"],
  ];
  for (const [ordinal, pr, branch, sha, run, manifest] of snapshots) {
    const row = uniqueLine(closeout, `| **PR ${ordinal}** |`);
    for (const token of [branch, `/pull/${pr})`, sha, `/actions/runs/${run})`, manifest, "分支離線 CI"]) {
      assert.ok(row.includes(token), `Missing branch receipt for #${pr}: ${token}`);
    }
  }

  for (let i = 1; i <= 24; i++) uniqueLine(closeout, `| **${String(i).padStart(2, "0")}** |`);
  for (let i = 1; i <= 19; i++) uniqueLine(closeout, `| **S72-${String(i).padStart(2, "0")}** |`);
  const [, decisions] = closeout.split("#### 5. REQ-002 §8 八項待決事項與不展開範圍結算");
  assert.ok(decisions);
  for (let i = 1; i <= 8; i++) uniqueLine(decisions, `${i}. **`);
});

test("product acceptance requires combined execution and independent live, deployed and physical-device evidence", () => {
  const combined = uniqueLine(closeout, "- **#675–#677 組合驗收");
  assert.ok(combined.includes(COMBINED));
  const receipt = uniqueLine(closeout, "- **整合收據：**");
  for (const token of ["/pull/675) `7bf1652eee6ccd5a97c721a476793f02e84fb309`", "/pull/676) `0b5a4afac7da13a52e7f2b7ffe28ef4c81c33db5`", "/pull/677) `29cee08024a2068192e11c2eee2febb32ecfb5fd`", "/commit/29cee08024a2068192e11c2eee2febb32ecfb5fd)", "https://github.com/2NTTY/child-ai-caregiver/actions/runs/44566154835/job/135708316545"]) assert.ok(receipt.includes(token));
  const steps = uniqueLine(closeout, "- **執行及逐項結果：**");
  for (const token of ["41 檔 337/337", "verify-req002-live-benchmark-offline.sh", "Server／root／frontend"]) assert.ok(steps.includes(token));
  assert.ok(combined.includes("這不是原站部署收據"));
  assert.match(uniqueLine(closeout, "> **歷史對照的範圍：**"), /組合待驗.*當時狀態/u);
  const external = uniqueLine(closeout, "- **獨立門檻：**");
  assert.match(external, /真模型 `--live` 付費比較待批准/u);
  assert.match(external, /原站部署與線上 OTel exporter 待核/u);
  assert.match(external, /Android／iOS 實機鍵盤、`fontScale`、TalkBack／VoiceOver 待驗/u);
  assert.match(uniqueLine(closeout, "| **01** |"), /組合待驗/u);
  assert.match(uniqueLine(closeout, "| **09** |"), /組合待驗/u);
  assert.match(uniqueLine(closeout, "| **22** |"), /記憶體 `Map`/u);
  assert.match(uniqueLine(closeout, "| **23** |"), /未驗證.*到達時間/u);
  assert.match(uniqueLine(closeout, "7. **"), /不構成付費授權/u);
});

test("both backlog entry points distinguish the verified offline gate from historical branch evidence", () => {
  const index = uniqueLine(BACKLOG, "| REQ-002 |");
  const [, body] = BACKLOG.split("\n# REQ-002｜Agent 提速、可見進度與分階段交付");
  assert.ok(body);
  const intro = uniqueLine(body.split("\n# REQ-", 1)[0], "**目前狀態：");
  for (const line of [index, intro]) {
    assert.ok(line.includes("../PLAN.md#req002-closeout01"));
    assert.ok(line.includes(COMBINED));
    assert.match(line, /分支.*收據/u);
    assert.doesNotMatch(line, /尚未實作/u);
  }
  assert.ok(intro.includes("不因離線合成測試通過而視為全包已驗收"));
});
