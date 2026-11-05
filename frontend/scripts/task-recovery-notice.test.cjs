'use strict';
// Focused JSX wiring tests, not React mount/DOM/browser acceptance.
// UI primitives and React hooks are deliberately shallow; production renderer bodies are exact.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), test = require('node:test');
const SRC = path.resolve(process.env.TASK_RECOVERY_SOURCE_ROOT || path.join(__dirname, '../..'));
const deps = { typescript: require('typescript'), zod: require('zod'), luxon: require('luxon') };
const ts = deps.typescript, loaded = new Set();
function deny() { throw new Error('Network is forbidden in task recovery wiring tests'); }
function makeLoader(overrides = {}) {
  const cache = new Map();
  function load(relative) {
    const full = path.resolve(SRC, relative);
    assert.ok(full.startsWith(SRC + '/'));
    if (cache.has(full)) return cache.get(full).exports;
    const original = fs.readFileSync(full, 'utf8'); loaded.add(path.relative(SRC, full));
    const module = { exports: {} }; cache.set(full, module);
    const requireLocal = name => {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === 'zod' || name === 'luxon') return deps[name];
      assert.ok(name.startsWith('.'), `Nonlocal dependency not explicitly stubbed: ${name}`);
      const base = path.resolve(path.dirname(full), name);
      const found = [base, base + '.ts', base + '.tsx'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      assert.ok(found, `Missing copied source: ${base}`);
      return load(path.relative(SRC, found));
    };
    const code = ts.transpileModule(original, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: requireLocal, console, fetch: deny,
      WebSocket: deny, EventSource: deny, navigator: { sendBeacon: deny }, AbortController, AbortSignal,
      Response, Request, Headers, URL, URLSearchParams, crypto: global.crypto, structuredClone, Intl, Date,
      setTimeout, clearTimeout, setImmediate, clearImmediate }, { filename: full });
    return module.exports;
  }
  return load;
}
const jsx=(type,props,key)=>({type,props,key});
const shallowReact={useState:initial=>[typeof initial==='function'?initial():initial,()=>{}],useRef:initial=>({current:initial}),useId:()=> 'reviewer-ui-id',useEffect(){},useLayoutEffect(){}};
const ui = Object.fromEntries(['AppButton','AppSelect','AppSelectionTrigger','AppTextField','SectionCard','SectionHeader','UnderlineTabs','AppTabPanel','TabToolbar'].map(x=>[x,x]));
const theme={chineseFont:'stub',colors:{},mobileLayout:{breakpoint:700,pageInset:8},mobileType:{},readingType:{},workspaceType:{},spacing:{md:8,lg:8,sm:8,xl:8},radius:{}};
function uiLoader(model) {
  return makeLoader({react:shallowReact,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},'react-native':{Platform:{OS:'native-stub'},View:'View',Pressable:'Pressable',StyleSheet:{create:x=>x}},'react-native-paper':{Text:'Text',TextInput:{Icon:'TextInput.Icon'}},'../../theme':theme,'../theme':theme,'./ui':ui,'../ui':ui,
    '../appearance/BackgroundSurface':{BackgroundSurface:'BackgroundSurface',useCustomBackground:()=>false},'../useContainerWidth':{useContainerWidth:()=>({width:1000,ref:{current:null},onLayout(){}})},'../../motion':{MotionDetail:'MotionDetail',MotionDisclosure:'MotionDisclosure',MotionList:'MotionList'},'../AppIcon':{AppIcon:'AppIcon'},'../AppScrollView':{AppScrollView:'ScrollView'},'./OperationNotice':{OperationNotice:'OperationNotice'},'../ReadStateNotice':{ReadStateNotice:'ReadStateNotice'},'../EmptyListCard':{EmptyListCard:'EmptyListCard'},'../StatusAnnouncement':{StatusAnnouncement:'StatusAnnouncement'},'./TaskListRow':{TaskListRow:'TaskListRow'},'./TaskDetail':{TaskDetail:'TaskDetail'},'../FormDialog':{FormDialog:'FormDialog'},'./TaskForm':{TaskForm:'TaskForm'},'./TasksCalendar':{TasksCalendar:'TasksCalendar'},'./TaskContent':{taskAssigneeLabel:()=> 'Synthetic reviewer',TaskSnapshot:'TaskSnapshot',TaskDraftSummary:'TaskDraftSummary'},
    '../../preview/PreviewNavigationGuard':{usePreviewLeaveGuard(){}},'react-hook-form':{Controller:'Controller',useWatch:()=> 'Asia/Hong_Kong',useForm:()=>({control:{},handleSubmit:()=>()=>{},getValues:()=>model.draft?.reviewedValues??model.draft?.initialValues,setFocus(){},formState:{isDirty:true,errors:{}}})},'@hookform/resolvers/zod':{zodResolver:()=>null},'../AppCheckbox':{AppCheckbox:'AppCheckbox'},'../DateTimeFields':{AppDateTimeField:'AppDateTimeField',AppTimeZoneSelect:'AppTimeZoneSelect'},'../FormErrorSummary':{FormErrorSummary:'FormErrorSummary',FormFieldMessage:'FormFieldMessage'}
  });
}
function nodes(value,result=[]) { if(Array.isArray(value)) value.forEach(x=>nodes(x,result)); else if(value&&typeof value==='object'&&value.props) {result.push(value); nodes(value.props.children,result);} return result; }

