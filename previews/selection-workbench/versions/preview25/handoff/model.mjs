const fixtures=[
{id:'bag',time:'15:30',title:'閱讀袋已準備',detail:'藍色布袋內有兩本合成示例圖書。回家後可一起選一本。',owner:'照顧者 A',tag:'物品交接',done:false},
{id:'play',time:'16:00',title:'今天的小發現',detail:'小星（合成角色）在公園找到三片不同形狀的葉子，想畫下來。',owner:'照顧者 A',tag:'生活片段',done:false},
{id:'pickup',time:'17:00',title:'接送安排已核對',detail:'合成示例：照顧者 B 接手，約定在大門等候。此頁不發送通知。',owner:'照顧者 B',tag:'安排',done:true},
{id:'tomorrow',time:'明天',title:'帶上畫紙和顏色筆',detail:'給明天的自己留一張小提示，不建立提醒或日曆事件。',owner:'照顧者 B',tag:'下一步',done:false}
];
export const initialItems=()=>fixtures.map(x=>({...x}));
export const toggleItem=(items,id)=>items.map(x=>x.id===id?{...x,done:!x.done}:x);
export const filterItems=(items,filter)=>items.filter(x=>filter==='done'?x.done:filter==='todo'?!x.done:true);
export const progress=items=>({done:items.filter(x=>x.done).length,total:items.length});
