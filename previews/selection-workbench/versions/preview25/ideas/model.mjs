export const ideas=[
{id:'color',title:'把今天畫成三種顏色',category:'畫畫',minutes:10,number:'01',shape:'sun',color:'peach',subtitle:'不必畫得像，只要選出今天的感覺。',materials:'紙與顏色筆',steps:['一起挑三種喜歡的顏色。','各畫一小塊今天想記住的事。','替這張圖起一個名字。']},
{id:'story',title:'故事的下一頁，由你來',category:'閱讀',minutes:15,number:'02',shape:'book',color:'lilac',subtitle:'在故事停下的地方，留一點想像的空間。',materials:'一本熟悉的圖書',steps:['選一段已經熟悉的故事。','停在中間，猜猜下一頁可能發生甚麼。','翻頁後再聊聊自己的版本。']},
{id:'leaf',title:'散步時的小小收藏',category:'戶外',minutes:20,number:'03',shape:'leaf',color:'mint',subtitle:'用眼睛找形狀，把公園變成觀察簿。',materials:'紙與筆；不必採摘植物',steps:['在熟悉的路線找三種不同形狀。','用紙筆簡單畫下來。','回家後把圖排成一張小地圖。']},
{id:'sound',title:'房間裏的聲音地圖',category:'遊戲',minutes:5,number:'04',shape:'wave',color:'yellow',subtitle:'安靜一會，聽聽身邊藏了甚麼。',materials:'一個熟悉的空間',steps:['一起停下來聽一小會。','輪流說出聽到的聲音。','用手勢或圖畫表示它的位置。']},
{id:'postcard',title:'給明天一張明信片',category:'畫畫',minutes:15,number:'05',shape:'card',color:'blue',subtitle:'一幅圖、一句話，收進自己的小郵局。',materials:'紙與筆',steps:['畫一件今天喜歡的事。','加上一句想對明天說的話。','放在自己選好的地方，明天再看。']},
{id:'book-pick',title:'今晚，讓封面來選書',category:'閱讀',minutes:10,number:'06',shape:'stack',color:'pink',subtitle:'看顏色、看角色，從好奇開始閱讀。',materials:'兩三本已有的圖書',steps:['把幾本圖書封面朝上放好。','選出現在最想知道的一本。','聊聊為甚麼想選它，再一起閱讀。']}
];
export function selectIdeas(items,filter={},favorites=[]){const q=(filter.query??'').trim().toLocaleLowerCase();return items.filter(x=>(!filter.category||filter.category==='all'||x.category===filter.category)&&(!q||[x.title,x.category,x.subtitle,x.materials,...x.steps].join(' ').toLocaleLowerCase().includes(q))&&(!filter.favoritesOnly||favorites.includes(x.id)));}
export function toggleFavorite(ids,id){if(!ideas.some(x=>x.id===id))return ids;return ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];}
