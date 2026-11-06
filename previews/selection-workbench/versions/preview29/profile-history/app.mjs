import {fields,fieldValue,visibleRows,readStatus,readMode,canRead} from './model.mjs';
import {scenario,scenarios} from './fixtures.mjs';
export function mount(root,host){
 const doc=root.ownerDocument,win=doc.defaultView;
 let alive=true,layout='archive',field='preferences',query='',queryCommits=0,composing=false,cancelledComposition=false,cancelledValue='',trailing=null,selected=null,returnFocus=null,epoch=host.get().epoch,dialogKey=null,rendering=false,rerender=false,autoAttemptEpoch=null;
 const rows=new Map();
 root.innerHTML=`<div class="shell" data-layout="archive"><div data-base><a class="skip" href="#ph-results">跳至版本目錄</a><header class="mast"><div><p class="eyebrow">育伴港 · 獨立選配 PH01</p><h1 data-title>版本書庫</h1><p class="subtitle" data-subtitle></p></div><div class="seal" aria-hidden="true">檔案<br>閱覽室</div></header><section class="controls" aria-label="候選選配"><div class="layout-options"><button data-layout-option="archive">A · 版本書庫</button><button data-layout-option="field">B · 欄位航線</button></div><label class="scenario-label">合成情境<select data-scenario></select></label></section><main><section class="identity"><div><span class="eyebrow">閱讀範圍</span><h2 data-child></h2><p data-current></p></div><p class="boundary">歷史唯讀 · 僅合成示例<br>不會還原、覆寫或評估孩子</p></section><section class="notice" role="status" aria-live="polite" data-status></section><div class="toolbar"><label class="search-label">在已載入版本中找文字<input type="search" maxlength="200" data-search placeholder="原因、來源或資料原文" autocomplete="off"></label><div class="read-control"><button data-read>載入更早版本</button><p>無伺服器搜尋；未讀部分不計入結果。</p></div></div><section class="field-menu" data-field-menu aria-label="選擇一個閱讀欄位" hidden><p>先選欄位，再沿版本閱讀。原文並列，不計算差異或健康趨勢。</p><div data-field-buttons></div></section><section class="results" aria-labelledby="ph-results"><div class="result-heading"><h2 id="ph-results" tabindex="-1" data-results-heading>已載入版本</h2><span data-count></span></div><p data-empty hidden></p><ol role="list" data-list></ol></section><details class="fixture"><summary>合成讀取控制與邊界</summary><p>本地手動回覆模擬延遲。按「載入」後可暫停，再接納或失敗；不連 API。</p><div class="fixture-actions"><button data-settle="success">接納合成讀回</button><button data-settle="error">模擬讀取失敗</button><button data-pause>暫停閱讀</button><button data-resume>恢復閱讀</button><button data-canonical>更換同版核對基準</button></div><p data-pending></p><p>原操作未確認須由原檔案 owner 查核，這裡沒有操作收據或重送。已載入的同版內容不是還原指令。</p></details></main><footer>PH01 · 兩種資訊架構，共用同一合成資料與讀取 owner。<br>合成網頁探索；正式接線、原生操作與輔助技術尚未驗收。</footer></div><section class="reader" role="dialog" aria-modal="true" aria-labelledby="ph-reader-title" hidden><div class="reader-frame"><header><div><p class="eyebrow">歷史全文 · 唯讀</p><h2 id="ph-reader-title"></h2></div><button data-close aria-label="關閉歷史全文">關閉</button></header><div class="reader-scroll" data-detail tabindex="0" aria-label="歷史版本完整原文"></div><footer><p>選取版本僅供閱讀，不會變更目前檔案。</p><button data-close-end>關閉並返回目錄</button></footer></div></section></div>`;
 const $=s=>root.querySelector(s),base=$('[data-base]'),input=$('[data-search]'),dialog=$('[role="dialog"]'),detail=$('[data-detail]'),heading=$('[data-results-heading]'),list=$('[data-list]');
 function text(el,value){if(el.textContent!==value)el.textContent=value}
 function element(tag,cls,value){const el=doc.createElement(tag);if(cls)el.className=cls;if(value!==undefined)el.textContent=value;return el}
 for(const [id,label]of scenarios){const o=element('option','',label);o.value=id;$('[data-scenario]').append(o)}
 for(const [key,label]of fields){const b=element('button','',label);b.type='button';b.dataset.field=key;b.addEventListener('click',()=>{if(!alive||host.get().paused)return;field=key;render()});$('[data-field-buttons]').append(b)}
 function clearSelection(focus=false){const wasOpen=selected!==null;selected=null;dialogKey=null;dialog.hidden=true;detail.replaceChildren();base.inert=false;if(focus&&wasOpen){const target=returnFocus?.isConnected&&returnFocus.closest('[data-list]')?returnFocus:heading;target.focus();}returnFocus=null;}
 function eligibleRow(v,expectedEpoch=epoch){const s=host.get();return alive&&!s.paused&&s.epoch===expectedEpoch&&s.access!=='lost'&&s.child&&visibleRows(s,query).find(r=>r.version===v)}
 function open(v,button,key,rowLayout){const row=eligibleRow(v,key);if(!row||layout!==rowLayout)return;selected={version:v,epoch:key};returnFocus=button;render();$('[data-close]').focus()}
 function renderReader(s){const row=selected&&selected.epoch===s.epoch&&s.access!=='lost'&&!s.paused?s.history.find(r=>r.version===selected.version):null;
  if(!row){if(selected){const restore=dialog.contains(doc.activeElement);clearSelection(restore)}return}
  const key=s.epoch+':'+row.version;if(key!==dialogKey){dialogKey=key;text($('#ph-reader-title'),`檔案版本 ${row.version}`);detail.replaceChildren();const dl=element('dl','full-fields');
   const entries=[['版本',String(row.version)],['確認人',row.confirmedByLabel??'未知'],['確認時間',row.confirmedAtLabel??'未知'],['確認／更正原因',row.reason??'尚未確認']];
   if(row.data===null)entries.push(['檔案內容','沒有已確認檔案']);else for(const [k,label]of fields)entries.push([label,fieldValue(row,k)]);
   for(const [label,value]of entries){const wrap=element('div','full-row');wrap.append(element('dt','',label),element('dd','',value));dl.append(wrap)}detail.append(dl);detail.scrollTop=0;
  }dialog.hidden=false;base.inert=true;
 }
 function render(){if(!alive)return;if(rendering){rerender=true;return}rendering=true;let retiredFocus=null;
  do{rerender=false;const s=host.get();if(s.epoch!==epoch){if(list.contains(doc.activeElement))retiredFocus=doc.activeElement;epoch=s.epoch;autoAttemptEpoch=s.paused?epoch:null;query='';if(composing){cancelledComposition=true;cancelledValue=input.value;}input.value='';composing=false;trailing=trailing?.cancelled?{...trailing,epoch}:null;rows.clear();list.replaceChildren();}
   root.firstElementChild.dataset.layout=layout;text($('[data-title]'),layout==='archive'?'版本書庫':'欄位航線');text($('[data-subtitle]'),layout==='archive'?'把每次確認，留在它原來的一頁。':'沿一項資料，讀回各版本當時的原文。');
   for(const b of root.querySelectorAll('[data-layout-option]'))b.setAttribute('aria-pressed',String(b.dataset.layoutOption===layout));
   text($('[data-child]'),s.child?.name??'沒有可讀孩子');text($('[data-current]'),s.current?`目前檔案版本 ${s.current.version} · 此頁只列較早版本`:'目前檔案版本尚未核對');
   const status=readStatus(s);text($('[data-status]'),(s.paused?'閱讀已暫停。舊回覆已退役；恢復後可手動讀取。 ': '')+status.text);$('[data-status]').dataset.state=status.kind;
   const mode=readMode(s),read=$('[data-read]');text(read,mode==='current'?'重新讀取檔案':mode==='first'?'重試讀取修改歷史':'載入更早版本');read.setAttribute('aria-disabled',String(!canRead(s,mode)));read.dataset.mode=mode??'';
   input.readOnly=s.access==='lost'||!s.child||s.paused;input.setAttribute('aria-disabled',String(input.readOnly));
   $('[data-field-menu]').hidden=layout!=='field';for(const b of root.querySelectorAll('[data-field]'))b.setAttribute('aria-pressed',String(b.dataset.field===field));
   const visible=visibleRows(s,query);text(heading,layout==='archive'?'已載入版本':fields.find(([k])=>k===field)[1]+' · 各版原文');text($('[data-count]'),`${visible.length} / ${s.history.length} 已載入`);
   const wanted=new Set(),ordered=[];for(const row of visible){const k=s.epoch+':'+layout+':'+field+':'+row.version;wanted.add(k);let li=rows.get(k);if(!li){li=element('li','version-card');li.dataset.version=String(row.version);const badge=element('div','version-badge',String(row.version).padStart(2,'0'));badge.setAttribute('aria-hidden','true');const content=element('div','card-content');const label=element('p','version-label',`檔案版本 ${row.version}`),title=element('h3'),meta=element('p','meta'),excerpt=element('p','excerpt'),b=element('button','open','閱讀完整版本');b.type='button';b.dataset.open=String(row.version);b.setAttribute('aria-label',`閱讀完整版本 ${row.version}`);b.addEventListener('click',()=>{if(rows.get(k)!==li||!li.isConnected)return;open(row.version,b,s.epoch,layoutAtCreation)});const layoutAtCreation=layout;
    content.append(label,title,meta,excerpt,b);li.append(badge,content);li._parts={title,meta,excerpt};rows.set(k,li)}
    text(li._parts.title,layout==='archive'?(row.reason??'已確認的孩子檔案'):fields.find(([k])=>k===field)[1]);text(li._parts.meta,`${row.confirmedAtLabel??'確認時間未知'} · 確認人：${row.confirmedByLabel??'未知'}`);text(li._parts.excerpt,layout==='archive'?(row.data?.source??'沒有已確認檔案'):fieldValue(row,field));
    if(!li.isConnected)list.append(li);ordered.push(li);
   }
   for(const [k,li]of rows)if(!wanted.has(k)){if(li.contains(doc.activeElement))retiredFocus=doc.activeElement;li.remove();rows.delete(k)}
   // Preserve owner order after filtering; only move existing nodes, never sort data.
   ordered.forEach((li,index)=>{const before=list.children[index]??null;if(before!==li)list.insertBefore(li,before)});
   const empty=$('[data-empty]');empty.hidden=visible.length>0;text(empty,query?'已載入版本沒有符合這段文字的結果；尚未讀取的歷史不在搜尋範圍。':status.text);
   for(const b of root.querySelectorAll('[data-settle]'))b.setAttribute('aria-disabled',String(!s.pending||s.paused));$('[data-pause]').setAttribute('aria-disabled',String(s.paused));$('[data-resume]').setAttribute('aria-disabled',String(!s.paused));$('[data-canonical]').setAttribute('aria-disabled',String(s.paused||!s.current||s.access==='lost'));text($('[data-pending]'),s.pending?`等待合成 ${s.pending.mode==='current'?'目前檔案':'歷史分頁'} 回覆。`:'沒有等待中的合成讀取。');
   renderReader(s);
   // Recover only a retired list descendant after the live projection is complete.
   if(retiredFocus&&alive&&host.get()===s){const previous=retiredFocus;retiredFocus=null;if(root.isConnected&&heading.isConnected&&!previous.isConnected&&doc.activeElement===doc.body)heading.focus();}
   if(alive&&host.get()===s&&autoAttemptEpoch!==s.epoch&&!s.historyOpen&&!s.notice&&canRead(s,'first')){autoAttemptEpoch=s.epoch;host.begin('first');}
  }while(rerender&&alive);rendering=false;
 }
 function commit(value){if(!alive||host.get().paused||input.readOnly)return;query=value.slice(0,200);queryCommits++;render()}
 input.addEventListener('compositionstart',()=>{composing=true;cancelledComposition=false;trailing=null});
 input.addEventListener('compositionend',e=>{if(cancelledComposition){cancelledComposition=false;composing=false;input.value='';trailing={epoch,value:cancelledValue,cancelled:true};return;}if(!composing)return;composing=false;commit(input.value);trailing={epoch,value:input.value}});
 input.addEventListener('input',e=>{if(composing||e.isComposing||cancelledComposition)return;if(trailing?.epoch===epoch&&(trailing.value===input.value||trailing.cancelled&&(e.inputType==='insertCompositionText'||input.value===''))){if(trailing.cancelled)input.value='';trailing=null;return}trailing=null;commit(input.value)});
 for(const b of root.querySelectorAll('[data-layout-option]'))b.addEventListener('click',()=>setLayout(b.dataset.layoutOption));
 $('[data-scenario]').addEventListener('change',e=>{if(alive){clearSelection();host.replace(scenario(e.target.value));}});
 $('[data-read]').addEventListener('click',()=>{if(alive)host.begin(readMode(host.get()))});
 for(const b of root.querySelectorAll('[data-settle]'))b.addEventListener('click',()=>{if(alive)host.settle(host.get().pending,b.dataset.settle)});
 $('[data-pause]').addEventListener('click',()=>{if(alive)host.pause()});$('[data-resume]').addEventListener('click',()=>{if(alive)host.resume()});$('[data-canonical]').addEventListener('click',()=>{if(alive)host.invalidateCanonical()});
 for(const b of root.querySelectorAll('[data-close],[data-close-end]'))b.addEventListener('click',()=>{if(alive)clearSelection(true)});
 dialog.addEventListener('keydown',e=>{if(!alive||dialog.hidden||e.isComposing)return;if(e.key==='Escape'){e.preventDefault();clearSelection(true)}else if(e.key==='Tab'){const focusables=[...e.currentTarget.querySelectorAll('button,[tabindex="0"]')];const first=focusables[0],last=focusables.at(-1);if(e.shiftKey&&doc.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&doc.activeElement===last){e.preventDefault();first.focus()}}});
 $('.skip').addEventListener('click',e=>{e.preventDefault();heading.focus()});
 function setLayout(next){if(!alive||!['archive','field'].includes(next)||host.get().paused)return;clearSelection();layout=next;rows.clear();list.replaceChildren();render()}
 const hide=()=>{if(alive)host.pause()},show=()=>{if(alive)host.resume()};win.addEventListener('pagehide',hide);win.addEventListener('pageshow',show);
 const unsubscribe=host.subscribe(render);render();
 return {setLayout,debug:()=>({layout,field,query,queryCommits,selected,epoch}),dispose(){if(!alive)return;clearSelection();alive=false;unsubscribe();win.removeEventListener('pagehide',hide);win.removeEventListener('pageshow',show);host.dispose();base.inert=false}};
}
