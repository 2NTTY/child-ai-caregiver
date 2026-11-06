export const REFERENCE_DAY='2026-11-04';
export const TIME_ZONE='Asia/Hong_Kong';
export const TASKS=Object.freeze([
 {id:'bag',title:'書包的小檢查',details:'一起看看明天要用的物品。這是合成事項，不會發出提醒或建立安排。',assignee:'示例照顧者 A',dueAt:'2026-11-04T08:15:00+08:00',state:'scheduled',kind:'待辦',label:'出門前'},
 {id:'books',title:'到圖書館還書',details:'示例借閱清單共有兩本書；不連接真實圖書館帳戶。',assignee:'示例照顧者 B',dueAt:'2026-11-04T16:30:00+08:00',state:'scheduled',kind:'預約',label:'放學後'},
 {id:'puzzle',title:'拼圖，一起收好',details:'完成或取消尚待核對的合成示例。待覆核不等於尚未完成，這裡不能改變狀態。',assignee:'示例照顧者 A',dueAt:'2026-11-04T19:00:00+08:00',state:'needs_review',kind:'待辦',label:'晚間'},
 {id:'return',title:'把雨衣放回袋子',details:'這項示例日期早於資料基準日，只代表較早未處理，不代表照顧品質。',assignee:'示例照顧者 B',dueAt:'2026-11-02T18:00:00+08:00',state:'scheduled',kind:'待辦',label:'較早'},
 {id:'review-old',title:'核對週二接送安排',details:'完成或取消仍未確定；此合成安排標記為待覆核，不提供催辦功能。',assignee:'示例照顧者 A',dueAt:'2026-11-03T17:30:00+08:00',state:'needs_review',kind:'待辦',label:'待核對'},
 {id:'plant',title:'整理窗邊小植物',details:'示例家庭活動安排。查看詳情不會完成、編輯或傳送任何事項。',assignee:'示例照顧者 C',dueAt:'2026-11-06T17:00:00+08:00',state:'scheduled',kind:'待辦',label:'週五'},
 {id:'walk',title:'週末散步看路線',details:'一起查看散步路線的合成待辦。沒有真實地址、地圖或定位請求。',assignee:'示例照顧者 A',dueAt:'2026-11-07T10:00:00+08:00',state:'scheduled',kind:'待辦',label:'週末'},
 {id:'game',title:'桌遊時間',details:'合成日程中的一段桌遊時間。不提供教養建議或成效承諾。',assignee:'示例照顧者 B',dueAt:'2026-11-10T19:00:00+08:00',state:'scheduled',kind:'預約',label:'近期尾日'},
 {id:'swap',title:'整理交換書單',details:'位於近期七天以後的合成待辦，用來示範「之後」範圍。',assignee:'示例照顧者 C',dueAt:'2026-11-14T10:00:00+08:00',state:'scheduled',kind:'待辦',label:'之後'},
 {id:'picnic',title:'野餐物品清單',details:'只展示事先編寫的合成文字，沒有真實採購、支付或預約。',assignee:'示例照顧者 A',dueAt:'2026-11-22T09:00:00+08:00',state:'scheduled',kind:'待辦',label:'之後'},
 {id:'december',title:'十二月一起選書',details:'跨月示例，用來檢查月份導航不會更改目前選中日。',assignee:'示例照顧者 B',dueAt:'2026-12-02T18:00:00+08:00',state:'scheduled',kind:'待辦',label:'跨月'},
 {id:'uncertain',title:'確認活動的日期',details:'原始示例時間未附時區偏移，所以不放入任何已確認日期。可在「時間待核對」查看。',assignee:'示例照顧者 C',dueAt:'2026-11-09T15:00:00',state:'scheduled',kind:'待辦',label:'時間待核對'},
 {id:'completed',title:'已完成的合成事項',details:'只供驗證排除邏輯，不出現在待處理日曆。',assignee:'示例照顧者 A',dueAt:'2026-11-04T07:00:00+08:00',state:'completed',kind:'待辦',label:'已完成'},
].map(Object.freeze));
export const RANGES=Object.freeze([['near','近期 7 天'],['earlier','較早未處理'],['later','之後'],['review','待覆核'],['unconfirmed','時間待核對'],['all','全部已載入']].map(Object.freeze));
