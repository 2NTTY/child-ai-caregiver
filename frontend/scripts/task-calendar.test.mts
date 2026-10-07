import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { createTaskFixture, taskPreviewClock } from "../src/preview/task-fixture.ts";
import { projectTaskBacklog, projectTaskCalendar, shiftTaskCalendarMonth, taskCalendarDate, taskCalendarDayLabel, taskCalendarItems, toggleTaskCalendarDay } from "../src/components/tasks/task-calendar.ts";

const fixture = createTaskFixture("calendar-child", "normal");
const ordinary = fixture.items.find(task => task.kind === "ordinary" && task.occurrence.state === "scheduled")!;

test("calendar derives pending dates and review dots from the same loaded task objects", () => {
  const before = JSON.stringify(fixture.items);
  const calendar = projectTaskCalendar(fixture.items, taskPreviewClock);
  const days = calendar.weeks.flat().filter(day => day !== null);
  assert.equal(calendar.month, "2026-10");
  assert.equal(calendar.currentDay, "2026-10-04");
  assert.equal(days.find(day => day.date === "2026-10-04")?.scheduled, 2);
  assert.equal(days.find(day => day.date === "2026-10-03")?.review, 1);
  assert.equal(days.reduce((count, day) => count + day.scheduled + day.review, 0), 4);
  assert.equal(calendar.unconfirmedCount, 0);
  assert.equal(JSON.stringify(fixture.items), before);
});

test("calendar and selected-day list use the viewing IANA zone across a UTC day boundary", () => {
  const task = { ...ordinary, occurrence: { ...ordinary.occurrence, dueAt: "2026-10-03T23:30:00Z" } };
  assert.equal(taskCalendarDate(task, "Asia/Hong_Kong"), "2026-10-04");
  assert.equal(taskCalendarDate(task, "UTC"), "2026-10-03");
  assert.equal(taskCalendarItems([task], "Asia/Hong_Kong", "2026-10-04")[0], task);
  assert.equal(taskCalendarItems([task], "UTC", "2026-10-04").length, 0);
  assert.equal(projectTaskCalendar([task], { asOf: "2026-10-03T23:30:00Z", timeZone: "Asia/Hong_Kong" }).currentDay, "2026-10-04");
});

test("month cells handle leap February, Monday-first alignment, and year rollover", () => {
  const leap = projectTaskCalendar([], { asOf: "2024-02-29T12:00:00Z", timeZone: "UTC" });
  assert.equal(leap.weeks.flat().filter(Boolean).length, 29);
  assert.deepEqual(leap.weeks[0].slice(0, 3), [null, null, null]);
  assert.equal(leap.weeks.flat().filter(Boolean).at(-1)?.date, "2024-02-29");
  assert.ok(leap.weeks.every(week => week.length === 7));
  assert.equal(projectTaskCalendar([], taskPreviewClock, "2025-02").weeks.flat().filter(Boolean).length, 28);
  assert.equal(shiftTaskCalendarMonth("2026-12", 1), "2027-01");
  assert.equal(shiftTaskCalendarMonth("2026-01", -1), "2025-12");
  assert.equal(shiftTaskCalendarMonth("2026-13", 1), null);
});

test("changing or completing a source item immediately changes the projection without copied task state", () => {
  const moved = { ...ordinary, occurrence: { ...ordinary.occurrence, dueAt: "2026-11-02T14:30:00+08:00" } };
  assert.equal(taskCalendarItems([moved], taskPreviewClock.timeZone, "2026-10-04").length, 0);
  assert.equal(taskCalendarItems([moved], taskPreviewClock.timeZone, "2026-11-02")[0], moved);
  const completed = { ...moved, occurrence: { ...moved.occurrence, state: "completed" as const } };
  assert.equal(taskCalendarItems([completed], taskPreviewClock.timeZone, null).length, 0);
  assert.equal(projectTaskCalendar([completed], taskPreviewClock, "2026-11").weeks.flat().find(day => day?.date === "2026-11-02")?.scheduled, 0);
});

test("selected-day filtering and clearing retain only current pending and review items", () => {
  const today = taskCalendarItems(fixture.items, taskPreviewClock.timeZone, "2026-10-04");
  assert.equal(today.length, 2);
  assert.ok(today.every(task => fixture.items.includes(task)));
  assert.equal(taskCalendarItems(fixture.items, taskPreviewClock.timeZone, "2026-10-03")[0].occurrence.state, "needs_review");
  assert.equal(taskCalendarItems(fixture.items, taskPreviewClock.timeZone, null).length, 4);
  assert.equal(taskCalendarItems(fixture.items, taskPreviewClock.timeZone, "2026-10-20").length, 0);
});

