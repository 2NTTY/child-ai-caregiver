// Controlled DOM layout only. Readiness, session and selection logic stay real.
export async function chatScreen(h,side,{ready=false,data=ready?'ready':'loading',gate={},ancestor={},witnesses={},text='育兒助手 合成示例 最近六則對話'}={}){
 const make=()=>h.document.createElement('div'),root=h.frame(side).appRoot,readyGate=make(),routes=make();
 readyGate.setAttribute('data-startup-state',ready?'ready':'loading');readyGate.setAttribute('data-startup-data',data);readyGate.setAttribute('aria-busy',String(!ready));
 if(ready)readyGate.setAttribute('data-testid','frontend-preview-ready');
 for(const [name,value]of Object.entries(gate))readyGate.setAttribute(name,value);
 routes.hidden=!!ancestor.hidden;routes.inert=!!ancestor.inert;routes.setAttribute('aria-hidden',String(!!ancestor.ariaHidden));Object.assign(routes.style,ancestor.style??{});
 for(const [key,id]of [['toolbar','chat-top-toolbar'],['panel','chat-reading-panel']]){
  const node=make(),shape=witnesses[key]??{};node.setAttribute('data-testid',shape.missing?'unrelated-'+key:id);node.textContent=text;
  node.hidden=!!shape.hidden;node.inert=!!shape.inert;if(shape.ariaHidden)node.setAttribute('aria-hidden','true');Object.assign(node.style,shape.style??{});
  if(shape.rect)node.getClientRects=()=>[shape.rect];routes.append(node);
 }
 if(!ready){const logo=make();logo.textContent='育有方 正在開啟育有方…';readyGate.append(logo);}
 readyGate.append(routes);root.replaceChildren(readyGate);await h.event('resize',{});return {gate:readyGate,routes};
}
