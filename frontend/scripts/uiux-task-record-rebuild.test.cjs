const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for the existing test-only jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<main id="root"></main>', { url: 'https://synthetic.invalid/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'ShadowRoot', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
let fetches = 0;
global.fetch = () => { fetches++; throw new Error('External requests are forbidden'); };
const React = req('react'), { createRoot } = req('react-dom/client'), RN = req('react-native-web'), ts = req('typescript'), e = React.createElement;
let width = 500;
const cache = new Map();
const Surface = ({ children }) => e('section', null, children);
const Text = ({ children, accessibilityRole, ...props }) => e('span', { role: accessibilityRole === 'header' ? 'heading' : undefined, 'aria-label': props.accessibilityLabel }, children);
function Button({ label, onPress, disabled, expanded }) { return e('button', { type: 'button', disabled, onClick: onPress, 'aria-expanded': expanded }, label); }
function Field({ ref, nativeID, id, label, accessibilityLabel, value, onChangeText, onChange, onBlur, disabled, multiline, ...props }) {
  return e('label', null, label, e(multiline ? 'textarea' : 'input', { ref, id: nativeID ?? id, 'aria-label': accessibilityLabel ?? label, value, disabled, onBlur, onChange: event => (onChangeText ?? onChange)(event.target.value), 'aria-invalid': props['aria-invalid'], 'aria-describedby': props['aria-describedby'] }));
}
function Select({ ref, label, options, value, onChange, disabled, onBlur, id }) {
  return e('label', null, label, e('select', { ref, id, value, disabled, onBlur, 'aria-label': label, onChange: event => onChange(event.target.value) }, options.map(option => e('option', { key: option.value, value: option.value }, option.label))));
}
function load(file) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, filename);
  new Function('require', 'module', 'exports', result.outputText)(name => {
    if (name === 'react-native') return RN;
    if (name === 'react-native-paper') return { Text, MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: x => x };
    if (name.endsWith('/ui')) return { AppButton: Button, AppTextField: Field, AppSelect: Select, SectionCard: Surface, SectionHeader: ({ title, subtitle }) => e('header', null, e('h2', null, title), subtitle), AppSelectionTrigger: ({ label, onPress, expanded }) => e(Button, { label, onPress, expanded }) };
    if (name.endsWith('/DateTimeFields')) return { AppDateTimeField: Field, AppTimeZoneSelect: props => e(Field, { ...props, label: '時區' }) };
    if (name.endsWith('/AppCheckbox')) return { AppCheckbox: ({ checked, onChange, disabled, label }) => e('label', null, e('input', { type: 'checkbox', checked, disabled, onChange: event => onChange(event.target.checked) }), label) };
    if (name.endsWith('/AppIcon')) return { AppIcon: () => null };
    if (name.endsWith('/AppStatusBadge')) return { AppStatusBadge: ({ label }) => e('span', null, label) };
    if (name.endsWith('/StatusAnnouncement')) return { StatusAnnouncement: ({ message }) => e('span', { role: 'status' }, message) };
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewLeaveGuard() {} };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width, ref: React.useRef(null), onLayout() {} }) };
    if (name.endsWith('/motion')) return { MotionReveal: ({ children, value }) => children(value), MotionDisclosure: ({ expanded, children }) => expanded ? children : null, MotionFeedback: Surface };
    if (name.endsWith('/FormErrorSummary')) return { FormErrorSummary: ({ entries, onFocus }) => e('div', { role: 'alert' }, entries.map(item => e('button', { key: item.field, onClick: () => onFocus(item.field) }, item.message))), FormFieldMessage: ({ error, help, id }) => e('span', { id }, error ?? help) };
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name), found = [target, target + '.ts', target + '.tsx'].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    assert.ok(found, name); return load(found);
  }, module, module.exports);
  return module.exports;
}
const { createTaskFixture, taskPreviewClock } = load('src/preview/task-fixture.ts');
const { emptyTaskForm, taskFormFromBasis } = load('src/components/tasks/task-form.ts');
const { TaskDetail } = load('src/components/tasks/TaskDetail.tsx');
const { TaskForm } = load('src/components/tasks/TaskForm.tsx');
const { TasksCalendar } = load('src/components/tasks/TasksCalendar.tsx');
const { TaskListRow } = load('src/components/tasks/TaskListRow.tsx');
const { CareRecordDetail } = load('src/components/care/CareRecordDetail.tsx');
const { CareRecordForm } = load('src/components/care/CareRecordForm.tsx');
const fixture = createTaskFixture('synthetic-child', 'normal');
const task = fixture.items[0];
const taskModel = overrides => ({ child: { id: 'synthetic-child', name: 'Synthetic child' }, access: 'editable', online: true, reading: false, scheduleContext: taskPreviewClock, items: fixture.items, eligibleAssignees: fixture.eligibleAssignees, selected: task, work: fixture.work, reminders: fixture.reminders, history: [], historyOpen: false, hasMoreHistory: false, draft: null, latest: null, operation: { state: 'none' }, ...overrides });
const values = { kind: 'feeding', text: '  合成觀察原文  ', source: '本人合成觀察', quantityRaw: '大約半碗', quantityUnit: '碗', quantityPrecision: 'approximate', eventTimeRaw: '午飯後一會兒', reason: '' };
const record = { id: 'synthetic-record', childId: 'synthetic-child', title: '合成飲食記錄', createdAtLabel: '合成加入時間', current: { version: 2, values, eventTimePrecision: 'unknown', timeZoneLabel: 'Asia/Hong_Kong', confirmedByLabel: '合成確認人', confirmedAtLabel: '合成確認時間' } };
const careModel = overrides => ({ access: 'editable', online: true, list: { state: 'ready' }, operation: { state: 'none' }, submitLabel: '確認保存共享記錄', draft: { key: 'care-draft', mode: 'create', initialValues: values, reviewedValues: null, basis: null }, ...overrides });
const renderer = createRoot(document.getElementById('root'));
const flush = async fn => React.act(async () => { fn?.(); await new Promise(setImmediate); });
async function render(element) { await flush(() => renderer.render(null)); await flush(() => renderer.render(element)); }
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
const click = label => flush(() => { assert.ok(button(label), label); button(label).click(); });
const input = label => document.querySelector(`[aria-label="${label}"]`);
async function change(node, value) { await flush(() => { const prototype = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value); node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); }

