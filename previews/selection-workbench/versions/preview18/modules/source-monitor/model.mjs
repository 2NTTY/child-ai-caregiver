// Original synthetic-only host. Not AdminOwner, authentication, or an API adapter.
const blank = () => ({open:false,status:'unread',page:null,notice:null});
const copy = value => structuredClone(value);
export const labels = {
  result:{changed:'發現變更',unchanged:'未發現變更',failed:'檢查失敗',unavailable:'來源不可用',superseded:'已被取代',unknown:'結果未明'},
  registration:{enabled:'已啟用監測',disabled:'已停用監測',not_registered:'尚未註冊',definition_changed:'來源定義變更'},
  state:{running:'檢查中',recorded:'已記錄',unknown:'執行狀態未明'}, kind:{page:'網頁',rss:'RSS',pdf:'PDF'}
};
export const resultLabel = value => labels.result[value ?? 'unknown'] ?? '未識別結果';
export function displayTime(value) {
  if(value == null) return '未提供';
  const date=new Date(value); if(!Number.isFinite(date.getTime())) return '無法辨識日期';
  return new Intl.DateTimeFormat('zh-HK',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
}
export function filterRows(page,query='',filter='all') {
  const q=query.trim().toLocaleLowerCase();
  const match=(row,fields,status)=> (!q||fields.some(k=>String(row[k]??'').toLocaleLowerCase().includes(q))) && (filter==='all'||(filter==='unknown'?status===null:status===filter));
  return {
    watches:(page?.watches??[]).filter(r=>match(r,['id','publisher','url','kind','registration'],r.lastStatus)),
    checks:(page?.checks??[]).filter(r=>match(r,['jobId','watchId','state','status','failureCode'],r.status))
  };
}
export function createHost() {
  let s={identity:'synthetic-a',generation:1,access:'allowed',interactive:true,online:true,generalBusy:false,indexBusy:false,accountBusy:false,knowledge:blank(),layout:'bridge',query:'',filter:'all',selection:null,announcement:''};
  let serial=0,reads=0,pending=null; const listeners=new Set();
  const binding=()=>`${s.identity}:${s.generation}`;
  const emit=()=>listeners.forEach(fn=>fn());
  const denied=reason=>({accepted:false,reason,ticket:null});
  const gate=(observed=binding())=>observed!==binding()?'舊識別綁定':!s.interactive?'宿主互動遮罩':s.access!=='allowed'?'未獲合成管理權限':null;
  const reset=(access)=>{s.generation++;s.access=access;s.knowledge=blank();s.query='';s.filter='all';s.selection=null;pending=null;s.announcement='合成身份或權限已重設，舊內容已清除。';emit();};
  const host={
    get snapshot(){return copy(s);}, get binding(){return binding();}, get readCount(){return reads;},
    get view(){const v=copy(s);if(!v.interactive||v.access!=='allowed'){v.knowledge=blank();v.query='';v.selection=null;}return v;},
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    availability(more=false){const reason=gate()||(!s.online?'合成離線':!s.knowledge.open?'閱讀區已收起':s.knowledge.status==='loading'?'同一讀取進行中':more&&!s.knowledge.page?.nextCursor?'沒有後續游標':null);return {available:!reason,reason};},
    setOpen(open,observed=binding()) {
      const reason=gate(observed)||(!s.online&&open?'合成離線':null);if(reason)return denied(reason);
      s.knowledge.open=!!open; emit();
      if(open&&s.knowledge.status==='unread') return host.read(false,observed);
      return {accepted:true,ticket:null};
    },
    read(more=false,observed=binding()) {
      const reason=gate(observed)||host.availability(more).reason;if(reason)return denied(reason);
      const ticket={id:++serial,binding:binding(),more,cursor:more?s.knowledge.page.nextCursor:null};pending=ticket;reads++;
      s.knowledge.status='loading';s.knowledge.notice=null;s.announcement='正在讀取合成來源目錄及檢查紀錄。';emit();return {accepted:true,ticket:copy(ticket)};
    },
    resolve(ticket,outcome) {
      if(!ticket||pending?.id!==ticket.id||pending.binding!==ticket.binding||ticket.binding!==binding()||s.access!=='allowed')return false;
      const accepted=pending;pending=null;
      if(Object.hasOwn(outcome,'error')){s.knowledge.status='error';s.knowledge.notice=String(outcome.error||'合成讀取失敗，請重試。');s.announcement=`${s.knowledge.notice} ${s.knowledge.page?'已載入內容及游標保留。':'尚未取得內容。'}`;}
      else {const page=copy(outcome.page);const previous=accepted.more?s.knowledge.page:null;
        s.knowledge.page=previous?{watches:page.watches,checks:[...new Map([...previous.checks,...page.checks].map(c=>[c.jobId,c])).values()],nextCursor:page.nextCursor}:page;
        s.knowledge.status='ready';s.knowledge.notice=null;
        const sel=s.selection,p=s.knowledge.page;
        if(sel&&!(sel.kind==='watch'?p.watches:p.checks).some(r=>(sel.kind==='watch'?r.id:r.jobId)===sel.id)){s.selection=null;s.announcement='所選項目不在新的讀取窗口，已清除選取。';}
        else s.announcement=`已讀取 ${p.watches.length} 個當前來源，累積 ${p.checks.length} 項檢查紀錄。${p.nextCursor?'仍有更多紀錄。':'本次窗口沒有後續游標。'}`;
      }emit();return true;
    },
    setLayout(layout){if(!['bridge','dossier'].includes(layout))return;s.layout=layout;emit();},
    setQuery(query){s.query=String(query);emit();},setFilter(filter){s.filter=filter;emit();},
    select(kind,id){if(gate())return false;const list=kind==='watch'?s.knowledge.page?.watches:s.knowledge.page?.checks;if(!list?.some(r=>(kind==='watch'?r.id:r.jobId)===id))return false;s.selection={kind,id};emit();return true;},
    setContext(patch){for(const k of ['interactive','online','generalBusy','indexBusy','accountBusy'])if(Object.hasOwn(patch,k))s[k]=!!patch[k];emit();},
    changeIdentity(){s.identity=s.identity==='synthetic-a'?'synthetic-b':'synthetic-a';reset('allowed');},
    newGeneration(){reset('unread');},revoke(){reset('denied');},
    recheck(observed=binding()){const reason=observed!==binding()?'舊識別綁定':!s.interactive?'宿主互動遮罩':!s.online?'合成離線':null;if(reason)return denied(reason);s.access='allowed';s.announcement='合成權限檢查完成；這不是真實認證。';emit();return {accepted:true,ticket:null};}
  };return host;
}