const empty = () => {};
function fixture(overrides = {}) {
  const model = { child: { id: 'synthetic-child', name: 'Synthetic child' }, access: 'editable',
    online: true, reading: false, readState: 'ready', dataLabel: 'Synthetic',
    scheduleContext: { asOf: '2026-11-05T07:00:00Z', timeZone: 'Asia/Hong_Kong' },
    items: [], eligibleAssignees: [], selected: null, hasMoreTasks: false, loadingMoreTasks: false,
    work: [], reminders: [], history: [], historyOpen: false, hasMoreHistory: false,
    draft: { key: 'synthetic-draft', mode: 'create', basis: null, initialValues: {}, reviewedValues: null }, latest: null,
    operation: { state: 'conflict', recovery: 'reload', message: 'Synthetic conflict', reference: null }, ...overrides };
  const calls = [];
  const recovery = { reloadCurrent: () => calls.push('reload'), checkOriginalOperation: () => calls.push('check'), retryOriginalOperation: () => calls.push('retry') };
  const actions = Object.fromEntries(['selectTask','closePanel','startCreate','startChange','reviewDraft','editDraft','submitReviewed','useLatestVersion','showHistory','loadOlderHistory','loadMoreTasks'].map(k => [k, empty]));
  return { model, recovery, actions, calls };
}
function projectedNotices(value) {
  const load = uiLoader(value.model), Notice = load('frontend/src/components/WriteRecoveryNotice.tsx').WriteRecoveryNotice;
  const view = load('frontend/src/components/tasks/TasksView.tsx').TasksView({ ...value, onAgent: empty, onHistory: empty });
  const all = nodes(view), dialog = all.find(x => x.type === 'FormDialog');
  return [...all.filter(x => x.type === Notice), dialog.props.recovery].map(x => ({ props: x.props, buttons: nodes(Notice(x.props)).filter(b => b.type === 'AppButton') }));
}
test('conflict reload exposes the original reload callback without creating a write', () => {
  const f = fixture(), Notice = uiLoader(f.model)('frontend/src/components/WriteRecoveryNotice.tsx').WriteRecoveryNotice;
  const buttons = nodes(Notice({ operation: f.model.operation, recovery: f.recovery, online: true })).filter(x => x.type === 'AppButton');
  assert.equal(buttons.length, 1); assert.equal(buttons[0].props.label, '重新載入');
  assert.equal(buttons[0].props.disabled, false); assert.equal(buttons[0].props.onPress, f.recovery.reloadCurrent);
  assert.deepEqual(f.calls, []); buttons[0].props.onPress(); assert.deepEqual(f.calls, ['reload']);
});
test('shared recovery phase matrix preserves check retry reload and missing callback boundaries', () => {
  const f = fixture(), Notice = uiLoader(f.model)('frontend/src/components/WriteRecoveryNotice.tsx').WriteRecoveryNotice;
  const expected = (state, mode) => {
    if ((state === 'failed' || state === 'conflict') && mode === 'check' || state === 'conflict' && mode === 'reload') return ['reloadCurrent'];
    if (state === 'unknown') return mode === 'reload' ? ['reloadCurrent'] : mode === 'retry' ? ['checkOriginalOperation', 'retryOriginalOperation'] : ['checkOriginalOperation'];
    return [];
  };
  for (const state of ['none', 'needs_confirmation', 'saving', 'saved', 'failed', 'unknown', 'conflict']) {
    for (const mode of [undefined, 'check', 'retry', 'reload']) {
      for (const online of [true, false]) for (const plainLanguage of [true, false]) {
        const operation = { state, recovery: mode, message: 'Synthetic', reference: 'synthetic-op' };
        const buttons = nodes(Notice({ operation, recovery: f.recovery, online, plainLanguage })).filter(x => x.type === 'AppButton');
        const wanted = expected(state, mode);
        assert.equal(buttons.length, wanted.length, `${state}/${mode}/${online}/${plainLanguage}`);
        buttons.forEach((button, i) => { assert.equal(button.props.onPress, f.recovery[wanted[i]]); assert.equal(button.props.disabled, !online); });
        for (const name of wanted) {
          const available = { ...f.recovery, [name]: undefined };
          const limited = nodes(Notice({ operation, recovery: available, online, plainLanguage })).filter(x => x.type === 'AppButton');
          assert.deepEqual(limited.map(x => x.props.onPress), wanted.filter(x => x !== name).map(x => available[x]));
        }
        assert.equal(nodes(Notice({ operation, online, plainLanguage })).filter(x => x.type === 'AppButton').length, 0);
      }
    }
  }
  assert.deepEqual(f.calls, [], 'Rendering must not execute recovery or create a mutation');
});
test('both TasksView recovery placements preserve identity and disable while offline or reading', () => {
  for (const online of [true, false]) for (const reading of [true, false]) {
    const f = fixture({ online, reading }), notices = projectedNotices(f);
    assert.equal(notices.length, 2);
    for (const notice of notices) {
      assert.equal(notice.props.operation, f.model.operation); assert.equal(notice.props.recovery, f.recovery);
      assert.equal(notice.props.online, online && !reading); assert.equal(notice.buttons.length, 1);
      assert.equal(notice.buttons[0].props.disabled, !online || reading);
      assert.equal(notice.buttons[0].props.onPress, f.recovery.reloadCurrent);
      if (!notice.buttons[0].props.disabled) notice.buttons[0].props.onPress();
    }
    assert.deepEqual(f.calls, online && !reading ? ['reload', 'reload'] : []);
  }
});
