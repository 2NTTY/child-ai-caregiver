import {STEPS} from './guide-data.mjs';
const names={chat:'助手對話',care:'核對',settings:'設定'};
export function stepsMarkup(state) {
 return STEPS.map((s,i)=>`<button type="button" data-step="${i}" ${i===state.currentStep?'aria-current="step"':''} aria-label="第 ${i+1} 步：${s.title}${i===state.currentStep?'，目前閱讀':''}"><span class="number">${i+1}</span><span>${s.title}${i===state.currentStep?'<small>目前閱讀</small>':''}</span></button>`).join('');
}
export function readingMarkup(state) {
 const s=STEPS[state.currentStep];
 return `<p class="eyebrow">第 ${state.currentStep+1} 步，共 3 步</p><h2 id="reading-title" tabindex="-1">${s.title}</h2><p class="lead">${s.description}</p><ol class="points">${s.points.map(p=>`<li><h3>${p.title}</h3><p>${p.body}</p></li>`).join('')}</ol><p class="meta">數字表示閱讀次序，不是完成百分比</p><button type="button" id="action" class="primary" data-destination="${s.destination}">${s.action}</button><p class="meta">此按鈕只示範導航意圖</p>${state.intent?`<section class="intent" role="status"><h3>模擬導航意圖：${names[state.intent]}（${state.intent}）</h3><p>沒有開啟真實頁面、發送訊息或保存資料</p><button type="button" id="return">返回閱讀</button></section>`:''}<div class="step-controls"><button type="button" id="previous"${state.currentStep===0?' disabled':''}>上一步</button><button type="button" id="next"${state.currentStep===2?' disabled':''}>下一步</button></div>`;
}