test('task detail keeps task-specific next steps, locks, history and terminal boundaries', async () => {
  const calls = [], actions = { startChange: (...args) => calls.push(args), closePanel: () => calls.push('close'), showHistory: () => calls.push('history') };
  await render(e(TaskDetail, { model: taskModel(), actions }));
  assert.match(document.body.textContent, /下一步/); assert.match(document.body.textContent, /提醒與進度/);
  await click('回報已完成'); assert.deepEqual(calls, [[task.id, 'complete']]);
  await render(e(TaskDetail, { model: taskModel({ operation: { state: 'unknown' } }), actions }));
  for (const label of ['回報已完成', '改期／轉派', '取消事項', '關閉詳情', '查看安排記錄']) assert.equal(button(label).disabled, true);
  await render(e(TaskDetail, { model: taskModel({ selected: { ...task, occurrence: { ...task.occurrence, state: 'needs_review' } } }), actions }));
  assert.equal(button('回報已完成'), undefined); await click('核對完成或取消'); assert.deepEqual(calls.at(-1), [task.id, 'resolve']);
  await render(e(TaskDetail, { model: taskModel({ selected: { ...task, occurrence: { ...task.occurrence, state: 'completed' } } }), actions }));
  assert.equal(button('改期／轉派'), undefined); assert.match(document.body.textContent, /不能直接重開/);
});

