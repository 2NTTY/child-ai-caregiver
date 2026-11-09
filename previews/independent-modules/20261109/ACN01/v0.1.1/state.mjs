export const POLICY_VERSION='2026-10-08';
export const SCENARIOS=Object.freeze({verification:'等待電郵驗證',consent:'等待閱讀說明',checking:'正在核對帳戶',error:'未能核對帳戶','new-policy':'說明版本已更新','no-mail':'驗證指引暫不可用',ready:'示例狀態已就緒',disabled:'舊版服務停用情境'});
export function createState(scenario='verification') {
  if(!Object.hasOwn(SCENARIOS,scenario)) scenario='verification';
  return {scenario,identity:'synthetic-account-A',layout:'A',online:true,enabled:scenario!=='disabled',emailVerified:!['verification','no-mail'].includes(scenario),mailConfigured:scenario!=='no-mail',policyVersion:scenario==='new-policy'?'synthetic-next-version':POLICY_VERSION,acknowledged:scenario==='ready',acknowledgementVersion:scenario==='ready'?POLICY_VERSION:null,phase:['checking','error'].includes(scenario)?scenario:'loaded',accepted:false,pending:null,epoch:0,sequence:0,notice:''};
}
export function gateFor(s) {
  if(!s.identity) return 'checking';
  if(s.phase!=='loaded') return s.phase;
  if(!s.enabled) return 'ready';
  if(!s.emailVerified) return 'verification';
  return s.acknowledged && s.policyVersion===POLICY_VERSION && s.acknowledgementVersion===POLICY_VERSION?'ready':'consent';
}
export function controls(s) {
  const available=s.online&&!s.pending, gate=gateFor(s);
  return {ack:available&&gate==='consent'&&s.accepted&&s.policyVersion===POLICY_VERSION,mail:available&&gate==='verification'&&s.mailConfigured,recheck:available&&['verification','error'].includes(gate),accept:available&&gate==='consent'};
}
export function reduce(s,event) {
  if(!event||typeof event!=='object') return s;
  if(event.type==='layout') return ['A','B'].includes(event.value)&&event.value!==s.layout?{...s,layout:event.value}:s;
  if(event.type==='identity') {
    if(!['synthetic-account-A','synthetic-account-B'].includes(event.value)||event.value===s.identity) return s;
    return {...createState(s.scenario),identity:event.value,layout:s.layout,online:s.online,epoch:s.epoch+1,sequence:s.sequence,notice:'已切換合成身分，並重設為目前情境的說明版本、驗證及已確認狀態；先前勾選、版本覆寫及等待結果已清除。布局及在線設定保持不變。'};
  }
  if(event.type==='scenario') {
    if(!Object.hasOwn(SCENARIOS,event.value)||event.value===s.scenario) return s;
    return {...createState(event.value),identity:s.identity,layout:s.layout,online:s.online,epoch:s.epoch+1,sequence:s.sequence};
  }
  if(event.type==='policy') {
    if(typeof event.value!=='string'||event.value.length<1||event.value.length>80||event.value===s.policyVersion) return s;
    return {...s,policyVersion:event.value,accepted:false,pending:null,epoch:s.epoch+1,notice:'合成說明版本已變更，請重新閱讀。先前勾選不再適用。'};
  }
  if(event.type==='online') {
    if(typeof event.value!=='boolean'||event.value===s.online) return s;
    return {...s,online:event.value,pending:null,epoch:s.epoch+1,notice:event.value?'示例已恢復連線；不會自動重試任何操作。':'示例已離線，所有操作暫停；晚到的合成回覆不會套用。'};
  }
  if(event.type==='accept') return typeof event.value==='boolean'&&controls(s).accept?{...s,accepted:event.value}:s;
  if(event.type==='start') {
    if(!['ack','mail','recheck'].includes(event.action)||!controls(s)[event.action]) return s;
    const sequence=s.sequence+1;
    return {...s,sequence,pending:{action:event.action,token:`${s.epoch}:${sequence}`,identity:s.identity,policyVersion:s.policyVersion},notice:'等待合成回覆。請使用下方示例回覆控制；沒有任何真實請求。'};
  }
  if(event.type==='settle') {
    if(!s.pending||event.token!==s.pending.token||!s.online||!['success','error'].includes(event.outcome)) return s;
    if(event.outcome==='error') return {...s,pending:null,notice:'合成回覆：暫時未能確認結果。服務狀態沒有因此變成已完成；可明確重新操作。'};
    if(s.pending.action==='mail') return {...s,pending:null,notice:'合成回覆：請求已處理；這不代表電郵已送達，也不代表帳戶已驗證。此候選沒有發信。'};
    if(s.pending.action==='ack') return {...s,pending:null,acknowledged:true,acknowledgementVersion:s.pending.policyVersion,notice:'合成回覆：本頁示例已就緒。沒有接受真實條款、改變帳戶或開啟私人資料。'};
    return {...s,pending:null,phase:'loaded',notice:'合成回覆：重新讀取同一情境的狀態；不推定你已完成電郵驗證。'};
  }
  return s;
}
