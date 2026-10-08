import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
import {chromium} from '@playwright/test';
import {createAuth} from '../server/auth.ts';
import {createAccountAdmission} from '../server/account-admission.ts';
import {createStorageCipher,readSecretKey} from '../server/storage-crypto.ts';
import {openAccountRuntime} from '../server/account-runtime.ts';
import {createChatStore} from '../server/chat.ts';
import {createFamilyDocumentStore} from '../server/family-document-store.ts';

// One real local UI flow. Native verification/reset and erasure/restore reuse A08 evidence.
// No mail worker, model, embedding, notification or cloud operation is started here.
const root='C:/Users/2NTTY/.codex/p2-a08-local',api='http://localhost:8197',web='http://localhost:8217';
const diagnostic=process.argv.includes('--diagnose-account-only');
const accountOnly=process.argv.includes('--finish-account-only');
const finish=accountOnly||process.argv.includes('--finish-existing-only');
const cap=diagnostic?60:200, storeCap=12, children=[], fixtures=[], processes=[], checks=[];
let pool,browser,context,page,lastAction=null,stage='preflight',http=0,stores=0,blocked=0,lost=false,submissions=0,lookup=false,opId,child,baseline,account,cipher;
let success=false,diagnosticSuccess=false,apiLog='',webLog='';
const network=[],pageErrors=[],diagnosticCheckpoints=[];
const evidenceFile='artifacts/verification/P2_A07_UI_DIAGNOSTIC_'+new Date().toISOString().replace(/[:.]/gu,'-')+'.json';
const demand=(condition,code)=>{if(!condition)throw Error(code);};
const business=async fn=>{demand(++stores<=storeCap,'store_cap');return fn();};
const run=(args,env,cwd,kind)=>{const process=spawn(globalThis.process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});process.stdout.on('data',data=>{if(kind==='api')apiLog=(apiLog+data).slice(-2000);else webLog=(webLog+data).slice(-2000);});process.stderr.on('data',data=>{if(kind==='api')apiLog=(apiLog+data).slice(-2000);else webLog=(webLog+data).slice(-2000);});processes.push(process);return process;};
function safePath(path){return path.replace(/\/api\/auth\/reset-password\/[^/]+/u,'/api/auth/reset-password/:token').replace(/\/api\/children\/[^/]+/u,'/api/children/:child').replace(/\/api\/online\/operations\/[^/]+/u,'/api/online/operations/:operation').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu,':id');}
async function safeDOM(){
 if(!page)return null;
 return page.evaluate(()=>{
  const known=new Set(['電郵地址','密碼','孩子稱呼','登入','建立帳戶','電郵登入','註冊帳戶','忘記密碼','重新要求驗證指引','重新確認帳戶服務','重新檢查登入狀態','同意並繼續','我已閱讀並同意以上資料使用說明','新增或管理孩子','收起孩子管理','核對新增孩子','確認新增孩子','查核原建立操作','請輸入密碼。','請輸入有效電郵地址。','請填寫称呼。','請先完成電郵驗證，再登入。可在本頁重新要求驗證指引。','未能登入，請核對電郵及密碼後再試。','未能確認帳戶服務；私人內容已隱藏。請重新檢查。','歡迎回來','開始前，了解資料的使用方式','確認帳戶服務','請先完成電郵驗證','沒有可切換的孩子。','正在讀取帳戶狀態…']);
  const visibility=node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return {visible:style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0,opacity:style.opacity,inert:!!node.closest('[inert]'),ariaHidden:!!node.closest('[aria-hidden="true"]')};};
  const label=node=>{const text=(node.getAttribute('aria-label')??node.textContent??'').trim();return known.has(text)?text:'<redacted-label>';};
  return {startup:Array.from(document.querySelectorAll('[data-startup-state]')).map(node=>({state:node.getAttribute('data-startup-state'),data:node.getAttribute('data-startup-data')})),accountGate:!!document.querySelector('[data-testid="production-account-gate"]'),
   inputs:Array.from(document.querySelectorAll('input,textarea')).map(node=>({tag:node.tagName,type:node.getAttribute('type'),label:label(node),disabled:node.disabled,readOnly:node.readOnly,...visibility(node)})),
   buttons:Array.from(document.querySelectorAll('button,[role="button"],[role="checkbox"]')).map(node=>({role:node.getAttribute('role')??'button',label:label(node),disabled:node.hasAttribute('disabled')||node.getAttribute('aria-disabled')==='true',...visibility(node)})),
   staticMessages:[...new Set(Array.from(document.querySelectorAll('div,p,span')).map(node=>(node.textContent??'').trim()).filter(text=>known.has(text)))]};
 });
}
async function checkpoint(name){diagnosticCheckpoints.push({name,path:safePath(new URL(page.url()).pathname),http,dom:await safeDOM()});}
async function writeDiagnostic(state,code,error){await mkdir('artifacts/verification',{recursive:true});await writeFile(evidenceFile,JSON.stringify({state,code,stage,lastAction,path:page?safePath(new URL(page.url()).pathname):null,exceptionType:typeof error?.name==='string'&&/^[A-Za-z_]+$/u.test(error.name)?error.name:null,checks,http,httpCap:cap,stores,blocked,lost,submissions,lookup,network,pageErrors,checkpoints:diagnosticCheckpoints,dom:await safeDOM()},null,2));}
async function ready(url,process,attempts){for(let i=0;i<attempts;i++){if(process.exitCode!==null)throw Error('local_process_stopped');try{const response=await fetch(url,{signal:AbortSignal.timeout(1500)});if(response.ok)return;}catch{}await delay(500);}throw Error('local_process_not_ready');}
try{
 const resume=process.argv[2]==='--resume-local-only'; assert.ok((process.argv.length===3||(diagnostic||finish)&&process.argv.length===4)&&(resume||process.argv[2]==='--approved-local-only'));demand(!(diagnostic||finish)||resume,'resume_requires_existing_fixtures');
 process.env.PSModulePath='';
 const info=JSON.parse(execFileSync('docker',['inspect','ai-postgres-test-1'],{encoding:'utf8'}))[0];
 const dockerEnv=Object.fromEntries(info.Config.Env.map(value=>{const i=value.indexOf('=');return[value.slice(0,i),value.slice(i+1)];}));
 const url=new URL('postgres://127.0.0.1:5434/p2_a08_service_20261008');url.username=dockerEnv.POSTGRES_USER;url.password=dockerEnv.POSTGRES_PASSWORD;
 pool=new Pool({connectionString:url.toString()});
 demand((await pool.query('SELECT enabled FROM worker_control WHERE id=1')).rows[0]?.enabled===false,'worker_must_remain_paused');
 demand((await pool.query("SELECT id FROM app_migrations WHERE id IN ('034-account-admission','035-account-data-exit')")).rowCount===2,'a08_clone_required');
 cipher=createStorageCipher(await readSecretKey('C:/Users/2NTTY/.codex/s05-local-storage-keys/storage.key'));
 const env={...process.env,PSModulePath:'',DATABASE_URL:url.toString(),STORAGE_KEY_FILE:'C:/Users/2NTTY/.codex/s05-local-storage-keys/storage.key',ACCOUNT_ERASURE_JOURNAL_DIR:root+'/journal',ATTACHMENTS_DIR:root+'/attachments',BETTER_AUTH_SECRET:randomBytes(32).toString('hex'),SERVER_ORIGIN:api,WEB_ORIGIN:web,HOST:'127.0.0.1',PORT:'8197',NODE_ENV:'test',SERVICE_MODE:'invited',AI_ENABLED:'false',P2_AGENT_ENABLED:'true',WEB_PUSH_ENABLED:'false',TELEGRAM_ENABLED:'false',ACCOUNT_SMTP_CONFIG_FILE:'',ACCOUNT_SMTP_ALLOW_INSECURE_LOOPBACK:'false',AGENT_DIAGNOSTICS:'false',ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS:'false',DEBUG:'',PWDEBUG:''};
 account=await openAccountRuntime(pool,cipher,env);
 baseline=(await pool.query('SELECT (SELECT count(*)::int FROM "user") AS users,(SELECT count(*)::int FROM children) AS children,(SELECT count(*)::int FROM chat_messages) AS messages')).rows[0];
 const config={databaseUrl:url.toString(),authSecret:env.BETTER_AUTH_SECRET,publicOrigin:api,webOrigin:web,host:'127.0.0.1',port:8197,production:false};
 const fixtureAuth=createAuth(config,pool,{admission:createAccountAdmission(pool,{enabled:false,mailConfigured:false})});
 if(resume){const saved=JSON.parse(cipher.decrypt(await readFile(root+'/a07-fixture.enc','utf8'),'a07-ui-fixture:1'));demand(saved.length===2&&saved.every(value=>value.email.startsWith('a07-')&&value.email.endsWith('@example.invalid')),'fixture_mismatch');fixtures.push(...saved);baseline.users-=2;}
 else for(let index=0;index<2;index++){
  const person={email:`a07-${randomUUID()}@example.invalid`,password:'Synthetic-'+randomBytes(20).toString('hex'),name:'A07 合成使用者 '+index};
  const signed=await business(()=>fixtureAuth.api.signUpEmail({body:{email:person.email,password:person.password,name:person.name}}));person.id=signed.user.id;fixtures.push(person);
  // Fixture-only verified identities: actual mail delivery/verification is not claimed by this UI check.
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[person.id]);
 }
 if(!resume)await writeFile(root+'/a07-fixture.enc',cipher.encrypt(JSON.stringify(fixtures),'a07-ui-fixture:1'),{flag:'wx',mode:0o600});
 if(finish){const saved=(await pool.query('SELECT c.id FROM children c JOIN workspaces w ON w.id=c.workspace_id WHERE w.owner_user_id=$1',[fixtures[0].id])).rows;demand(saved.length===1,'existing_fixture_child_required');child=saved[0];children.push(child.id);const messages=(await pool.query('SELECT count(*)::int n FROM chat_messages WHERE child_id=$1',[child.id])).rows[0].n;demand(messages===1,'existing_fixture_message_required');baseline.children-=1;baseline.messages-=messages;}
 stage='start_real_server';const server=run(['server/index.ts'],env,process.cwd(),'api');await ready(api+'/api/health',server,60);
 stage='start_real_frontend';const frontend=run(['../node_modules/expo/bin/cli','start','--web','--localhost','--port','8217'],{...env,NODE_ENV:'development',CI:'1',BROWSER:'none',EXPO_PUBLIC_API_BASE_URL:api+'/api',EXPO_NO_DOTENV:'1',EXPO_OFFLINE:'1',EXPO_NO_TELEMETRY:'1',EXPO_NO_TELEMETRY_DETACH:'1'},process.cwd()+'/frontend','web');await ready(web,frontend,180);
 browser=await chromium.launch({headless:true,executablePath:'C:/Users/2NTTY/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'});
 context=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});
 page=await context.newPage();
 page.on('response',response=>{const url=new URL(response.url());if(url.origin===api&&network.length<cap)network.push({path:safePath(url.pathname),method:response.request().method(),status:response.status()});});
 page.on('requestfailed',request=>{const url=new URL(request.url());if(url.origin===api&&network.length<cap)network.push({path:safePath(url.pathname),method:request.method(),status:'transport_failed'});});
 page.on('pageerror',error=>{if(pageErrors.length<10)pageErrors.push({name:/^[A-Za-z_]+$/u.test(error.name)?error.name:'Error'});});
 page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(60000);
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
  if(![api,web].includes(url.origin)&&!['data:','blob:'].includes(url.protocol)){blocked++;await route.abort();return;}
  if(url.origin===api){if(++http>cap){blocked++;await route.abort();return;}
   if(diagnostic&&!['GET','OPTIONS'].includes(request.method())&&!['/api/auth/sign-in/email','/api/account/acknowledgement'].includes(url.pathname)){blocked++;await route.abort();return;}
   if(/\/reply(?:\/|$)|\/test(?:\/|$)/u.test(url.pathname)){blocked++;await route.abort();return;}
   if(url.pathname==='/api/online/operations/'+opId)lookup=true;
   if(url.pathname==='/api/online/submit'&&request.postDataJSON()?.path==='/api/children'){
    submissions++;if(submissions!==1){blocked++;await route.abort();return;}
    opId=request.postDataJSON().operation.opId;
    const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:10000});const result=await response.json();
    if(response.status()!==200||result.state!=='confirmed'||!result.result?.child?.id){await route.fulfill({response});return;}
    child=result.result.child;children.push(child.id);lost=true;await route.abort('failed');return;
   }
  }await route.continue();
 });
 async function waitInputReadiness(action){lastAction=action;await page.getByTestId('frontend-preview-ready').waitFor({state:'visible',timeout:20000});}
 async function login(person){
  await waitInputReadiness('wait_login_readiness');
  await checkpoint('before_credential_input');
  try{lastAction='fill_email';await page.getByLabel('電郵地址',{exact:true}).fill(person.email);lastAction='fill_password';await page.getByLabel('密碼',{exact:true}).fill(person.password);}catch{throw Error('credential_input_failed');}
  await checkpoint('before_login_click');
  const response=page.waitForResponse(value=>value.url()===api+'/api/auth/sign-in/email'&&value.request().method()==='POST');response.catch(()=>{});
  lastAction='click_login';await page.getByRole('button',{name:'登入',exact:true}).click();await checkpoint('after_login_click');
  lastAction='wait_native_login';const signed=await response;demand(signed.status()===200,'native_login_failed');demand((await signed.json()).user?.id===person.id,'native_identity_mismatch');
 }
 async function consent(){lastAction='read_account_status';demand(++http<=cap,'http_cap');const response=await context.request.get(api+'/api/account');network.push({path:'/api/account',method:'GET',status:response.status()});demand(response.status()===200,'account_status_failed');const status=await response.json();if(status.user?.acknowledged)return;lastAction='check_consent';await page.getByRole('checkbox',{name:'我已閱讀並同意以上資料使用說明',exact:true}).check();lastAction='submit_consent';await page.getByRole('button',{name:'同意並繼續',exact:true}).click();}
 stage='login_and_consent';lastAction='open_login';await page.goto(web+'/login');await login(fixtures[0]);await consent();lastAction='wait_signed_in_home';await page.waitForURL(web+'/',{timeout:12000});await waitInputReadiness('wait_home_readiness');checks.push('real_login_and_consent');
 if(diagnostic){stage='account_profile_diagnostic';lastAction='open_profile';await page.goto(web+'/profile');await waitInputReadiness('wait_profile_readiness');lastAction='wait_child_name';await page.getByLabel('孩子稱呼',{exact:true}).waitFor();await checkpoint('profile_before_child_input');demand(submissions===0&&stores===0,'diagnostic_write_boundary');checks.push('child_entry_visible_without_write');diagnosticSuccess=true;await writeDiagnostic('diagnosed','login_and_child_entry_reachable');}
 else {
 if(!finish){
 stage='child_unknown_recovery';lastAction='profile_navigation';await page.goto(web+'/profile');await waitInputReadiness('wait_profile_readiness');lastAction='child_name';await page.getByLabel('孩子稱呼',{exact:true}).fill('A07 合成孩子');lastAction='review_child';await page.getByRole('button',{name:'核對新增孩子',exact:true}).click();lastAction='confirm_child';await page.getByRole('button',{name:'確認新增孩子',exact:true}).click();lastAction='recover_child';await page.getByRole('button',{name:'查核原建立操作',exact:true}).click();await page.getByRole('button',{name:'切換至A07 合成孩子',exact:true}).waitFor();demand(lost&&lookup&&submissions===1&&child,'unknown_recovery_failed');checks.push('child_original_operation_recovered_once');
 stage='seed_bounded_history_and_document';const chat=createChatStore(pool,cipher,true,true);await business(()=>chat.createUserMessageForUser(fixtures[0].id,child.id,'A07 已保存的合成交代：準備下週入學。'));
 const document=await business(()=>createFamilyDocumentStore(pool,cipher).create(fixtures[0].id,child.id,{kind:'preparation',purpose:'school',title:'A07 入學準備單',eventDate:null,period:{from:'2026-10-01',to:'2026-10-08'}},randomUUID()));demand(document,'document_fixture_failed');
 stage='history_read';await page.goto(web+'/history?category=conversations');await page.getByText('A07 已保存的合成交代：準備下週入學。',{exact:false}).first().waitFor();checks.push('saved_private_chat_history');
 }
 if(!accountOnly){
 stage='document_read';await page.getByRole('link',{name:'孩子概況與準備',exact:true}).click();await page.getByRole('tab',{name:'準備單',exact:true}).click();await page.getByText('A07 入學準備單',{exact:true}).first().waitFor();checks.push('same_document_visible');
 stage='library_read';await page.getByRole('link',{name:'記憶與參考',exact:true}).click();await page.getByRole('tab',{name:'參考資料',exact:true}).click();await page.getByText('查看目前可查閱的公共來源目錄',{exact:true}).first().waitFor();checks.push('authorised_library_catalog');
 stage='reload_persistence';await page.getByRole('link',{name:'孩子概況與準備',exact:true}).click();await page.getByRole('tab',{name:'準備單',exact:true}).click();await page.reload();await waitInputReadiness('wait_reloaded_document');await page.getByText('A07 入學準備單',{exact:true}).first().waitFor();checks.push('reload_reads_saved_document');
 }
 stage='account_switch';lastAction='open_settings';await page.goto(web+'/settings');await waitInputReadiness('wait_settings_readiness');lastAction='logout';await page.getByRole('button',{name:'登出本人帳戶',exact:true}).click();await page.waitForURL(web+'/login',{timeout:12000});await login(fixtures[1]);await consent();await page.waitForURL(web+'/',{timeout:12000});await waitInputReadiness('wait_other_home_readiness');lastAction='verify_other_account_scope';demand(await page.getByText('A07 合成孩子',{exact:false}).count()===0,'old_child_visible');const otherChildren=await context.request.get(api+'/api/children',{headers:{'x-expected-user-id':fixtures[1].id}});http++;demand(otherChildren.status()===200,'other_children_unavailable');const otherPage=await otherChildren.json();demand(Array.isArray(otherPage.children)&&otherPage.children.length===0,'old_child_in_authority');
 const denied=await context.request.get(api+'/api/children/'+child.id+'/library',{headers:{'x-expected-user-id':fixtures[1].id}});http++;demand(denied.status()===404,'other_child_catalog_not_denied');checks.push('account_and_child_scope_isolation');
 demand(http<=cap&&blocked===0,'network_boundary_failed');await context.close();context=null;await browser.close();browser=null;
 stage='cleanup_own_fixtures';for(const person of fixtures){const prepared=await business(()=>account.data.prepare(person.id,randomUUID()));const result=await business(()=>account.data.execute(person.id,{operationId:prepared.operationId,receiptToken:prepared.receiptToken,password:person.password,confirmation:'永久刪除我的帳戶'}));demand(result.state==='completed','cleanup_not_complete');}
 assert.deepEqual((await pool.query('SELECT (SELECT count(*)::int FROM "user") AS users,(SELECT count(*)::int FROM children) AS children,(SELECT count(*)::int FROM chat_messages) AS messages')).rows[0],baseline);
 demand((await pool.query('SELECT enabled FROM worker_control WHERE id=1')).rows[0]?.enabled===false,'worker_changed');checks.push('only_own_fixtures_removed');success=true;
 }
}catch(error){const code=/^[a-z0-9_]+$/.test(error?.message??'')?error.message:'ui_acceptance_failed';await writeDiagnostic('failed',code,error).catch(()=>{});console.log(JSON.stringify({state:'failed',stage,lastAction,code:/^[a-z0-9_]+$/.test(error?.message??'')?error.message:'ui_acceptance_failed',checks,http,stores,blocked,lost,submissions,lookup,startupCodes:stage==='start_real_server'?apiLog.match(/(?:ERR_[A-Z_]+|SyntaxError|TypeError|ReferenceError|server_[a-z_]+|configuration_[a-z_]+)/g):undefined,fixtureUsers:fixtures.length,fixtureChildren:children.length}));process.exitCode=1;}
finally{await context?.close();await browser?.close();for(const process of processes.reverse()){if(process.exitCode===null){try{execFileSync('taskkill',['/PID',String(process.pid),'/T','/F'],{stdio:'ignore'});}catch{}}}await pool?.end();}
if(success)console.log(JSON.stringify({state:'passed',checks,http,httpCap:cap,stores,storeCap,blocked,realModel:0,embedding:0,externalMail:0,notifications:0,fixtureUsers:2,fixtureChildren:1,cleanup:true,limits:'Verified identities are fixture setup; native verification/reset reuse A08. No true Agent run or deployment.'}));

if(diagnosticSuccess)console.log(JSON.stringify({state:'diagnosed',stage,lastAction,checks,http,httpCap:cap,stores,submissions,externalMail:0,model:0,evidence:evidenceFile,fixturesPreserved:true}));
