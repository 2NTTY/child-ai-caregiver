import {categories,createState,editField,validate,review,confirmReview,commit,undoCommit} from './model.mjs';
const $=s=>document.querySelector(s);let state=createState(),step=0,layout='console';
function announce(text){$('#announce').textContent=text;}
function syncInputs(){$('#title').value=state.draft.title;$('#note').value=state.draft.note;for(const r of document.querySelectorAll('input[name=category]'))r.checked=r.value===state.draft.category;}
function render(focus){
 const draft=state.phase==='draft';
 document.body.dataset.layout=layout;document.body.dataset.step=String(step);
 $('#record-form').hidden=!draft;
 $('#category-stage').hidden=!draft||(layout==='console'&&step!==0);
 $('#details-stage').hidden=!draft||(layout==='console'&&step!==1);
 $('#review-stage').hidden=state.phase!=='review';$('#receipt-stage').hidden=state.phase!=='receipt';
 $('#phase-label').textContent={draft:'草稿 / 尚未核對',review:'核對 / 尚未建立回執',receipt:'本頁回執 / 未正式保存'}[state.phase];
 for(let i=0;i<3;i++){const current=state.phase==='draft'?step:2;$('#step-'+i).setAttribute('aria-current',i===current?'step':'false');}
 for(const key of ['category','title','note']){const message=state.errors[key]||'';$('#'+key+'-error').textContent=message;const input=key==='category'?$('input[name=category]'):$('#'+key);input.setAttribute('aria-invalid',String(Boolean(message)));}
 const errors=Object.entries(state.errors).filter(([,message])=>message);$('#errors').hidden=!errors.length;$('#errors').replaceChildren();
 if(errors.length){const p=document.createElement('p');p.textContent='還有 '+errors.length+' 個地方需要確認。';$('#errors').append(p);for(const [key,message] of errors){const b=document.createElement('button');b.type='button';b.textContent=message;b.addEventListener('click',()=>{step=key==='category'?0:1;render(key==='category'?'input[name=category]':'#'+key);});$('#errors').append(b);}}
 $('#note-count').textContent=state.draft.note.length+' / 300';
 if(state.review){$('#review-category').textContent=categories.find(x=>x.id===state.review.draft.category)?.label||'';$('#review-name').textContent=state.review.draft.title;$('#review-note').textContent=state.review.draft.note||'沒有補充文字。';$('#confirmed').checked=state.review.confirmed;$('#commit').disabled=!state.review.confirmed;}
 if(state.receipt)$('#receipt-copy').textContent=state.receipt.title;
 if(focus)$(focus)?.focus();
}
for(const view of ['console','notebook'])$('#'+view).addEventListener('click',()=>{layout=view;for(const id of ['console','notebook'])$('#'+id).setAttribute('aria-pressed',String(id===view));render();announce('已切換呈現方式；草稿及核對狀態保留。');});
for(const radio of document.querySelectorAll('input[name=category]'))radio.addEventListener('change',()=>{state=editField(state,'category',radio.value);render();});
for(const key of ['title','note'])$('#'+key).addEventListener('input',e=>{state=editField(state,key,e.target.value);render();});
$('#next').addEventListener('click',()=>{const error=validate(state.draft).category;if(error){state={...state,errors:{category:error}};render('input[name=category]');return;}step=1;render('#title');});
$('#back').addEventListener('click',()=>{step=0;render('input[name=category]:checked');});
$('#record-form').addEventListener('submit',e=>{e.preventDefault();state=review(state);if(state.phase==='review'){step=2;render('#review-title');announce('請核對同一份內容，尚未建立回執。');}else{const key=state.errors.category?'category':state.errors.title?'title':'note';step=key==='category'?0:1;render(key==='category'?'input[name=category]':'#'+key);}});
$('#confirmed').addEventListener('change',e=>{state=confirmReview(state,e.target.checked);render();});
$('#edit').addEventListener('click',()=>{state=editField(state,'title',state.draft.title);step=1;render('#title');announce('已回到草稿；原核對已清除，改完需要重新核對。');});
$('#commit').addEventListener('click',()=>{const next=commit(state);if(next===state)return;state=next;render('#receipt-title');announce('已建立本頁示例回執，沒有正式保存或發送。');});
$('#undo').addEventListener('click',()=>{state=undoCommit(state);step=1;syncInputs();render('#title');announce('已撤回本頁回執，原草稿保留。');});
$('#new').addEventListener('click',()=>{state=createState();step=0;syncInputs();render('input[name=category]');announce('開始新的合成示例，上一份本頁回執已清空。');});
render();
