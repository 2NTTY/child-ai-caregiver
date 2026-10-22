import assert from "node:assert/strict";
import { test } from "node:test";
import { createHistoryFilters, historyCategories, historyDateErrors, historyDateRange, historyFilterReducer, normalizeHistoryCategory, normalizeReviewHistoryStatus, normalizeHistoryOlderOnly } from "../src/components/history/history-filters.ts";
import { desktopNavigationGroups, moreNavigationGroups, navigationItems } from "../src/components/navigation/app-navigation.ts";

test("history is discoverable in grouped Web navigation and mobile More", () => {
  assert.equal(navigationItems.history.href, "/history");
  assert.equal(desktopNavigationGroups.flatMap(group => group.keys).filter(key => key === "history").length, 1);
  assert.equal(moreNavigationGroups.flatMap(group => group.items).filter(item => item.key === "history").length, 1);
});

test("history deep links resolve only supported categories", () => {
  for (const { key } of historyCategories) assert.equal(normalizeHistoryCategory(key), key);
  assert.equal(normalizeHistoryCategory(["growth", "tasks"]), "growth");
  assert.equal(normalizeHistoryCategory("other-child"), "tasks");
  assert.equal(normalizeHistoryCategory(undefined), "tasks");
});

test("category changes preserve the original query and date input without storing source entries", () => {
  let filters = createHistoryFilters("identity:child:role", "tasks");
  filters = historyFilterReducer(filters, { type: "search", value: "  回診  " });
  filters = historyFilterReducer(filters, { type: "from", value: "2026-09-01" });
  filters = historyFilterReducer(filters, { type: "category", value: "care" });
  assert.deepEqual(filters, { scope: "identity:child:role", category: "care", searchText: "  回診  ", from: "2026-09-01", to: "" });
});

test("reset clears filters but keeps the current category and scope", () => {
  const filtered = { ...createHistoryFilters("one", "growth"), searchText: "private query", from: "2026-09-01", to: "2026-09-30" };
  assert.deepEqual(historyFilterReducer(filtered, { type: "reset" }), createHistoryFilters("one", "growth"));
});

test("scope change clears private search and dates before using another child or identity", () => {
  const filtered = { ...createHistoryFilters("one", "tasks"), searchText: "private query", from: "2026-09-01", to: "2026-09-30" };
  assert.equal(historyFilterReducer(filtered, { type: "scope", scope: "one", category: "tasks" }), filtered);
  assert.deepEqual(historyFilterReducer(filtered, { type: "scope", scope: "two", category: "tasks" }), createHistoryFilters("two", "tasks"));
});

test("date filters accept empty or inclusive same-day bounds and reject malformed or reversed dates", () => {
  assert.deepEqual(historyDateRange("", ""), { from: null, to: null });
  assert.deepEqual(historyDateRange("2026-09-01", ""), { from: "2026-09-01", to: null });
  assert.deepEqual(historyDateRange("2024-02-29", "2024-02-29"), { from: "2024-02-29", to: "2024-02-29" });
  assert.ok(historyDateErrors("2026-02-29", "").from);
  assert.ok(historyDateErrors("", "2026-9-1").to);
  assert.ok(historyDateErrors("2026-09-30", "2026-09-01").to);
  assert.equal(historyDateRange("2026-09-30", "2026-09-01"), null);
});


test("record review and preparation categories keep their own deep links and conservative filters", () => {
  assert.equal(normalizeHistoryCategory("review"), "review");
  assert.equal(normalizeHistoryCategory("preparations"), "preparations");
  assert.equal(historyCategories.find(item => item.key === "review")?.sourcePath, "/care");
  assert.equal(historyCategories.find(item => item.key === "preparations")?.sourcePath, "/growth?tab=preparation");
  assert.equal(historyCategories.find(item => item.key === "care")?.unavailable, "");
  for (const value of ["pending", "written", "confirmed", "skipped"] as const) assert.equal(normalizeReviewHistoryStatus(value), value);
  assert.equal(normalizeReviewHistoryStatus(["pending", "confirmed"]), "pending");
  assert.equal(normalizeReviewHistoryStatus("saved"), "all");
  assert.equal(normalizeReviewHistoryStatus(undefined), "all");
  assert.equal(normalizeHistoryOlderOnly("1"), true);
  assert.equal(normalizeHistoryOlderOnly(["1", "0"]), true);
  assert.equal(normalizeHistoryOlderOnly("true"), false);
  assert.equal(normalizeHistoryOlderOnly(undefined), false);
});


test("profile modifications have a separate category and canonical source without copied data", () => {
  assert.equal(normalizeHistoryCategory("profile"), "profile");
  const category = historyCategories.find(item => item.key === "profile");
  assert.equal(category?.label, "檔案修改"); assert.equal(category?.sourcePath, "/profile");
  assert.deepEqual(createHistoryFilters("identity:child:role", "profile"), { scope: "identity:child:role", category: "profile", searchText: "", from: "", to: "" });
});
