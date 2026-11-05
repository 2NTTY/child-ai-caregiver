import {documents} from './data.mjs';
import {initialState, transition, projectReader, sourceDetails} from './model.mjs';
import {clearBookmarkFocusTarget} from './focus.mjs';
const $ = id => document.getElementById(id);
const escape = value => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let state=initialState(documents), sourceTrigger=null;
const dialog=$('source-dialog');
const focus = id => { const target=$(id); if(target) {target.focus({preventScroll:true});target.scrollIntoView({block:'nearest',behavior:'auto'});} };
const announce = text => {$('announcement').textContent=text;};
const option = (value,text,selected)=>`<option value="${escape(value)}"${selected?' selected':''}>${escape(text)}</option>`;
$('document-select').innerHTML=documents.map(doc=>option(doc.id,doc.title,doc.id===state.documentId)).join('');
function dispatch(type,value,{target,message}={}) {
  state=transition(state,{type,value},documents); render();
  if(target) focus(typeof target==='function'?target():target);
  if(message) announce(typeof message==='function'?message():message);
}
function chapterState(chapter) {
  return chapter.sourceIds.length && chapter.sourceIds.every(id=>sourceDetails(documents,state,id)?.status==='synthetic') ? '全合成文字與引用' : '缺來源 · 未核實示例';
}
function sourceCard(id,chapterId) {
  const source=sourceDetails(documents,state,id); if(!source) return '';
  const missing=source.status==='missing';
  return `<div class="source-card ${missing?'missing-source':''}"><p class="source-state">${missing?'缺來源 · 未核實':'合成來源 · 非真實記錄'}</p><h4>${escape(source.title)}</h4><p>${escape(missing?'此引用沒有提供內容，不能當作已核實。':source.text)}</p><button id="source-${escape(chapterId)}-${escape(id)}" data-source="${escape(id)}">查看來源詳情：${escape(source.title)}</button></div>`;
}
function sources(chapter) {
  return chapter.sourceIds.length?chapter.sourceIds.map(id=>sourceCard(id,chapter.id)).join(''):'<p class="missing-note">此章沒有附上來源。這段合成文字未核實，沒有額外引用可檢閱。</p>';
}
function chapterArticle(chapter,index,inlineSources=true) {
  return `<section class="chapter" aria-labelledby="chapter-${escape(chapter.id)}"><header><p class="chapter-kicker"><span>${String(index+1).padStart(2,'0')}</span> ${escape(chapter.label)}</p><h3 id="chapter-${escape(chapter.id)}" tabindex="-1">${escape(chapter.title)}</h3><p class="chapter-status">${chapterState(chapter)}</p></header><div class="prose">${chapter.paragraphs.map(text=>`<p>${escape(text)}</p>`).join('')}</div>${inlineSources?`<details class="chapter-sources"${chapter.id===state.chapterId?' open':''}><summary>檢閱本章合成來源 · ${chapter.sourceIds.length} 項引用</summary><div class="source-list">${sources(chapter)}</div></details>`:''}</section>`;
}
function renderSearch(p) {
  $('search-region').hidden=!p.searchActive;
  $('search-summary').textContent=!p.available?'目前版本正文不可用，沒有可搜尋的內容。':p.results.length?`「${p.query}」在此版本找到 ${p.results.length} 個章節。`:`沒有找到「${p.query}」。試試其他文字，或清除搜尋。`;
  $('search-results').innerHTML=p.results.map(item=>`<button class="search-result" data-chapter="${escape(item.id)}"><strong>${escape(item.title)}</strong><span>${escape(item.excerpt)}</span><small>前往此章 →</small></button>`).join('');
}
function render() {
  const p=projectReader(documents,state);
  document.body.dataset.layout=state.layout;
  for(const layout of ['library','desk']) $(`layout-${layout}`).setAttribute('aria-pressed',String(state.layout===layout));
  $('document-select').value=state.documentId;
  $('version-select').innerHTML=p.document.versions.map(version=>option(version.id,version.label,version.id===state.versionId)).join('');
  if($('search').value!==state.query) $('search').value=state.query;
  renderSearch(p);
  $('document-code').textContent=`${p.document.code} / EDITION ${p.version.edition} / ${state.layout==='library'?'READING ROOM':'INSPECTION DESK'}`;
  $('document-title').textContent=p.document.title;
  $('document-subtitle').textContent=p.document.subtitle;
  $('version-note').textContent=p.version.note;
  $('chapter-list').innerHTML=p.chapters.map((chapter,index)=>`<li><button data-chapter="${escape(chapter.id)}"${chapter.id===state.chapterId?' aria-current="location"':''}><span class="chapter-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><span>${escape(chapter.title)}${chapter.id===state.chapterId?'<small class="current-label">目前</small>':''}</span></button></li>`).join('');
  if(!p.available) {
    $('chapter-list').innerHTML='<li class="index-empty">正文不可用，暫無章節。</li>';
    $('reading-body').innerHTML='<section class="unavailable" aria-labelledby="unavailable-title"><span class="unavailable-mark" aria-hidden="true">∅</span><h3 id="unavailable-title" tabindex="-1">這個版本沒有可讀正文</h3><p>合成資料不可用示例。沒有內容，不代表內容已核實或不存在。</p><p>請在上方「閱讀版本」選擇另一版本。本頁沒有連線讀取或重試，不會替你切換成舊版。</p><button id="choose-version">選擇另一閱讀版本</button></section>';
  } else if(state.layout==='library') {
    $('reading-body').innerHTML=p.chapters.map((chapter,index)=>chapterArticle(chapter,index)).join('');
  } else {
    $('reading-body').innerHTML=`<div class="inspection-columns"><div class="inspection-document"><p class="panel-label">A / 文件正文</p>${chapterArticle(p.chapter,p.chapters.indexOf(p.chapter),false)}</div><aside class="inspection-sources" aria-labelledby="sources-heading"><p class="panel-label">B / 來源檢閱</p><h3 id="sources-heading">${escape(p.chapter.title)}的來源</h3><p class="source-help">並排的是合成便箋，不是正式證據或已核實家庭資料。</p>${sources(p.chapter)}</aside></div>`;
  }
  $('chapter-pagination').hidden=!p.available;
  const index=p.chapters.findIndex(chapter=>chapter.id===state.chapterId);
  $('previous-chapter').disabled=index<=0; $('next-chapter').disabled=index<0||index>=p.chapters.length-1;
  $('chapter-position').textContent=p.available?`目前選擇 ${index+1} / ${p.chapters.length} 章`:'';
  $('set-bookmark').disabled=!p.chapter;
  $('return-bookmark').disabled=!state.bookmark; $('clear-bookmark').disabled=!state.bookmark;
  if(state.bookmark) {
    const marked=projectReader(documents,{...state,...state.bookmark});
    $('bookmark-label').textContent=`${marked.document.title} · ${marked.version.label} · ${marked.chapter.title}（只留本頁）`;
  } else $('bookmark-label').textContent='尚未設定。重新整理即清除。';
}
function goChapter(id) {dispatch('chapter',id,{target:`chapter-${id}`,message:()=>`目前章節：${projectReader(documents,state).chapter.title}。`});}
function openSource(id,trigger) {
  const source=sourceDetails(documents,state,id); if(!source) return;
  sourceTrigger=trigger;
  $('source-title').textContent=source.title;
  $('source-body').innerHTML=source.status==='missing'?'<p class="missing-note">缺來源 · 未核實。這個合成引用沒有提供內容；不能用其他版本或文件的來源補上。</p><p>這是刻意保留的資料缺口示例，沒有可執行的連線重試。</p>':`<p class="source-state">${escape(source.kind)} · 非真實記錄</p><p class="source-revision">${escape(source.revision)}</p><div class="source-excerpt">${escape(source.text)}</div><p>${escape(source.context)}</p><p class="dialog-boundary">來源與正文均為 D01 專門編寫；不是從既有家庭記錄抽取，沒有經過真實資料核實。</p>`;
  dialog.showModal(); $('source-title').focus();
}
function closeSource() {dialog.close();}
dialog.addEventListener('close',()=>{const trigger=sourceTrigger&&$(sourceTrigger);(trigger??$('reading-start')).focus({preventScroll:true});sourceTrigger=null;});
dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab') return;
  const controls=[...dialog.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]')];
  const first=controls[0],last=controls.at(-1),active=document.activeElement;
  if(event.shiftKey&&(active===first||!controls.includes(active))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(active===last||!controls.includes(active))){event.preventDefault();first.focus();}
});
$('close-dialog').addEventListener('click',closeSource); $('return-dialog').addEventListener('click',closeSource);
$('document-select').addEventListener('change',event=>dispatch('document',event.target.value,{message:()=>`已選擇合成文件：${projectReader(documents,state).document.title}。`}));
$('version-select').addEventListener('change',event=>dispatch('version',event.target.value,{message:()=>{const p=projectReader(documents,state);return `${p.version.label}。${p.available?'已切換合成版本。':'正文不可用，沒有切換到其他版本。'}`;}}));
$('search').addEventListener('input',event=>{state=transition(state,{type:'query',value:event.target.value},documents);renderSearch(projectReader(documents,state));});
$('clear-search').addEventListener('click',()=>dispatch('query','',{target:'search',message:'已清除搜尋。'}));
for(const layout of ['library','desk']) $(`layout-${layout}`).addEventListener('click',()=>dispatch('layout',layout,{target:`layout-${layout}`,message:`已切換${layout==='library'?'文庫閱讀室':'檔案調查桌'}，保留閱讀選擇與搜尋。`}));
$('set-bookmark').addEventListener('click',()=>dispatch('bookmark',null,{target:'set-bookmark',message:'已設定本頁書籤；重新整理即清除。'}));
$('return-bookmark').addEventListener('click',()=>dispatch('return-bookmark',null,{target:()=>`chapter-${state.chapterId}`,message:'已回到本頁書籤的文件、版本與章節。'}));
$('clear-bookmark').addEventListener('click',()=>dispatch('clear-bookmark',null,{target:()=>clearBookmarkFocusTarget(state,documents),message:'已清除本頁書籤。'}));
for(const [id,step] of [['previous-chapter',-1],['next-chapter',1]]) $(id).addEventListener('click',()=>{const p=projectReader(documents,state),next=p.chapters[p.chapters.indexOf(p.chapter)+step];if(next)goChapter(next.id);});
document.addEventListener('click',event=>{
  const chapter=event.target.closest('[data-chapter]'); if(chapter) goChapter(chapter.dataset.chapter);
  const source=event.target.closest('[data-source]'); if(source) openSource(source.dataset.source,source.id);
  if(event.target.closest('#choose-version')) focus('version-select');
});
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();focus(state.chapterId?`chapter-${state.chapterId}`:'reading-start');});
render();
