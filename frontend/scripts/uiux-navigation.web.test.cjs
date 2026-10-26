const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply an existing test-only JSDOM_MODULE.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'https://synthetic.invalid/growth' });
// Match the normal export: Head accessibility CSS precedes the later RN sheet.
const layoutSource = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
const accessibilityCss = layoutSource.match(/<style id="care-workspace-accessibility">\{`([\s\S]*?)`\}<\/style>/)[1];
const styleNode = dom.window.document.createElement('style'); styleNode.textContent = accessibilityCss.replace('${colors.teal}', '#2557CA'); dom.window.document.head.appendChild(styleNode);
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window); global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
let fetchCount = 0; global.fetch = () => { fetchCount++; throw new Error('Network forbidden'); };
const React = req('react'), { createRoot } = req('react-dom/client'), rn = req('react-native-web'), ts = req('typescript');
const cache = new Map(), pushes = []; let pathname = '/growth';
const MockDialog=Object.assign(({children,visible})=>visible?React.createElement(rn.View,{accessibilityRole:'dialog'},children):null,{Title:rn.View,Content:rn.View,Actions:rn.View});
const expoRoot = path.dirname(req.resolve('expo-router/package.json'));
// Real Expo BaseLink -> RN Slot -> Radix Slot -> RN Web Pressable. Only the
// router's navigation-state hook is isolated; no replacement anchor/Slot exists.
function expo(file) {
  const absolute = path.join(expoRoot, 'build', file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const mod = { exports: {} }; cache.set(absolute, mod); const ownRequire = createRequire(absolute);
  new Function('require', 'module', 'exports', fs.readFileSync(absolute, 'utf8'))(name => {
    if (name === 'react-native') return rn;
    if (name === './useLinkToPathProps') return { __esModule: true, default: ({ href }) => ({ href, role: 'link', onPress() {} }) };
    if (name === '../Prefetch') return { Prefetch: () => null };
    if (name === '../ui/Slot') return expo('ui/Slot.js');
    if (name === './useLinkHooks') return expo('link/useLinkHooks.js');
    return ownRequire(name);
  }, mod, mod.exports); return mod.exports;
}
const Link = expo('link/BaseExpoRouterLink.js').BaseExpoRouterLink;
function load(file) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const mod = { exports: {} }; cache.set(absolute, mod);
  const out = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { fileName: absolute, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', out)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return { Text: rn.Text, MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: x => x };
    if (name === 'expo-router') return { Link, useRouter: () => ({ push: href => pushes.push(href) }), usePathname: () => pathname };
    if (name === 'expo-router/react-navigation') return { useNavigation: () => ({}), usePreventRemove() {} };
    if (name.endsWith('/AppIcon')) return { AppIcon: ({ color }) => React.createElement('svg', { stroke: color }) };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: rn.ScrollView };
    if (name.endsWith('/PageFrame')) return { PageFrame: ({ children }) => React.createElement(rn.View, null, children) };
    if (name.endsWith('/AppDialog')) return { AppDialog: MockDialog };
    if (name.endsWith('/ui')) return { AppButton: ({label,onPress,disabled}) => React.createElement('button',{disabled,onClick:onPress},label), AppTextField: () => null };
    if (name.endsWith('/EmptyListCard')) return { EmptyListCard: () => null };
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(absolute), name);
    return load(fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx');
  }, mod, mod.exports); return mod.exports;
}
const { WorkspaceNavigation } = load('src/components/workspace/WorkspaceNavigation.tsx');
const { workspaceGroups, mobileNavigationKeyForPath } = load('src/components/workspace/workspace-navigation.ts');
const { navigationItems } = load('src/components/navigation/app-navigation.ts');
const More = load('src/screens/moreScreen.tsx').default;
// Exercise the exact AppShell skip JSX and stylesheet without substituting its
// Pressable or focus handler; domain/provider mounting is outside this leaf test.
const shellSource = fs.readFileSync(path.join(root, 'src/components/AppShell.tsx'), 'utf8');
const shellTree = ts.createSourceFile('AppShell.tsx', shellSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let skipNode, styleExpression, mobileFunction;
function visit(node) {
  if(ts.isFunctionDeclaration(node)&&node.name?.text==='MobileNavigationLink')mobileFunction=node;
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(p => p.name?.getText(shellTree) === 'testID' && p.initializer?.text === 'workspace-skip-link')) skipNode = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(shellTree) === 'styles') styleExpression = node.initializer;
  ts.forEachChild(node, visit);
}
visit(shellTree); assert.ok(skipNode && styleExpression);
const theme = load('src/theme.ts');
const probeModule = { exports: {} };
const probeCode = `const styles = ${styleExpression.getText(shellTree)}; export function SkipProbe({routeSurface}) { return ${skipNode.getText(shellTree)}; }`;
new Function('require', 'module', 'exports', 'Pressable', 'Text', 'Platform', 'StyleSheet', ...Object.keys(theme), ts.transpileModule(probeCode, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(req, probeModule, probeModule.exports, rn.Pressable, rn.Text, rn.Platform, rn.StyleSheet, ...Object.values(theme));
const { SkipProbe } = probeModule.exports;
const navigation=load('src/preview/PreviewNavigationGuard.tsx'),mobileModule={exports:{}};
const mobileCode=`const styles=${styleExpression.getText(shellTree)}; ${mobileFunction.getText(shellTree)}; export {MobileNavigationLink};`;
new Function('require','module','exports','useState','PreviewLink','Pressable','Text','StyleSheet','AppIcon','MobileNavSelection',...Object.keys(theme),ts.transpileModule(mobileCode,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText)(req,mobileModule,mobileModule.exports,React.useState,navigation.PreviewLink,rn.Pressable,rn.Text,rn.StyleSheet,()=>null,()=>null,...Object.values(theme));

const app = createRoot(document.getElementById('root'));
const render = async child => { await React.act(async () => app.render(null)); await React.act(async () => app.render(child)); };
test('real Expo Slot retains primary/local anchor backgrounds and hit-area styles across all workspace groups', async () => {
  for (const group of workspaceGroups) {
    pathname = navigationItems[group.items.at(-1)].href;
    await render(React.createElement(WorkspaceNavigation.Root, { pathname }, React.createElement(WorkspaceNavigation.Primary), React.createElement(WorkspaceNavigation.Local)));
    const primary = document.querySelector('a[aria-current="true"]'), local = document.querySelector('a[aria-current="page"]');
    assert.equal(primary.getAttribute('aria-label'), group.title); assert.equal(primary.getAttribute('href'), navigationItems[group.home].href);
    const active = getComputedStyle(primary); assert.equal(active.backgroundColor, 'rgb(24, 44, 69)');
    assert.equal(active.minHeight, '48px'); assert.equal(active.paddingLeft, '12px'); assert.equal(active.flexDirection, 'row');
    const label = [...primary.children].find(node => node.textContent === group.title); assert.equal(getComputedStyle(label).color, 'rgb(255, 255, 255)');
    assert.equal(primary.querySelector('svg').getAttribute('stroke'), '#FFFFFF');
    const current = getComputedStyle(local); assert.equal(current.minHeight, '44px'); assert.equal(current.paddingLeft, '12px'); assert.equal(current.borderBottomColor, 'rgb(37, 87, 202)');
    for (const link of document.querySelectorAll('[aria-label="主要工作區"] a')) assert.equal(getComputedStyle(link).minHeight, '48px');
    // Actual PreviewLink still owns prevention/navigation; styling does not replace it.
    const before = pushes.length; await React.act(async () => primary.click());
    assert.equal(pushes.length, before + (primary.getAttribute('href') === pathname ? 0 : 1));
  }
  assert.equal(fetchCount, 0);
});
test('feature directory keeps actual anchor card padding and guarded photos compatibility href', async () => {
  pathname = '/more'; await render(React.createElement(More));
  const links = [...document.querySelectorAll('a')]; assert.equal(links.length, 15);
  for (const link of links) { const style = getComputedStyle(link); assert.equal(style.minHeight, '84px'); assert.equal(style.paddingTop, '16px'); assert.equal(style.flexDirection, 'row'); }
  const photos = links.find(link => link.getAttribute('href') === '/care?view=photos'); assert.ok(photos);
  await React.act(async () => photos.click()); assert.deepEqual(pushes.at(-1), { pathname: '/care', params: { view: 'photos' } });
  assert.equal(fetchCount, 0);
});
test('actual mobile link leaf keeps one current purpose for every deep dashboard route',async()=>{
 const keys=['home','chat','tasks','care','more'];
 for(const item of Object.values(navigationItems)){
  pathname=item.href;const current=mobileNavigationKeyForPath(pathname);
  await render(React.createElement(rn.View,null,keys.map(key=>React.createElement(mobileModule.exports.MobileNavigationLink,{key,item:navigationItems[key],active:current===key}))));
  const selected=[...document.querySelectorAll('a[aria-current=true]')];assert.equal(selected.length,1);assert.equal(selected[0].getAttribute('href'),navigationItems[current].href);
 }
 assert.equal(mobileNavigationKeyForPath('/photos'),'care');assert.equal(mobileNavigationKeyForPath('/history'),'care');assert.equal(mobileNavigationKeyForPath('/growth'),'tasks');
 const native=fs.readFileSync(path.join(root,'app/(dashboard)/_layout.tsx'),'utf8');assert.match(native,/mobileDestination = mobileNavigationKeyForPath\(pathname\)/);assert.match(native,/accessibilityState=\{\{ \.\.\.props.accessibilityState, selected \}\}/);
});
test('real Expo link preserves modified/new-window intent and guards plain dirty navigation',async()=>{
 pathname='/chat';
 function DirtyLink(){navigation.usePreviewLeaveGuard(true);return React.createElement(navigation.PreviewLink,{href:'/tasks'},React.createElement(rn.Pressable,{accessibilityRole:'link',accessibilityLabel:'安排'},React.createElement(rn.Text,null,'安排')));}
 await render(React.createElement(navigation.PreviewNavigationGuard,null,React.createElement(DirtyLink)));
 const link=document.querySelector('a[aria-label="安排"]');
 for(const modifier of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]){
  const before=pushes.length,event=new window.MouseEvent('click',{bubbles:true,cancelable:true,...modifier});await React.act(async()=>link.dispatchEvent(event));
  assert.equal(event.defaultPrevented,false);assert.equal(pushes.length,before);assert.equal(document.querySelector('[role=dialog]'),null);
 }
 const before=pushes.length,event=new window.MouseEvent('click',{bubbles:true,cancelable:true});await React.act(async()=>link.dispatchEvent(event));assert.equal(event.defaultPrevented,true);assert.equal(pushes.length,before);
 const approve=[...document.querySelectorAll('button')].find(node=>node.textContent==='捨棄並離開');assert.ok(approve);await React.act(async()=>approve.click());assert.equal(pushes.at(-1),'/tasks');assert.equal(pushes.length,before+1);
 assert.equal(fetchCount,0);
});
test('actual AppShell skip link stays out of flex flow, fits both insets, and focuses main content', async () => {
  function Harness() { const routeSurface = React.useRef(null); return React.createElement(rn.View, null,
    React.createElement(SkipProbe, { routeSurface }), React.createElement(rn.View, { ref: routeSurface }, React.createElement(rn.View, { dataSet: { pageSurface: 'true' } }, React.createElement(rn.Text, null, 'Main')))); }
  await render(React.createElement(Harness));
  // RNW's jsdom injection can prepend its sheet, unlike the observed exported
  // page. Replay the actual generated rules last to verify the browser order.
  const lateRnStyles = document.createElement('style');
  lateRnStyles.textContent = rn.StyleSheet.getSheet().textContent;
  document.head.appendChild(lateRnStyles);
  const skip = document.querySelector('[data-testid="workspace-skip-link"]'), content = document.querySelector('[data-page-surface="true"]');
  let style = getComputedStyle(skip); assert.equal(style.position, 'absolute'); assert.equal(style.left, '16px'); assert.equal(style.right, '16px'); assert.equal(style.top, '-100px');
  await React.act(async () => skip.focus()); assert.equal(document.activeElement, skip); assert.ok(skip.matches(':focus'));
  // jsdom caches computed styles across pseudo-state changes. Reparse identical
  // CSS (no declaration/order change); actual focus geometry remains browser QA.
  styleNode.textContent += '\n'; style = getComputedStyle(skip); assert.equal(style.top, '12px');
  await React.act(async () => skip.click()); assert.equal(document.activeElement, content); assert.equal(content.tabIndex, -1);
  assert.equal(fetchCount, 0); await React.act(async () => app.unmount());
});