test("invalid and offset-free timestamps stay unconfirmed without a guessed day or device clock", () => {
  const invalid = { ...ordinary, occurrence: { ...ordinary.occurrence, dueAt: "invalid" } };
  const ambiguous = { ...ordinary, id: "no-offset", occurrence: { ...ordinary.occurrence, dueAt: "2026-10-04T10:00:00" } };
  const projection = projectTaskCalendar([invalid, ambiguous], taskPreviewClock);
  assert.equal(projection.unconfirmedCount, 2);
  assert.equal(projection.weeks.flat().reduce((sum, day) => sum + (day?.scheduled ?? 0), 0), 0);
  assert.equal(taskCalendarItems([invalid, ambiguous], taskPreviewClock.timeZone, null).length, 2);
  assert.equal(projectTaskCalendar(fixture.items, { ...taskPreviewClock, asOf: "invalid" }).month, null);
  assert.equal(projectTaskCalendar(fixture.items, { ...taskPreviewClock, timeZone: "Invalid/Zone" }).weeks.length, 0);
});

test("day names explain counts and review state without relying on dots or claiming complete coverage", () => {
  const days = projectTaskCalendar(fixture.items, taskPreviewClock).weeks.flat();
  assert.match(taskCalendarDayLabel(days.find(day => day?.date === "2026-10-04")!), /2026年10月4日.*已載入 2 項.*2 項待辦或預約/);
  assert.match(taskCalendarDayLabel(days.find(day => day?.date === "2026-10-03")!), /1 項待覆核/);
  assert.match(taskCalendarDayLabel(days.find(day => day?.date === "2026-10-05")!), /已載入資料未有安排/);
});

