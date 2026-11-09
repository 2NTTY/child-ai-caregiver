import {gateFor,controls,POLICY_VERSION} from './state.mjs';
export const NOTICE='資料保存在本服務；使用 AI 時，獲授權的文字或照片會交由 Google 或你選用的模型供應商處理。私人來源只在本人範圍使用，不加入公共知識庫。通知及分享仍需另外授權。你可下載本人資料、刪除孩子或退出帳戶；備份按實際保留政策到期清除，恢復前會重新套用刪除紀錄。';
export const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const titles={verification:'先確認，這是你的電郵',consent:'讓資料的去向，一目了然',checking:'正在核對服務狀態',error:'暫時未能確認帳戶服務',ready:'示例已就緒'};
const names={checking:'核對中',error:'需要重新核對',verification:'等待驗證',consent:'等待閱讀',ready:'示例已就緒'};
function button(id,label,enabled,extra='') {return `<button id="${id}" type="button" ${enabled?'':'disabled'} ${extra}>${label}</button>`;}
function policy(s) {return `<section class="policy" aria-labelledby="policy-heading"><div class="section-label">資料說明 · 原文參照</div><h2 id="policy-heading">開始前，了解資料的使用方式</h2><p class="policy-copy">${NOTICE}</p><p class="source-note">上文是固定原版的完整說明，供介面比較，並非當前服務承諾或新條款。示例版本：<span class="mono">${escape(s.policyVersion)}</span></p><div class="principles"><span>01 · 私人範圍</span><span>02 · 另行授權</span><span>03 · 保留控制</span></div></section>`;}
function actionPanel(s) {
 const gate=gateFor(s),c=controls(s);
 let body='';
 if(gate==='consent') body=`<p>閱讀完整說明後，可勾選下方的<strong>合成示例</strong>，試看入場回饋。</p><label class="consent-check"><input id="accept" type="checkbox" ${s.accepted?'checked':''} ${c.accept?'':'disabled'}><span>合成示範：我已閱讀這份示例<small>不是法律同意，不會改變真實帳戶。</small></span></label>${button('ack',s.pending?.action==='ack'?'等待合成回覆…':'演示同意並繼續',c.ack,'class="primary"')} ${s.policyVersion!==POLICY_VERSION?'<p class="warning">服務說明已更新，請先更新介面再確認。此示例不提供繞過版本核對。</p>':''}`;
 else if(gate==='verification') body=`<p>請查看電郵的驗證指引，完成後正常登入。你也可以重新要求指引。</p><div class="action-stack">${button('mail',s.pending?.action==='mail'?'等待合成回覆…':'演示重新要求驗證指引',c.mail,'class="primary"')}${button('recheck','演示重新確認帳戶',c.recheck,'class="secondary"')}</div><p class="source-note">${s.mailConfigured?'本頁沒有收集電郵地址或發送信件。':'此合成情境的驗證指引未配置，不能要求寄送。'}</p>`;
 else if(gate==='checking') body='<p>正常核對中沒有重試或其他帳戶操作。你可在上方「合成情境」切換並比較下一個狀態。</p><div class="quiet-loading" aria-hidden="true"><span></span><span></span><span></span></div>';
 else if(gate==='error') body=`<p>私人內容不會在狀態尚未確認時顯示。</p>${button('recheck','演示重新確認帳戶',c.recheck,'class="primary"')}`;
 else body=`<div class="ready-mark" aria-hidden="true">✓</div><p>這只代表<strong>合成情境</strong>已就緒，沒有開啟真帳戶或私人內容。</p><p class="source-note">${s.enabled?'本頁已核對示例的電郵及兩個說明版本。':'此為原程式 enabled=false 的舊服務旁路情境，不代表可繞過正式權限。'}</p>`;
 return `<section class="action-panel" aria-labelledby="action-heading"><div class="section-label">目前狀態 · ${names[gate]}</div><h2 id="action-heading" tabindex="-1">${titles[gate]}</h2>${!s.online?'<p class="warning">目前離線，連線後才能確認帳戶。此示例不會自動重試。</p>':''}${body}</section>`;
}
function route(s) {const g=gateFor(s);return `<aside class="route" aria-label="入場核對項目"><p class="section-label">ADMISSION / ACN01</p><ol>${[['01','核對服務',g==='checking'||g==='error'],['02','驗證電郵',g==='verification'],['03','閱讀資料說明',g==='consent'],['04','示例就緒',g==='ready']].map(([n,label,current])=>`<li ${current?'aria-current="step"':''}><span class="route-number">${n}</span><span>${label}${current?'<small>目前位置</small>':''}</span></li>`).join('')}</ol><p class="source-note">這是核對路線，不是完成百分比。</p></aside>`;}
export function render(s) {
 const badge=`<div class="identity"><span>合成身分</span><strong>${escape(s.identity)}</strong><span class="connection">${s.online?'模擬在線':'模擬離線'}</span></div>`;
 const response=s.pending?`<section class="response" aria-label="合成回覆控制"><p>示例請求正在等待。以下按鈕由你決定測試結果，並非 Server 回覆。</p><div class="response-buttons">${button('reply-success','合成回覆：成功',true)}${button('reply-error','合成回覆：未能確認',true)}</div><small>合成操作 ${escape(s.pending.token)} · ${escape(s.pending.action)}</small></section>`:'';
 return `${badge}${s.layout==='A'?`<div class="flight-layout">${route(s)}<div class="flight-main">${actionPanel(s)}${policy(s)}</div></div>`:`<div class="dossier-layout"><div class="dossier-paper">${policy(s)}<div class="dossier-foot">固定原版說明 × 全合成操作<br>每項選擇都保持可見。</div></div><div class="dossier-side">${actionPanel(s)}${route(s)}</div></div>`}${response}`;
}
