const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'package.json')),React=req('react'),{renderToStaticMarkup}=req('react-dom/server'),rn=req('react-native-web'),ts=req('typescript');
const compile=source=>ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const theme={colors:{},spacing:{},chineseFont:'sans-serif'};
let width=1440;
const moduleResult={exports:{}};
new Function('require','module','exports',compile(fs.readFileSync(path.join(root,'src/components/workspace/Workspace.tsx'),'utf8')))(name=>{
 if(name==='react-native')return rn;if(name==='react-native-paper')return {Text:rn.Text};if(name.endsWith('/theme'))return theme;
 if(name.endsWith('/useContainerWidth'))return {useContainerWidth:()=>({width,ref:null,onLayout(){}})};return req(name);
},moduleResult,moduleResult.exports);
const {Workspace}=moduleResult.exports;
const source=fs.readFileSync(path.join(root,'src/components/ui.tsx'),'utf8'),tree=ts.createSourceFile('ui.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const header=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='SectionHeader'),headerModule={exports:{}};
new Function('require','module','exports','View','Text','useWindowDimensions','styles','mobileLayout','mobileIcons','mobileType','workspaceType','colors','AppIcon',compile(header.getText(tree)))(req,headerModule,headerModule.exports,rn.View,rn.Text,()=>({width}),{},{breakpoint:650},{content:24},{},{},{},()=>null);
const {SectionHeader}=headerModule.exports;
test('actual Workspace and shared SectionHeader produce one h1 followed by explicit h2/h3 with real RN Web SSR',()=>{
 for(width of [320,390,1024,1440]){
  const html=renderToStaticMarkup(React.createElement(Workspace.Root,{title:'照顧概況'},React.createElement(Workspace.Header,null,React.createElement(Workspace.Heading)),React.createElement(Workspace.Body,null,React.createElement(Workspace.Section,{title:'已知資料'},React.createElement(SectionHeader,{title:'來源與核對',headingLevel:3})),React.createElement(SectionHeader,{title:'照顧簡報'}))));
  assert.equal((html.match(/<h1\b/g)||[]).length,1);assert.equal((html.match(/<h2\b/g)||[]).length,2);assert.equal((html.match(/<h3\b/g)||[]).length,1);
  assert.ok(html.indexOf('<h1')<html.indexOf('<h2'));assert.ok(html.indexOf('<h2')<html.indexOf('<h3'));
 }
});
test('reviewed route-specific level plan is reflected in actual JSX rather than blind heading defaults',()=>{
 const plan=JSON.parse(fs.readFileSync(path.join(root,'verification/uiux-rebuild-v8/heading-level-plan.json'),'utf8'));
 for(const [file,expected] of Object.entries(plan.explicitLevels)){
  const contents=fs.readFileSync(path.join(root,'src',file),'utf8'),ast=ts.createSourceFile(file,contents,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),levels=[];
  function visit(node){if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
   const attrs=node.attributes.properties,role=attrs.find(x=>ts.isJsxAttribute(x)&&x.name.getText(ast)==='accessibilityRole');
   const level=attrs.find(x=>ts.isJsxAttribute(x)&&x.name.getText(ast)==='aria-level');
   if(role?.initializer?.text==='header'&&level&&ts.isJsxExpression(level.initializer)&&ts.isNumericLiteral(level.initializer.expression))levels.push(Number(level.initializer.expression.text));
  }ts.forEachChild(node,visit);}visit(ast);assert.deepEqual(levels,expected,file);
 }
 const login=fs.readFileSync(path.join(root,'src/screens/loginScreen.tsx'),'utf8');assert.equal((login.match(/accessibilityRole="header"/g)||[]).length,1);assert.match(login,/accessibilityRole="header" aria-level=\{1\} style=\{styles.formTitle\}/);
});