test('task editor retains RHF values across review, explicit confirmation and continue editing', async () => {
  let model = taskModel({ draft: { key: 'task-create', mode: 'create', initialValues: { ...emptyTaskForm(), title: '合成安排', details: '原始備註', assigneeUserId: fixture.eligibleAssignees[0].userId, dueAt: task.occurrence.dueAt, timeZone: task.occurrence.timeZone }, reviewedValues: null, basis: null } });
  let submits = 0, received;
  const draw = () => renderer.render(e(TaskForm, { model, actions }));
  const actions = { reviewDraft(next) { received = next; model = { ...model, operation: { state: 'needs_confirmation' }, draft: { ...model.draft, reviewedValues: next } }; draw(); }, editDraft() { model = { ...model, operation: { state: 'none' }, draft: { ...model.draft, reviewedValues: null } }; draw(); }, submitReviewed() { submits++; } };
  await render(e(TaskForm, { model, actions }));
  await change(input('事項標題'), '  更新合成安排  ');
  await click('預覽家庭共享內容'); assert.equal(received.title, '  更新合成安排  ');
  assert.equal(document.querySelector('[data-testid="task-editor-fields"]').getAttribute('aria-hidden'), 'true');
  assert.equal(button('確認建立共享事項').disabled, true); assert.equal(document.activeElement.getAttribute('aria-label'), '核對家庭共享安排');
  await flush(() => document.querySelector('input[type="checkbox"]').click()); await click('確認建立共享事項'); assert.equal(submits, 1);
  await click('繼續修改草稿'); assert.equal(document.activeElement.getAttribute('aria-label'), '編輯安排內容'); assert.equal(input('事項標題').value, '  更新合成安排  ');
  await click('預覽家庭共享內容'); assert.equal(document.querySelector('input[type="checkbox"]').checked, false);
  model = { ...model, operation: { state: 'unknown' } }; await flush(draw);
  assert.equal(button('確認建立共享事項').disabled, true); assert.equal(button('繼續修改草稿').disabled, true); assert.equal(submits, 1);
});

test('task reschedule validation and conflict rebase do not bypass original task eligibility', async () => {
  const calls = []; let model = taskModel({ draft: { key: 'reschedule', mode: 'reschedule', initialValues: taskFormFromBasis(task), basis: task, reviewedValues: null } });
  const actions = { reviewDraft: v => calls.push(v), editDraft() {}, useLatestVersion: () => calls.push('rebase') };
  await render(e(TaskForm, { model, actions })); await click('預覽家庭共享內容');
  assert.equal(calls.length, 0); assert.equal(document.activeElement === input('原因（必填）'), true);
  model = { ...model, operation: { state: 'conflict' }, latest: { ...task, occurrence: { ...task.occurrence, state: 'completed' } } };
  await render(e(TaskForm, { model, actions })); assert.equal(button('保留草稿並使用最新版本').disabled, true); assert.match(document.body.textContent, /你的未保存草稿/);
});

test('calendar offers every projected date at narrow widths and preserves the selected date across months', async () => {
  const calls = [], props = { items: fixture.items, context: taskPreviewClock, selectedDay: '2026-10-04', month: null, disabled: false, onSelectDay: day => calls.push(day), onChangeMonth: month => calls.push(month) };
  width = 500; await render(e(TasksCalendar, props));
  assert.equal(document.querySelectorAll('[data-testid^="task-calendar-day-"]').length, 31);
  const selected = document.querySelector('[data-testid="task-calendar-day-2026-10-04"]'); assert.equal(selected.getAttribute('aria-pressed'), 'true');
  await flush(() => selected.click()); assert.deepEqual(calls, ['2026-10-04']);
  width = 280; await render(e(TasksCalendar, props)); const select = input('選擇日期'); assert.equal(select.options.length, 32); assert.equal(select.value, '2026-10-04');
  await change(select, '2026-10-05'); assert.equal(calls.at(-1), '2026-10-05');
  await render(e(TasksCalendar, { ...props, month: '2026-11' })); assert.equal(input('選擇日期').value, '2026-10-04'); assert.match(input('選擇日期').selectedOptions[0].text, /其他月份/);
  await render(e(TasksCalendar, { ...props, disabled: true })); assert.equal(input('選擇日期').disabled, true);
});

