// Original synthetic content. No product domain is mounted by this candidate.
export const CATEGORIES=Object.freeze([
 {key:'account',label:'帳戶',group:'本人與私隱',kicker:'認識目前摘要',description:'閱讀本人已連結方式的合成摘要，分清已知、未確認及讀取錯誤。',boundary:'僅摘要呈現；沒有登入、密碼、連結方式或帳戶變更。'},
 {key:'children',label:'孩子',group:'照護關係',kicker:'可存取的孩子',description:'這裡原本連到可存取的孩子檔案；選擇孩子與開啟檔案仍由原模組處理。',boundary:'僅分類範圍說明；本候選沒有孩子清單或選孩操作。'},
 {key:'family',label:'家庭與班級',group:'照護關係',kicker:'分清管理範圍',description:'家庭分享、獨立班級名冊與教師空間有不同管理範圍。',boundary:'僅分類範圍說明；沒有共享名冊、邀請或角色變更。'},
 {key:'preferences',label:'外觀',group:'日常使用',kicker:'閱讀與畫面',description:'原設定模組承接動效與背景偏好。這個圖冊只協助找到分類。',boundary:'僅分類範圍說明；上方換布局只切本合成候選，不改產品外觀。'},
 {key:'notifications',label:'通知',group:'日常使用',kicker:'訊息與接收方式',description:'通知偏好與接收渠道有各自的資料及操作邊界。',boundary:'僅分類範圍說明；沒有推播、電郵、渠道或通知設定。'},
 {key:'assistant',label:'助手',group:'日常使用',kicker:'目前孩子的範圍',description:'助手授權依目前孩子與原服務權威核定，分類名稱不代表已授權。',boundary:'僅分類範圍說明；沒有同意授權、模型呼叫或真助手操作。'},
 {key:'model',label:'模型',group:'日常使用',kicker:'能力由原模組管理',description:'模型選擇與設定仍由原模型模組處理，不從導覽標籤取得權限。',boundary:'僅分類範圍說明；沒有供應商、憑證、模型選擇或 API。'},
 {key:'privacy',label:'私隱',group:'本人與私隱',kicker:'先看資料邊界',description:'私人內容與共享照護資料有不同邊界，授權仍由原系統核定。',boundary:'僅分類範圍說明；沒有來源管理、匯出或永久退出。'}
].map(Object.freeze));
export const GROUPS=Object.freeze(['本人與私隱','照護關係','日常使用']);
export const SCENARIOS=Object.freeze([
 ['google','只有 Google'],['password','只有電郵及密碼'],['apple','只有 Apple'],['mixed','三種已知方式'],['unknown','尚未確認'],['empty','已讀取但空白'],['error','讀取錯誤'],['unrecognized','含未辨識方式'],['long','長中文未知標籤']
].map(Object.freeze));
export function fixture(name){
 const providers={google:['google.com'],password:['password'],apple:['apple.com'],mixed:['password','google.com','apple.com'],empty:[],unrecognized:['google.com','synthetic.future-provider'],long:['此為合成而非真實身份提供者的非常長中文標籤用來檢查閱讀換行與完整保留不可誤判為蘋果登入方式']};
 if(name==='unknown'||name==='error')return{status:name,providers:[]};
 return{status:'ready',providers:[...(providers[name]??providers.google)]};
}
