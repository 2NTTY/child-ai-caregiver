// All people, facts and records below are invented for this isolated candidate.
import { emptyProfileForm } from './source-profile.mjs';
export const TODAY='2026-11-05';
export const scenarios=[['confirmed','目前正式接點'],['optional','選配授權量度'],['cold','冷啟讀取'],['version0','版本 0／空檔案'],['no-child','沒有孩子'],['unknown','原操作結果未知'],['saving','原操作保存中'],['result-unavailable','已確認但結果不可讀'],['invalidated','檔案來源失效'],['unavailable','檔案來源暫不可讀'],['revoked','權限撤回'],['offline','離線最後確認'],['reload','連線恢復待重讀'],['expired','檔案過期'],['invalid-date','有效期待核對'],['missing-fields','欄位未知'],['long','長中文與原樣文字'],['measurement-loading','量度讀取中'],['measurement-error','量度讀取失敗'],['measurement-invalid','量度來源失效'],['measurement-expired','量度過期'],['foreign-measurement','舊 scope 量度']];
export function fixture(child='a',scenario='confirmed') {
 const scopeKey=`synthetic:user:family:${child}:reader`,id=`synthetic-child-${child}`;
 const data={age:{kind:'approximate',rawValue:'3',unit:'years',asOf:'2026-11-01'},dueDate:null,gestationalWeeksRaw:null,region:'香港（合成）',language:'廣東話與普通話',allergies:'花生過敏；由合成家庭提供，尚未附上醫療文件。',specialNeeds:'轉換活動前，希望先用簡單句子說明下一步。',preferences:'喜歡聽雨聲、把木積木排成長長的小路。一起讀繪本時，想先看看圖，再慢慢說出發現的細節。',source:'合成家人於選配工作台確認',validUntil:'2026-12-31'};
 if(child==='b'){data.age={kind:'unknown'};data.allergies=null;data.preferences='喜歡用紙盒搭小屋，也喜歡自己選擇故事的結尾。';data.language='尚在了解使用的語言';}
 const model={child:{id,name:child==='a'?'小嶼（合成）':'小禾（合成）'},access:'read_only',online:true,reading:false,needsRefresh:false,current:{version:4,data,confirmedByLabel:'合成家人',confirmedAtLabel:'2026年11月1日 下午3:20',reason:null},basis:null,latest:null,history:[],historyOpen:false,hasMoreHistory:false,initialValues:emptyProfileForm(),formKey:0,reviewedValues:null,intent:null,operation:{state:'none',message:'',reference:null},notice:null};
 const source={scopeKey,childId:id,state:'available'};
 const measurements={scopeKey,childId:id,state:'unavailable',height:null,weight:null};
 const fact=(kind)=>({valueLabel:kind==='height'?'95.2 cm':'14.1 kg',measuredAtLabel:'2026年10月27日',sourceLabel:'合成量度記錄',recordId:`synthetic-${child}-${kind}`,recordVersion:2,state:'current'});
 if(scenario==='optional'||scenario.startsWith('measurement-')||scenario==='foreign-measurement'){measurements.state='ready';measurements.height=fact('height');measurements.weight=fact('weight');}
 if(scenario==='cold'){model.reading=true;model.current=null;source.state='unavailable';}
 if(scenario==='version0')model.current={version:0,data:null,confirmedByLabel:null,confirmedAtLabel:null,reason:null};
 if(scenario==='no-child'){model.child=null;model.current=null;measurements.state='unavailable';}
 if(['unknown','saving'].includes(scenario))model.operation={state:scenario,message:'原檔案操作尚待核對',reference:null};
 if(scenario==='result-unavailable')model.operation={state:'unknown',message:'原操作已確認，結果未讀回',reference:null,resultUnavailable:true};
 if(scenario==='invalidated')source.state='invalidated';
 if(scenario==='unavailable')source.state='unavailable';
 if(scenario==='revoked')model.access='lost';
 if(scenario==='offline')model.online=false;
 if(scenario==='reload'){model.needsRefresh=true;source.state='unavailable';}
 if(scenario==='expired')data.validUntil='2026-10-30';
 if(scenario==='invalid-date')data.validUntil='2026-02-30';
 if(scenario==='missing-fields'){for(const key of ['allergies','specialNeeds','preferences','language','region','validUntil'])data[key]=null;data.age={kind:'unknown'};data.source='';}
 if(scenario==='long'){model.child.name='小嶼與一個非常非常長的合成稱呼，用來檢查窄畫面是否完整換行';data.preferences=('喜歡先觀察再加入，請保留這段完整的合成文字，不代表診斷，也不應被省略。').repeat(14);data.specialNeeds='<img src=x onerror=alert(1)> 這是文字，不是可執行的圖片。';data.age={kind:'approximate',rawValue:'約三至四',unit:'years',asOf:'家人上次口述'};data.gestationalWeeksRaw='三十八週多一點（家人原文）';}
 if(scenario==='measurement-loading')measurements.state='loading';
 if(scenario==='measurement-error')measurements.state='error';
 if(scenario==='measurement-invalid')measurements.height.state='source_invalidated';
 if(scenario==='measurement-expired')measurements.height.state='expired';
 if(scenario==='foreign-measurement')measurements.scopeKey='synthetic:old-scope';
 return {scopeKey,model,profileSource:source,measurements,scenario,today:TODAY};
}