test("calendar JSX preserves button semantics, lock guards and loaded-only presentation", () => {
  const calendar = readFileSync(new URL("../src/components/tasks/TasksCalendar.tsx", import.meta.url), "utf8");
  const view = readFileSync(new URL("../src/components/tasks/TasksView.tsx", import.meta.url), "utf8");
  assert.match(calendar, /aria-pressed=\{selected\}/);
  assert.match(calendar, /taskCalendarDayLabel\(day\)/);
  assert.match(calendar, /disabled=\{disabled\}/);
  assert.match(calendar, /calendar\.unconfirmedCount > 0/);
  assert.match(view, /items=\{pending\} context=\{model.scheduleContext\}/);
  assert.match(view, /function selectCalendarDay\(day: string \| null\) \{\s+if \(occupied\) return;/);
  for (const [fileName, source] of [["TasksCalendar.tsx", calendar], ["TasksView.tsx", view]]) {
    const result = ts.transpileModule(source, { fileName, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
    assert.deepEqual(result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error), []);
  }
});

const allBacklog = { filter: "all" as const, selectedDay: null, query: "", page: 0 };
test("backlog defaults to seven local calendar days while older, review and later remain counted", () => {
  const result = projectTaskBacklog(fixture.items, taskPreviewClock, { ...allBacklog, filter: "near" }, fixture.eligibleAssignees);
  assert.equal(result.total, 2);
  assert.equal(result.counts.earlier, 1);
  assert.equal(result.counts.review, 1);
  assert.equal(result.counts.later, 1);
  assert.equal(result.counts.all, 4);
  assert.equal(result.nearLabel, "10月4日至10月10日");
  assert.ok(result.items.every(task => task.occurrence.dueAt.startsWith("2026-10-04")));
});

test("backlog near-term boundaries use the snapshot zone instead of UTC or the device clock", () => {
  const tasks = ["2026-10-03T15:59:00Z", "2026-10-03T16:00:00Z", "2026-10-10T15:59:00Z", "2026-10-10T16:00:00Z"].map((dueAt, index) => ({ ...ordinary, id: `boundary-${index}`, occurrence: { ...ordinary.occurrence, dueAt } }));
  const result = projectTaskBacklog(tasks, taskPreviewClock, { ...allBacklog, filter: "near" }, []);
  assert.deepEqual(result.items.map(task => task.id), ["boundary-1", "boundary-2"]);
  assert.equal(result.counts.earlier, 1);
  assert.equal(result.counts.later, 1);
});

test("backlog display pages retain every loaded pending item and clamp a shortened final page", () => {
  const tasks = Array.from({ length: 23 }, (_, index) => ({ ...ordinary, id: `pending-${index}`, title: `Task ${index}` }));
  const first = projectTaskBacklog(tasks, taskPreviewClock, allBacklog, []);
  const second = projectTaskBacklog(tasks, taskPreviewClock, { ...allBacklog, page: 1 }, []);
  const third = projectTaskBacklog(tasks, taskPreviewClock, { ...allBacklog, page: 2 }, []);
  assert.deepEqual([first.items.length, second.items.length, third.items.length], [10, 10, 3]);
  assert.deepEqual([third.from, third.to, third.total, third.pageCount], [21, 23, 23, 3]);
  assert.deepEqual([...first.items, ...second.items, ...third.items], tasks);
  assert.equal(projectTaskBacklog(tasks.slice(0, 11), taskPreviewClock, { ...allBacklog, page: 2 }, []).page, 1);
  assert.equal(projectTaskCalendar(tasks, taskPreviewClock).weeks.flat().find(day => day?.date === "2026-10-04")?.scheduled, 23);
});

test("backlog pages cover eleven and twenty-five same-day tasks without losing selected-day or search filters", () => {
  for (const size of [11, 25]) {
    const tasks = Array.from({ length: size }, (_, index) => ({ ...ordinary, id: `same-day-${index}`, title: `Match ${index}`,
      occurrence: { ...ordinary.occurrence, id: `same-day-occurrence-${index}` } }));
    for (const options of [allBacklog, { ...allBacklog, filter: "near" as const }, { ...allBacklog, filter: "later" as const, selectedDay: "2026-10-04", query: "match" }]) {
      const pageCount = Math.ceil(size / 10);
      const pages = Array.from({ length: pageCount }, (_, page) => projectTaskBacklog(tasks, taskPreviewClock, { ...options, page }, []));
      assert.deepEqual(pages.map(page => page.items.length), size === 11 ? [10, 1] : [10, 10, 5]);
      assert.deepEqual(pages.flatMap(page => page.items), tasks);
      assert.ok(pages.every(page => page.total === size && page.pageCount === pageCount));
      assert.equal(pages.at(-1)?.to, size);
      assert.equal(projectTaskBacklog(tasks, taskPreviewClock, { ...options, page: 99 }, []).page, pageCount - 1);
    }
    assert.equal(projectTaskCalendar(tasks, taskPreviewClock).weeks.flat().find(day => day?.date === "2026-10-04")?.scheduled, size);
  }
});

test("scope count badges receive structured numbers and preserve accessible radio and trigger states", () => {
  const view = readFileSync(new URL("../src/components/tasks/TasksView.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/components/ui.tsx", import.meta.url), "utf8");
  assert.match(view, /label: item.label, count: backlog.counts\[item.key\]/);
  assert.match(ui, /label: string; count\?: number/);
  assert.match(ui, /count=\{selected\?\.count\}/);
  assert.match(ui, /count !== undefined \? <SelectionCount count=\{count\}/);
  assert.match(ui, /item.count === undefined \? <RadioButton.Item/);
  assert.match(ui, /<SelectionCount count=\{item.count\}/);
  assert.match(ui, /accessibilityRole="radio" accessibilityLabel=\{`\$\{label\}選項：\$\{item.label\}，\$\{item.count\} 項`\}/);
  assert.match(ui, /accessibilityState=\{\{ checked, disabled \}\} aria-checked=\{checked\}/);
  assert.match(ui, /event.key !== " " && event.key !== "Spacebar"/);
  assert.match(ui, /selectionCount: \{ flexShrink: 0, minWidth: 28,.*backgroundColor: colors.sage/);
  const result = ts.transpileModule(ui, { fileName: "ui.tsx", compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.deepEqual(result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error), []);
});

test("backlog search and calendar-day filters use loaded titles, contents and eligible assignee names", () => {
  const query = projectTaskBacklog(fixture.items, taskPreviewClock, { ...allBacklog, query: "爸爸" }, fixture.eligibleAssignees);
  assert.equal(query.total, 1);
  assert.equal(query.items[0].title, "下次家庭回顧");
  assert.equal(query.counts.all, 4);
  const day = projectTaskBacklog(fixture.items, taskPreviewClock, { ...allBacklog, selectedDay: "2026-10-11", query: "家庭" }, fixture.eligibleAssignees);
  assert.equal(day.total, 1);
  assert.equal(projectTaskBacklog(fixture.items, taskPreviewClock, { ...allBacklog, query: "no loaded match" }, []).total, 0);
  assert.equal(projectTaskBacklog(fixture.items, taskPreviewClock, allBacklog, []).total, 4);
});

test("backlog unknown dates stay discoverable and no old item is completed or discarded", () => {
  const invalid = { ...ordinary, id: "unknown-date", occurrence: { ...ordinary.occurrence, dueAt: "invalid" } };
  const old = { ...ordinary, id: "old-pending", occurrence: { ...ordinary.occurrence, dueAt: "2020-01-01T10:00:00Z" } };
  const tasks = [invalid, old], before = JSON.stringify(tasks);
  assert.equal(projectTaskBacklog(tasks, taskPreviewClock, { ...allBacklog, filter: "unconfirmed" }, []).items[0], invalid);
  assert.equal(projectTaskBacklog(tasks, taskPreviewClock, { ...allBacklog, filter: "earlier" }, []).items[0], old);
  assert.equal(projectTaskBacklog(tasks, { ...taskPreviewClock, asOf: "invalid" }, allBacklog, []).counts.unconfirmed, 2);
  assert.equal(JSON.stringify(tasks), before);
});

test("backlog UI keeps remote loading separate and preserves guarded local filter/page state", () => {
  const view = readFileSync(new URL("../src/components/tasks/TasksView.tsx", import.meta.url), "utf8");
  assert.match(view, /useState<TaskBacklogFilter>\("near"\)/);
  assert.match(view, /projectTaskBacklog\(model.items, model.scheduleContext/);
  assert.match(view, /items=\{pending\} context=\{model.scheduleContext\}/);
  assert.match(view, /onPress=\{actions.loadMoreTasks\}/);
  assert.match(view, /仍有事項未載入；月曆、搜尋及數目只包括已載入事項/);
  assert.match(view, /setPage\(backlog.page [+-] 1\)/);
  assert.match(view, /rememberList\(task.id\); actions.selectTask\(task.id\)/);
  assert.match(view, /scrollTo\(\{ y: saved.position, animated: false \}\)/);
});

test("calendar date toggle cancels only an identical selected date", () => {
  assert.equal(toggleTaskCalendarDay(null, "2026-10-04"), "2026-10-04");
  assert.equal(toggleTaskCalendarDay("2026-10-04", "2026-10-04"), null);
  assert.equal(toggleTaskCalendarDay("2026-10-04", "2026-10-11"), "2026-10-11");
  assert.equal(toggleTaskCalendarDay("2026-10-11", null), null);
});

test("calendar date toggle restores the previous range and preserves the search text", () => {
  const options = { ...allBacklog, filter: "near" as const, query: "家庭" };
  const original = projectTaskBacklog(fixture.items, taskPreviewClock, options, fixture.eligibleAssignees);
  const selectedDay = toggleTaskCalendarDay(options.selectedDay, "2026-10-11");
  const selected = projectTaskBacklog(fixture.items, taskPreviewClock, { ...options, selectedDay }, fixture.eligibleAssignees);
  assert.equal(selected.items[0].title, "下次家庭回顧");
  const cleared = projectTaskBacklog(fixture.items, taskPreviewClock, { ...options, selectedDay: toggleTaskCalendarDay(selectedDay, "2026-10-11") }, fixture.eligibleAssignees);
  assert.deepEqual(cleared.items, original.items);
  assert.equal(cleared.items[0].kind, "appointment");
  assert.equal(options.query, "家庭");
  assert.equal(options.filter, "near");
});

test("calendar replacement uses the existing detail slot and keeps month state in the view owner", () => {
  const calendar = readFileSync(new URL("../src/components/tasks/TasksCalendar.tsx", import.meta.url), "utf8");
  const view = readFileSync(new URL("../src/components/tasks/TasksView.tsx", import.meta.url), "utf8");
  assert.match(view, /const \[calendarMonth, setCalendarMonth\] = useState<string \| null>\(null\)/);
  assert.match(view, /const \[calendarOpen, setCalendarOpen\] = useState\(false\)/);
  assert.match(view, /month=\{calendarMonth\}/);
  assert.match(view, /testID=\{showPanel \? "task-detail-panel" : "task-calendar-panel"\}/);
  assert.match(view, /<\/\> : calendar\}/);
  assert.match(view, /tab === "pending" && !wide && !model.reading \? <MotionDisclosure expanded=\{calendarOpen\}/);
  assert.doesNotMatch(view, /styles\.calendarColumn|styles\.scheduleWide|styles\.filterActions/);
  assert.doesNotMatch(calendar, /const \[month, setMonth\]/);
  const handler = view.slice(view.indexOf("function selectCalendarDay"), view.indexOf("const calendar ="));
  assert.match(handler, /toggleTaskCalendarDay\(current, day\)/);
  assert.doesNotMatch(handler, /setFilter|setQuery|setCalendarMonth/);
  assert.match(calendar, /onChangeMonth\(shiftTaskCalendarMonth/);
});
