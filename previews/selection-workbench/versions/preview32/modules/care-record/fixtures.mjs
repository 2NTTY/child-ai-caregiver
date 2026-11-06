// Synthetic saved-record data only. No household, photographs, API, model or storage.
export const demoScope=Object.freeze({scopeKey:'synthetic-care-scope-a',childId:'synthetic-child-a',childLabel:'小海（合成孩子）',access:'read_only',online:true});
const rev=(version,kind,text,source,quantityRaw='',quantityUnit='',eventTimeRaw='時間未記下',extra={})=>({version,values:{kind,text,source,quantityRaw,quantityUnit,quantityPrecision:'approximate',eventTimeRaw,reason:'',...extra.values},eventTimePrecision:'unknown',timeZoneLabel:'未提供時區',confirmedByLabel:'合成照顧者甲',confirmedAtLabel:'2026-11-04 19:20（合成）',...extra});
const item=(id,title,current,createdAtLabel='2026-11-04（合成加入日期）')=>({id,childId:demoScope.childId,title,current,createdAtLabel});
export const demoRecords=[
 item('care-001','晚餐後的半杯水',rev(3,'feeding','晚餐收拾好以後，小海自己拿起杯子喝水。原記錄寫「大概半杯」，沒有量過容量；這裡保留照顧者當時的說法，不換算成毫升。\n\n他指著杯上的小船說：「它也要出發了。」我們一起把杯子放回原位。','手動記錄：家庭日誌','半杯','杯','晚餐收拾好以後')),
 item('care-002','午睡醒來的安靜片刻',rev(2,'sleep','醒來後先靠在沙發旁，一邊抱著抱枕，一邊聽窗外的聲音。今天沒有記下確切入睡及醒來時間，只知道是在午飯之後。\n\n這是保存的生活觀察，不用加入日期補作事件時間。','手動記錄：家庭日誌','一小會兒','段','午飯後，時刻未記下')),
 item('care-003','積木橋搭好之前',rev(1,'note','橋面放上去時倒了兩次。小海把底下的兩塊積木移近，第三次讓玩具車慢慢通過。照顧者只記下看到的過程，沒有把它改寫成能力評分。\n\n第二段原文也會完整保留，方便日後讀回當時的語境。','手動記錄：家庭日誌','','','傍晚左右')),
 item('care-004','舊手帳轉入的一筆',rev(1,'diaper','這段內容從合成舊手帳匯入：午睡前換了一次尿片。原手帳沒有填寫更精確的時間，也沒有數量單位。\n\n匯入標記只說明保存來源，不等於本次逐項核實。','匯入：合成舊手帳','','','午睡前（原手帳）'),null),
 item('care-005','下次見面前的備忘',rev(1,'appointment','預先授權陳述的合成示例：下次見面時想帶上最近的生活筆記，方便說清楚日常情況。這不是預約成功回執，也不是診療建議。\n\nOriginReferenceWithoutSpaces_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ 僅是長文字換行示例，沒有連結能力。','預先授權陳述：合成備忘','','','下次見面時')),
 item('care-006','窗邊的雨聲',rev(1,'note','下雨的時候，小海在窗邊聽了一會兒。照顧者記下他說「像小鼓」，之後兩人用手指輕敲桌面。\n\n事件時間只保留「下雨的時候」，不推算為匯入或確認的日期。','匯入：合成舊手帳','','','下雨的時候'))
];
const histories={
 'care-001':[rev(2,'feeding','晚餐後喝了大概半杯水。','手動記錄：家庭日誌','半杯','杯','晚餐後',{values:{kind:'feeding',text:'晚餐後喝了大概半杯水。',source:'手動記錄：家庭日誌',quantityRaw:'半杯',quantityUnit:'杯',quantityPrecision:'approximate',eventTimeRaw:'晚餐後',reason:'補充當時語境（合成）'}}),rev(1,'feeding','喝了水，份量沒有量過。','手動記錄：家庭日誌','','','時間未記下')],
 'care-002':[rev(1,'sleep','午飯後靠著抱枕休息了一會兒。','手動記錄：家庭日誌','','','午飯後')]
};
export function createDemoLoader({schedule=fn=>setTimeout(fn,240)}={}){return request=>new Promise(resolve=>schedule(()=>{
 const {kind,args}=request;if(kind==='closePanel'){resolve({type:'closed'});return;}
 if(['search','loadMore','previousPage'].includes(kind)){const window=demoRecords.slice((args.page-1)*3,args.page*3);const q=args.query.toLocaleLowerCase('zh-HK');const rows=window.filter(r=>(args.kind==='all'||r.current.values.kind===args.kind)&&`${r.title} ${r.current.values.text} ${r.current.values.source}`.toLocaleLowerCase('zh-HK').includes(q));resolve({type:'page',records:structuredClone(rows),scanned:window.length,hasMore:args.page*3<demoRecords.length});return;}
 const record=demoRecords.find(r=>r.id===args.id);if(!record){resolve({type:'error',status:404,code:'record_not_found'});return;}
 if(kind==='openRecord'){resolve({type:'record',record:structuredClone(record)});return;}
 const versions=histories[args.id]??[];const offset=kind==='loadOlderHistory'?Number(request.cursor?.split(':')[1]??0):0;resolve({type:'history',versions:structuredClone(versions.slice(offset,offset+1)),hasMore:versions.length>offset+1,cursor:versions.length>offset+1?`offset:${offset+1}`:null});
 }));}
