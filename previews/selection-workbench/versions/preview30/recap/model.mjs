/** R01 is a self-contained, synthetic calendar-date model, not a product controller. */
export const SAMPLE_RANGE = Object.freeze({start:'2026-10-19',end:'2026-11-01'});
export const CATEGORIES = Object.freeze([
  Object.freeze({id:'together',label:'同行時光',symbol:'✦'}),
  Object.freeze({id:'outside',label:'戶外發現',symbol:'✧'}),
  Object.freeze({id:'create',label:'手作小事',symbol:'◇'}),
  Object.freeze({id:'quiet',label:'慢慢一刻',symbol:'☾'})
]);
const DAY = 86_400_000;
function dateNumber(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const stamp=Date.parse(value+'T00:00:00.000Z');
  return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value?stamp:null;
}
const dateString=stamp=>new Date(stamp).toISOString().slice(0,10);
export function weekOf(value) {
  const stamp=dateNumber(value);
  if(stamp===null) return null;
  return dateString(stamp-((new Date(stamp).getUTCDay()+6)%7)*DAY);
}
export function daysInWeek(value) {
  const monday=weekOf(value);
  if(!monday) return [];
  const stamp=dateNumber(monday);
  return Array.from({length:7},(_,index)=>dateString(stamp+index*DAY));
}
export function shiftWeek(value,direction) {
  const monday=weekOf(value);
  if(!monday||![-1,1].includes(direction)) return value;
  const next=dateString(dateNumber(monday)+direction*7*DAY);
  return next<SAMPLE_RANGE.start||next>weekOf(SAMPLE_RANGE.end)?monday:next;
}
export function initialState() {
  return Object.freeze({week:'2026-10-26',date:null,category:'all',view:'atlas',scenario:'typical'});
}
export function transition(state,action) {
  let patch;
  if(action.type==='date'&&(action.value===null||daysInWeek(state.week).includes(action.value))) patch={date:action.value};
  else if(action.type==='week') {
    const week=weekOf(action.value);
    if(week&&week>=SAMPLE_RANGE.start&&week<=weekOf(SAMPLE_RANGE.end)) patch={week,date:daysInWeek(week).includes(state.date)?state.date:null};
  } else if(action.type==='category'&&(action.value==='all'||CATEGORIES.some(x=>x.id===action.value))) patch={category:action.value};
  else if(action.type==='view'&&['atlas','weekly'].includes(action.value)) patch={view:action.value};
  else if(action.type==='scenario'&&['typical','sparse','empty'].includes(action.value)) patch={scenario:action.value};
  else if(action.type==='clear') patch={date:null,category:'all'};
  else if(action.type==='reset') return initialState();
  else if(action.type==='restore') return Object.freeze({...initialState(),view:state.view});
  return patch?Object.freeze({...state,...patch}):state;
}
export function projectRecap(records,state) {
  const dates=daysInWeek(state.week);
  const weekly=records.filter(item=>dates.includes(item.date)).sort((a,b)=>(a.date+a.time+a.id).localeCompare(b.date+b.time+b.id));
  const selected=weekly.filter(item=>!state.date||item.date===state.date);
  const matches=item=>state.category==='all'||item.category===state.category;
  const items=selected.filter(matches);
  const days=dates.map(date=>{
    const notes=weekly.filter(item=>item.date===date);
    return {date,recordCount:notes.length||null,matchingCount:notes.filter(matches).length};
  });
  const recordedDays=days.filter(day=>day.recordCount!==null).length;
  return {items,days,coverage:{recordedDays,unrecordedDays:days.length-recordedDays,totalDays:days.length,recordCount:weekly.length},emptyReason:items.length?null:selected.length?'filtered':'unrecorded'};
}
const entries=[
  {id:'paper-boat',date:'2026-10-20',time:'15:20',category:'create',title:'一張紙，變成小船',snippet:'摺了兩次又攤開，換個方向再試一次。',detail:'桌上只留了紙與蠟筆。一起把紙角壓平，最後替小船畫上三扇小窗。這是一段合成的手作片刻，沒有完成度或能力判定。',note:'「小船也想看外面。」',art:'boat'},
  {id:'old-story',date:'2026-10-23',time:'19:10',category:'together',title:'故事停在最喜歡的那頁',snippet:'沒有急著翻頁，只是又看了一會兒。',detail:'讀到樹上的小屋時，停下來數窗戶，也替故事加了一隻貓。這個合成片刻只描述當時留下的記錄。',note:'「這裡也可以住一隻貓。」',art:'book'},
  {id:'old-walk',date:'2026-10-25',time:'10:35',category:'outside',title:'走一條不同的小路',snippet:'在熟悉的路口轉了彎，看見一面彩色的牆。',detail:'散步途中停在彩色牆前，把看見的形狀說出來。沒有記錄路程、活動時數或其他未觀察到的內容。',note:'「這個圓圈像太陽。」',art:'leaf'},
  {id:'window-story',date:'2026-10-26',time:'18:40',category:'together',title:'窗邊那本，還想再讀一次',snippet:'一本書、一盞燈，還有不急著翻頁的晚上。',detail:'一起重讀了合成故事裡的一頁。翻到月亮時停下來，替頁邊的小鳥想了個名字。這則片刻沒有記錄閱讀時長，也不能推論整晚的活動。',note:'「小鳥是不是也在等月亮？」',art:'book'},
  {id:'leaf-map',date:'2026-10-27',time:'10:15',category:'outside',title:'三片葉子，一座小小島',snippet:'落葉排在長椅上，成了想像中的地圖。',detail:'散步時留意到三片不同形狀的落葉，在長椅上排成一座島。這是虛構場景，沒有照片、位置追蹤或真實家庭資訊。',note:'「這片是船，這片是小島。」',art:'leaf'},
  {id:'color-path',date:'2026-10-27',time:'16:20',category:'create',title:'讓藍色，繞一點遠路',snippet:'一條彎彎的線從紙的這邊，旅行到另一邊。',detail:'用蠟筆畫了一條長長的路，途中添上窗戶、樹與一個小圈圈。故事可以繼續，也可以停在這裡；這份合成記錄不評估作品或發展程度。',note:'「這裡是回家的路。」',art:'draw'},
  {id:'table-stars',date:'2026-10-29',time:'15:35',category:'create',title:'把紙上的星星，留在桌邊',snippet:'剪好的紙片沒有變成計畫中的樣子，卻多了一個故事。',detail:'合成片刻裡，照顧者準備好紙片，一起把它們排成星空。只留下這段描述，沒有紀錄當天其他活動。',note:'「這顆星星要靠近那一顆。」',art:'draw'},
  {id:'rain-listen',date:'2026-10-30',time:'17:05',category:'quiet',title:'今天，聽一會兒雨就好',snippet:'把窗邊的位置空出來，雨聲填進短短的一刻。',detail:'合成場景中，一起坐在窗邊聽雨，說出聽見的不同聲音。這不是情緒評分、睡眠紀錄、照護建議或醫療判斷。',note:'「小雨的聲音比較輕。」',art:'rain'},
  {id:'cloud-letter',date:'2026-10-31',time:'11:10',category:'outside',title:'雲寄來一封沒有字的信',snippet:'抬頭看了看，天空剛好有一朵很長的雲。',detail:'散步時停下來看雲，輪流描述看到的形狀。這只是一則全合成的生活片刻，不能代表整天戶外活動的多寡。',note:'「它好像一條很慢的魚。」',art:'cloud'},
  {id:'sunday-table',date:'2026-11-01',time:'09:30',category:'together',title:'早餐桌上，留一個小座位',snippet:'替玩偶拉近椅子，早晨多了一位想像中的客人。',detail:'在合成的早餐場景裡，替玩偶準備了一個空碟子，再聊起今天想看的故事。沒有記錄飲食份量、營養或其他健康資料。',note:'「它也想聽那個故事。」',art:'table'},
  {id:'sunday-pause',date:'2026-11-01',time:'16:45',category:'quiet',title:'空白的一頁，也可以先留著',snippet:'把畫本合上，讓未完成的線條明天再說。',detail:'畫到一半便停了下來，把畫本放回架上。這段合成描述不把完成與否當成成就，也不推論沒有記下來的片刻。',note:'「這裡明天再畫。」',art:'book'}
];
const typical=Object.freeze(entries.map(item=>Object.freeze(item)));
const sparse=Object.freeze(typical.filter(item=>item.id==='rain-listen'));
const empty=Object.freeze([]);
export function getEvents(scenario='typical') { return scenario==='empty'?empty:scenario==='sparse'?sparse:typical; }
