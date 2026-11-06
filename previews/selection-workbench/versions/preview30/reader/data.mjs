const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const documents = freeze([
  {
    id:'objects', title:'小物與日常', subtitle:'一份關於桌面、紙張與收納的合成閱讀樣本', code:'DOC / 001',
    versions:[
      {id:'objects-v2',label:'第 2 版 · 加入收納尾章',status:'ready',edition:'02',note:'這是獨立寫作的第二份合成版本，並非真實資料更新。',
        chapters:[
          {id:'opening',title:'一張桌子的留白',label:'開篇',paragraphs:[
            '下午的光停在桌角。桌上留著一隻茶杯、一張對摺的紙，還有尚未放回原處的鉛筆。這份小冊子從這些普通物件開始，沒有需要完成的清單。',
            '把紙攤開，先記下一個看見的細節：杯墊有圓圓的邊，紙面留下細小的摺痕。文字只是這個合成場景的描述，沒有替任何人的生活作判斷。'
          ],sourceIds:['desk-note']},
          {id:'paper',title:'紙上散步',label:'片段',paragraphs:[
            '在紙的一端畫一條彎曲的線，線的另一端不必通向目的地。途中可以有一座方形的小屋、一片空地，或者只是幾個不同方向的點。',
            '紙張翻過來，另一面仍然空白。這裏記下的只是虛構的製作片段，不是活動建議、孩子能力紀錄，亦不是從家庭資料整理而來。'
          ],sourceIds:['paper-note']},
          {id:'pause',title:'留一段空白',label:'未核實片段',paragraphs:[
            '這一章保留了一段沒有附上來源便箋的合成文字，用來測試閱讀畫面遇到資料缺口時的呈現。空白不是錯誤答案，也不會被補寫成已經發生的事情。',
            '可以閱讀這段示例，但不應把它當作經來源核對的記錄。旁邊會清楚標出缺少哪一份合成引用。'
          ],sourceIds:['not-provided']},
          {id:'closing',title:'把小物放回去',label:'尾章',paragraphs:[
            '鉛筆回到筆筒，紙張放進一個普通的信封。茶杯旁邊的空間重新出現，桌面與開始時不完全相同，也不需要恢復得一模一樣。',
            '這份文件到這裏結束。如果想稍後回到這一章，可以留下本頁書籤。書籤只存在這個開著的頁面，重新整理後便會消失。'
          ],sourceIds:['shelf-note']}
        ],
        sources:[
          {id:'desk-note',title:'桌面便箋',status:'synthetic',kind:'原創合成片段',revision:'S-01 / 版本 1',text:'桌面合成場景：一隻茶杯、一張對摺紙、一支鉛筆；下午的光落在桌角。',context:'為 D01 閱讀探索專門編寫。沒有真實人物、時間或家庭記錄。'},
          {id:'paper-note',title:'紙張便箋',status:'synthetic',kind:'原創合成片段',revision:'S-02 / 版本 1',text:'紙上有彎曲線條、方形小屋與幾個點；紙張背面留白。',context:'只支援示範來源檢閱，並非照顧指引或發展評估。'},
          {id:'shelf-note',title:'收納便箋',status:'synthetic',kind:'原創合成片段',revision:'S-03 / 版本 1',text:'鉛筆放入筆筒，紙張放入信封，桌面留下一片空間。',context:'此合成引用只出現在第 2 版的尾章。'}
        ]
      },
      {id:'objects-v1',label:'第 1 版 · 兩章短篇',status:'ready',edition:'01',note:'獨立合成舊版，只有開篇與紙上散步；不混入第 2 版新增段落。',
        chapters:[
          {id:'opening',title:'一張桌子的留白',label:'開篇',paragraphs:['桌上有一隻茶杯和一張紙。這份較早的合成短篇只從兩件物件開始。','第 1 版沒有收納尾章。切換版本後仍然可以讀同名章節，但內容保持這一版自己的文字。'],sourceIds:['desk-note-v1']},
          {id:'paper',title:'紙上散步',label:'片段',paragraphs:['紙上只有一條線，暫時沒有小屋和點。這是第一版的合成描述。'],sourceIds:[]}
        ],sources:[{id:'desk-note-v1',title:'舊版桌面便箋',status:'synthetic',kind:'原創合成片段',revision:'S-01 / 草擬版本',text:'兩件物件：茶杯與紙。',context:'不是第二版來源的讀取結果；版本之間不混合內容。'}]
      },
      {id:'objects-v0',label:'第 0 版 · 正文不可用示例',status:'unavailable',edition:'00',note:'這個示例版本沒有提供正文或來源。頁面不會替你換成另一版，也沒有連線讀取或重試。',chapters:[],sources:[]}
    ]
  },
  {id:'walk',title:'轉角的慢步調',subtitle:'以街角、招牌與座椅組成的虛構小冊',code:'DOC / 002',versions:[
    {id:'walk-v1',label:'第 1 版 · 三章短篇',status:'ready',edition:'01',note:'所有街景與路線均為虛構，沒有真實位置或人物。',chapters:[
      {id:'corner',title:'從轉角開始',label:'開篇',paragraphs:['轉角有一塊長方形招牌，字跡沒有指定店名。行人路向前延伸，這份合成小冊只描寫街景，不提供真實導航。','換一份文件，章節與來源也跟著更換。上一份文件的內容不會留在這裏充當新的依據。'],sourceIds:['corner-note']},
      {id:'bench',title:'長椅與樹影',label:'片段',paragraphs:['一張長椅放在樹影旁。椅面朝向小路，樹葉把光分成大小不同的形狀。','這段文字沒有記錄任何人的停留時間。沒有數據的地方，保持沒有數據。'],sourceIds:['bench-note']},
      {id:'return',title:'回到起點',label:'尾章',paragraphs:['路線在紙上繞了一個圈，最後又回到沒有名字的招牌。整段散步只存在這份合成文件裏。'],sourceIds:[]}
    ],sources:[
      {id:'corner-note',title:'街角速寫文字',status:'synthetic',kind:'原創合成片段',revision:'W-01 / 版本 1',text:'轉角、長方形招牌、向前延伸的小路。',context:'沒有真實地址，不是路線建議。'},
      {id:'bench-note',title:'樹影便箋',status:'synthetic',kind:'原創合成片段',revision:'W-02 / 版本 1',text:'長椅朝向小路，旁邊有斑駁的樹影。',context:'為雙欄來源檢閱編寫的虛構材料。'}
    ]}
  ]}
]);
