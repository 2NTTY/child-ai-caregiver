const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),{createRequire}=require('node:module'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../../..'),req=createRequire(path.join(root,'package.json')),ts=req('typescript');
const file='frontend/src/screens/chatScreen.tsx',before=cp.execFileSync('git',['show','979219fa97532059afe0878c70433f06c23ffa7a:'+file],{cwd:root,encoding:'utf8'}),after=fs.readFileSync(path.join(root,file),'utf8');
function owner(text){const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),owner=ast.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='ChatContents');
 const transformed=ts.transform(owner.body,[context=>{
  const visit=node=>{if(ts.isJsxAttribute(node)){
   const name=node.name.getText(ast),value=node.initializer;
   if(name==='onLayout'&&value&&ts.isJsxExpression(value)&&['onToolbarLayout','onComposerLayout'].includes(value.expression?.getText(ast)))return undefined;
   if(name==='testID'&&value&&ts.isStringLiteral(value)&&['chat-timeline-frame','chat-composer-frame'].includes(value.text))return undefined;
  }return ts.visitEachChild(node,visit,context);};return root=>ts.visitNode(root,visit);
 }]);const output=ts.createPrinter({removeComments:true}).printNode(ts.EmitHint.Unspecified,transformed.transformed[0],ast);transformed.dispose();return output;}
assert.equal(owner(before),owner(after),'Business-owner body changed beyond two layout callbacks and two test IDs');
for(const file of ['frontend/src/components/chat/ChatTimeline.tsx','frontend/src/components/chat/useChatReadingAnchor.web.ts','frontend/src/components/chat/useChatInitialPosition.web.ts','frontend/src/components/agent/AgentComposer.tsx']) {
 const original=cp.execFileSync('git',['show','979219fa97532059afe0878c70433f06c23ffa7a:'+file],{cwd:root});assert.deepEqual(fs.readFileSync(path.join(root,file)),original,file);
}
console.log('PASS: ChatContents body AST unchanged except 2 measurement callbacks + 2 test IDs; timeline, zoom-correct anchor, initial-position and composer bytes unchanged.');