test('care evidence reading preserves original values, version provenance, history retry and action guards', async () => {
  const calls = [], actions = { closePanel: () => calls.push('close'), startCorrection: id => calls.push(['correct', id]), startDeletion: id => calls.push(['delete', id]), showHistory: () => calls.push('history'), loadOlderHistory: () => calls.push('older') };
  const detail = { record, history: [], historyOpen: false, historyState: 'error', historyRetryMore: true };
  await render(e(CareRecordDetail, { detail, actions, canEdit: true, online: true }));
  assert.equal(document.activeElement.getAttribute('aria-label'), record.title);
  assert.ok(document.body.textContent.includes(values.text)); assert.ok(document.body.textContent.includes(values.eventTimeRaw)); assert.match(document.body.textContent, /事件時間尚未確定/);
  await click('來源、確認時間及版本'); assert.match(document.body.textContent, /合成確認人/);
  await click('更正這筆記錄'); await click('永久刪除此記錄及歷史'); assert.deepEqual(calls, [['correct', record.id], ['delete', record.id]]);
  await render(e(CareRecordDetail, { detail: { ...detail, historyOpen: true }, actions, canEdit: true, online: true, reading: true }));
  assert.equal(button('更正這筆記錄').disabled, true); assert.equal(button('永久刪除此記錄及歷史').disabled, true);
  await click('重試讀取歷史'); assert.equal(calls.at(-1), 'older');
});

test('care correction editor validates, previews exact raw evidence and retains fields on continue', async () => {
  let model = careModel({ draft: { key: 'care-revise', mode: 'revise', initialValues: { ...values, reason: '' }, reviewedValues: null, basis: record } }), received, submits = 0;
  const draw = () => renderer.render(e(CareRecordForm, { model, actions }));
  const actions = { reviewDraft(next) { received = next; model = { ...model, operation: { state: 'needs_confirmation' }, draft: { ...model.draft, reviewedValues: next } }; draw(); }, editDraft() { model = { ...model, operation: { state: 'none' }, draft: { ...model.draft, reviewedValues: null } }; draw(); }, submitReviewed() { submits++; } };
  await render(e(CareRecordForm, { model, actions })); await click('預覽共享內容'); assert.equal(received, undefined); assert.equal(document.activeElement === input('更正原因草稿'), true);
  await change(input('更正原因草稿'), '  合成更正原因  '); await click('預覽共享內容');
  assert.equal(received.reason, '  合成更正原因  '); assert.equal(received.text, values.text); assert.equal(received.quantityRaw, values.quantityRaw); assert.equal(received.eventTimeRaw, values.eventTimeRaw);
  assert.equal(document.querySelector('[data-testid="care-editor-fields"]').getAttribute('aria-hidden'), 'true'); assert.equal(document.activeElement.getAttribute('aria-label'), '核對家庭共享記錄'); await click('確認保存共享記錄'); assert.equal(submits, 1);
  await click('繼續修改'); assert.equal(document.activeElement.getAttribute('aria-label'), '編輯照顧記錄'); assert.equal(input('更正原因草稿').value, '  合成更正原因  ');
  await click('預覽共享內容'); model = { ...model, operation: { state: 'unknown' } }; await flush(draw);
  assert.equal(button('確認保存共享記錄').disabled, true); assert.equal(button('繼續修改').disabled, true);
});

test('task rows retain selected and disabled semantics at narrow and wide branches without external I/O', async () => {
  let calls = 0;
  for (width of [280, 390, 1024, 1440]) {
    await render(e(TaskListRow, { task, time: '09:00 前', assignee: '合成成員', selected: true, disabled: false, onPress: () => calls++ }));
    const row = document.querySelector('[data-testid^="task-row-"]'); assert.equal(row.getAttribute('aria-current'), 'true'); await flush(() => row.click());
  }
  assert.equal(calls, 4); await render(e(TaskListRow, { task, time: '09:00 前', assignee: '合成成員', selected: true, disabled: true, onPress: () => calls++ }));
  await flush(() => document.querySelector('[data-testid^="task-row-"]').click()); assert.equal(calls, 4); assert.equal(fetches, 0);
  await render(null);
});
