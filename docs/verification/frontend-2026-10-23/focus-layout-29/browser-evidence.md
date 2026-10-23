# 瀏覽器證據：紅項、修後結果及限制

## 版本與方法

舊版 snapshot27a bundle `abf3e8dc7d012a87db73ac5732721cc10429c68454144b2fbfff8c3aba4dbcf2`；新版 snapshot29 bundle `6f3e3bc65a6201f666d8bf96c0d5933ac64133b724ef579874adfcaaa257c8e5`。公開合成 fixture 保持 `461064eb151bff716b67a93ecc8b9305fdc2c0c05bdbf42eaa599fc2af00ef6d`。模型審閱使用獨立合成可讀狀態，只驗前端，並非正式模型接線。

原圖都是 **1364×1024 JPEG 原 bytes**，包含瀏覽器／QA 外框，不是 full-page。歷史檔名雖為 `.png`，檔案內容實為 JPEG；本包只用正確 `.jpg` 名稱逐 byte 複製，不轉碼、裁切、拼圖或生成。CSS viewport、HTML zoom 與 Chrome zoom 是三個不同量度，各圖分別標明。游標光暈不當作產品陰影。

## 原紅項與本版重驗

- **Count 自然 focus：**27a 曾消失58ms，但取樣主卡／page／gate未重掛；29在1024×600、HTML1.4、Chrome100%的觀察窗，count1及原節點保留，未重現該消失。成功空snapshot亦保留count0及空卡。這是限定取樣結果，不是連續影片或所有後代節點保證。
- **Tabs 底線：**27a停留超過10秒仍左偏50.328125 rendered px；29在原1024尺寸量得偏差0.0718689px，390重複切換後0.0320282px，屬量測／小數取整範圍。未獨立驗reduced-motion。
- **Care 已保存／詳情：**24筆已載節點、詳情節點及scroll342.857147保持；390事件正文主次及長文截行／無水平溢出通過。
- **歷史待辦：**390單欄、長標題／摘要、整列click／Enter／Space、詳情藏清單與AX、關閉回原row及scroll通過。1440是單欄清單＋右詳情，不是兩筆並排。1024／360有補充，360是在開詳情後resize，不能當同尺寸scroll恢復證據。
- **歷史刷新：**三筆已載row保持，但這段是測試harness同owner刷新，不能冒稱自然focus。
- **合成模型設定審閱：**開窗後自然focus保留dialog／非秘密欄位，確認未勾選；取消後才排出一組GET。沒有輸入key、勾確認、提交或真模型呼叫。

完整分項、viewport及原證據hash見 [browser checks](receipts/browser-checks.json)，焦點取樣見 [focus observations](receipts/snapshot29-focus-observations.json)，舊紅量測見 [baseline observations](receipts/baseline27a-observations.json)。

## 八張精選原圖

| ID／版本 | CSS px；HTML／Chrome zoom | 原圖及用途 |
|---|---|---|
| B01／27a RED | 1024×600；1.4／100% | [舊已保存底線偏左](screenshots/baseline27a/11-old-saved-tab-marker-0.jpg) |
| G01／29 | 1024×600；1.4／100% | [自然focus返回後count1](screenshots/snapshot29/09-pending-native-return-0.jpg) |
| G02／29 | 1024×600；1.4／100% | [已保存詳情返回後讀取位置](screenshots/snapshot29/19-saved-detail-native-return-0.jpg) |
| G03／29 | 390×700；1.2／80% | [歷史單欄及長內容](screenshots/snapshot29/24-history390-long-rows-scroll-0.jpg) |
| G04／29 | 1440×700；1.4／80% | [單欄清單＋右詳情](screenshots/snapshot29/33-history1440-detail-0.jpg) |
| G05／29 | 390×700；1.2／80% | [已保存事件正文優先](screenshots/snapshot29/39-care390-saved-top-0.jpg) |
| G06／29 | 1024×600；1.4／80% | [成功空snapshot返回後](screenshots/snapshot29/48-care-empty-native-return-0.jpg) |
| G07／29 | 1024×600；1.4／80% | [合成模型審閱窗返回後](screenshots/snapshot29/61-model-review-native-return-0.jpg) |

只附上述8張；52張新版原圖及3張舊版重點原圖的名稱／SHA-256見[完整原件索引](original-images-index.json)，未附的原件仍保留本地。靜態圖不能獨立證明毫秒級過渡，必須連同相應JSON判讀。

## 剩餘與限制

Memory／tasks已載更多與summary未套用期間的自然focus，留snapshot30；通知偏好表單29亦未實屏。Sources／Chat本批只有來源／測試證據，不列新browser PASS。沒有17個家長route全部重跑，沒有全狀態、真機、完整讀屏或WCAG合規結論。Pending較早transport被100列ring截斷，不能推定該段無GET。舊Chrome code9／timeout原因未明；不改寫成產品故障或OOM。

本版未公開發布；Site86／舊PR狀態不因本地驗收自動改變。後續metadata／icons及Contact修補以snapshot30自己的freeze與結果另記，不回填29。
