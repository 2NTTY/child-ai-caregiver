import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {chromium} from '@playwright/test';
import {createFirebaseNodeHandler} from '../../server/firebase-http.ts';
import {createFirebaseRequestHandler} from '../../server/firebase-app.ts';

// Optional acceptance with a production Web export built for the same local API.
export async function askInBrowser(services,{userId,email,childId,workspaceId,question,expectedText,chunkId,pdfHash}) {
  const publicOrigin='http://127.0.0.1:40755',dist=resolve(process.env.CHART_PARENT_WEB_DIST);
  const token=randomUUID(),session={user:{id:userId,email,name:'Synthetic parent',emailVerified:true}};
  const get=headers=>headers.get('cookie')?.split('; ').includes('chart_parent='+token)?session:null;
  const auth={
    fromNodeHeaders:raw=>new Headers(Object.entries(raw).filter(([,v])=>v!==undefined)),
    getSession:async({headers,returnHeaders})=>returnHeaders?{response:get(headers),headers:new Headers()}:get(headers),
    handler:async request=>new URL(request.url).pathname==='/api/auth/get-session'
      ?Response.json(get(request.headers)):new Response(null,{status:404}),
  };
  const handler=createFirebaseRequestHandler({...services,publicOrigin,auth,mailConfigured:false});
  const server=createServer(createFirebaseNodeHandler({publicOrigin,auth,handler}));
  await new Promise((done,fail)=>server.once('error',fail).listen(40755,'127.0.0.1',done));
  let browser,page;
  const failures=[];
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext({viewport:{width:1360,height:920},serviceWorkers:'block'});
    await context.addCookies([{name:'chart_parent',value:token,url:publicOrigin,httpOnly:true,sameSite:'Strict'}]);
    await context.addInitScript(({key,childId,workspaceId})=>sessionStorage.setItem(key,JSON.stringify({childId,workspaceId})),
      {key:'yuban-child-selection-v1:'+JSON.stringify([publicOrigin+'/api',userId]),childId,workspaceId});
    await context.route(/^https?:/u,async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==publicOrigin) return route.abort();
      if(url.pathname.startsWith('/api/')) return route.continue();
      const path=decodeURIComponent(url.pathname);
      const file=resolve(dist,'.'+(extname(path)?path:path==='/'?'/index.html':path+'.html'));
      if(!file.startsWith(dist+sep)) return route.abort();
      try {await route.fulfill({path:file});} catch {await route.fulfill({status:404,body:''});}
    });
    page=await context.newPage();
    page.on('pageerror',error=>failures.push(error.message.slice(0,180)));
    page.on('response',response=>{
      const url=new URL(response.url());
      if(url.origin===publicOrigin && response.status()>=400) failures.push([response.status(),url.pathname]);
    });
    await page.goto(publicOrigin+'/chat');
    await page.getByRole('textbox',{name:'撰寫對話問題'}).fill(question,{timeout:18000});
    await page.getByRole('button',{name:'送出',exact:true}).click();
    await page.getByText(expectedText,{exact:false}).first().waitFor();
    const card=page.getByTestId('citation-card-1');
    assert.match(await card.getAttribute('aria-label'),/第 5 頁/u);
    await page.screenshot({path:resolve(dist,'../answer.png')});
    await card.click();
    const open=page.getByRole('button',{name:'查看當時 PDF'});
    await open.waitFor();
    await page.screenshot({path:resolve(dist,'../source.png')});
    const [response,popup]=await Promise.all([
      page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/citations/'+chunkId+'/original')),
      context.waitForEvent('page'),open.click(),
    ]);
    assert.equal(response.status(),200);
    assert.equal(createHash('sha256').update(await response.body()).digest('hex'),pdfHash);
    await popup.waitForURL(url=>url.protocol==='blob:' && url.hash==='#page=5');
  } catch(error) {
    if(page) console.error('Synthetic chat screen:',(await page.locator('body').innerText()).slice(-900),failures.slice(-10));
    throw error;
  } finally {
    await browser?.close();
    await new Promise(done=>{server.close(done);server.closeAllConnections();});
  }
}
