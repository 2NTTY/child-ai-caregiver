import { createHost } from './host.mjs';
import { readFixture } from './fixtures.mjs';
import { mount } from './view.mjs';
export async function bootstrap(root,{delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  let nextFault=null;
  const host=createHost({transport:async(op,args)=>{
    const fault=nextFault;nextFault=null;
    await delay(fault==='slow'?1800:180);
    if(fault==='access_denied')throw Object.assign(new Error('Synthetic access denied'),{status:403});
    if(fault==='invalid_cursor')throw Object.assign(new Error('Synthetic cursor expired'),{code:'invalid_cursor'});
    if(fault==='unavailable')throw new Error('Synthetic temporary read failure');
    const result=readFixture(op,args);
    if(fault==='empty_page') {
      if(op==='detail') {
        const kind=result.selected.kind==='teachers'?'members':'shares';
        result[kind]={items:[],nextCursor:`synthetic:${kind}:${args.spaceId}:3`};
      } else result.items=[];
    }
    return result;
  }});
  async function reset(){nextFault=null;const s=host.getSnapshot();host.setContext({identity:'synthetic-account-a',session:s.session+1,mode:'teachers',ready:true,online:true,globalChild:'synthetic-reading-child'});const binding=host.binding();const accepted=await host.loadSpaces(false,binding);if(!accepted||host.binding()!==binding)return;const first=host.getSnapshot().spaces.items[0];if(first)await host.selectSpace(first.id,binding);}
  async function fault(kind){if(!['access_denied','invalid_cursor','unavailable','empty_page','slow'].includes(kind)||host.getSnapshot().busy||!host.getSnapshot().online)return false;nextFault=kind;return host.refresh();}
  const view=mount(root,host,{fault,reset});
  await reset();
  return {host,fault,reset,destroy(){view.destroy();host.dispose();}};
}
if(typeof document!=='undefined') {
  const root=document.querySelector('#app');
  if(root)void bootstrap(root).catch(()=>{root.textContent='未能啟動合成候選。請重新整理本頁；沒有呼叫正式服務。';});
}
