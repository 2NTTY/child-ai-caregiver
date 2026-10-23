# 自選高對比背景獨立補驗

**限定樣本通過：1張合成高對比PNG、5頁型各1024×600／390×600，共10組代表畫面，原UI保存、切頁保留及恢復後重載均有證據。** 另保留聊天浮鈕P3取捨與未定因的Chrome中斷；不是全站、所有圖片或瀏覽器穩定性通過。完成時間為2026-10-22 23:36 UTC，不倒填先前審查的完成時間。

## 版本與方法

本補驗在隔離的snapshot27a Chrome預覽使用原選圖、站內連結及恢復UI；沒有改產品或Site86。12個背景相關產品檔與27a逐hash相同，源碼引用固定在`18fd71fd3d061c7e413514c5dce7fa67acce50fe`，產品commit仍為`c18a6b67740013ea5631669fd8bf63acc2d1f5a3`。

測試圖只有色塊、黑白斜線與紅格，1600×1000 PNG／22,856bytes，SHA-256 `1f16dd95b6bbedacc5f56ab70e75095e661615d560ca092a4efe117faf57120d`。真屏顯示相同圖案及保存成功，未抽取瀏覽器Blob重新hash。初末DOM載入`index-b25abcd6abf772c2344980e5241248a5.js`；這是身分觀察，不是遠端HTTP字節重驗。

原階段曾未能確定選圖結果；後來的成功畫面與DOM才確立已保存，沒有再選圖或注入storage／產品狀態。Source與DOM的CSP均禁止連線；本次未發聊天、叫模型、傳真資料或使用正式服務。這些不是完整網絡封包「零外送」測量。

## 五頁型雙尺寸結果

下列BG編號可在[證據索引](evidence-index.json)找到hash。**只有本報告後列的7張JPEG隨包附上；其餘原圖、DOM與AX僅封存hash和本地原件，不是可公開點開的全部證據。**

| 頁型 | 1024×600 | 390×600 | 限定觀察 |
|---|---|---|---|
| 概況 | BG-08 | BG-09 | 標題、檔案狀態、日期與更正按鈕可讀。 |
| 歷史 | BG-10 | BG-11、12 | 搜尋、篩選、白／淺藍卡片保留可讀性。 |
| 設定／外觀 | BG-14 | BG-16、17 | 動畫、選圖及恢復控件可讀；示意預覽另有玻璃層。 |
| 首頁 | BG-19 | BG-18、18B | 黃／白卡底色保留；短暫問候另有自身玻璃。 |
| 聊天 | BG-20、24 | BG-21、22、23 | 可見內容與composer可讀，浮鈕局部遮字另列P3。 |

各頁有一塊主要閱讀承托層；聊天頂部工具列、首頁短暫問候及設定示意預覽是額外特定區域，**不是每整頁恰好只有一個blur元素**。未見逐卡或逐訊息加玻璃。09–14的全div backdrop掃描與source互相支持；16之後只讀有標記surface。`23-chat-message-styles.json`只匹配actions容器，不作訊息正文computed-style證據。BG-20顯示現有訊息／限制提示與輸入區，不代表所有長回覆在每個捲動位置都可讀。

## P3 聊天浮鈕閱讀取捨

高對比背景、390×600向上捲時，「回到最新」浮鈕蓋住局部文字（BG-22、23）。之後**在預設背景**，正常捲動可完整讀出先前受遮的使用者句（BG-30），並分段讀完合成回覆（BG-31、32）；回到最新後浮鈕消失（BG-29）。未發現該組訊息永久不可達，列P3改善建議，未改產品。

這不是高對比狀態每個scroll位置逐一驗證。早期BG-27捲動過頭，不拿來作完整閱讀恢復證據。

## 保存及恢復

選取後顯示「背景已保存在此裝置」，同origin站內切頁及重新載入仍保留測試圖。最後用原「恢復預設背景」UI成功還原（BG-25，`customImages=0`、`surfaces=[]`）；重載後概況仍為預設（BG-34，同樣0／空陣列）。沒有直接清storage代替UI恢復，也沒有留下真帳戶照片。

## 新增Web picker契約測試

[可在repo執行的測試](../../../../../frontend/scripts/background-web-picker-contract.test.mjs)載入真picker；React／UI、Image解碼回報與object URL使用deterministic ports，File／Blob為合成bytes。

| 同一test的順序觀察 | 結果 |
|---|---|
| 4 MiB與4000×4000上限 | 可交付原Blob，重複dispose僅revoke一次。 |
| 4 MiB＋1 byte | object URL／decoder前拒絕，不交付選取。 |
| 4000×4001 pixels | decoder port完成後拒絕、清handlers並釋放臨時URL。 |
| unmount後晚decode | 不再發選取／錯誤／reading callbacks，仍釋放URL。 |

原跑為**1 test／4段觀察通過**，0失敗、0跳過。交付只調整harness相對import，保持正文與斷言不變；隔離副本可移植性覆跑仍1/1通過，約440ms，[log](portable-contract-rerun.log)可讀。兩次執行是同一test，**不相加、不算4項browser驗收，也不併入原136項**。本地fetch tripwire為0，不代表browser資產HTTP為0。

依repo既有依賴環境，從repo根目錄執行：

```sh
node --test frontend/scripts/background-web-picker-contract.test.mjs
```

Node版本v24.19.0。這份測試不證明真codec、browser Image尺寸回報、原生chooser、IndexedDB引擎或實屏可讀性；後者由上述限定browser證據另行支持。

## 主要源碼證據

- [Web picker第7–49行](https://github.com/2NTTY/child-ai-caregiver/blob/18fd71fd3d061c7e413514c5dce7fa67acce50fe/frontend/src/components/appearance/BackgroundImagePicker.web.tsx#L7-L49)：格式／大小／像素檢查、晚結果及URL釋放。
- [Provider第37–60行](https://github.com/2NTTY/child-ai-caregiver/blob/18fd71fd3d061c7e413514c5dce7fa67acce50fe/frontend/src/preview/BackgroundContext.tsx#L37-L60)：保存成功才換圖，恢復成功才清選取，失敗保留原狀。
- [本機storage第9–50行](https://github.com/2NTTY/child-ai-caregiver/blob/18fd71fd3d061c7e413514c5dce7fa67acce50fe/frontend/src/platform/background-storage.ts#L9-L50)：scope-keyed IndexedDB Blob，不是照顧照片API。
- [承托層CSS第1–25行](https://github.com/2NTTY/child-ai-caregiver/blob/18fd71fd3d061c7e413514c5dce7fa67acce50fe/frontend/src/components/appearance/backgroundSurface.css#L1-L25)：主面板與實底fallback；fallback未在本輪實屏驗證。
- [既有聊天浮鈕第117–143行](https://github.com/2NTTY/child-ai-caregiver/blob/18fd71fd3d061c7e413514c5dce7fa67acce50fe/frontend/src/components/chat/ChatTimeline.tsx#L117-L143)：懸浮位置與回到最新行為；此檔亦與27a相同，另列而不混入原12檔數。

## 七張原圖

全部逐張確認只見合成資料、無真家庭資訊或憑證；逐byte複製為正確`.jpg`，沒有裁切、拼接、轉碼或改圖。圖中保留原測試外框，部分含本機位址，不是公開Site86的新smoke。BG-12原圖尺寸1188×761，其餘1364×1024；應用CSS尺寸另列，不能混為一談。

| 原圖 | CSS尺寸 | 證據 |
|---|---|---|
| [BG-12 歷史卡片](screenshots/12-history-390-cards.jpg) | 390×600 | 高對比背景下卡片底色與文字。 |
| [BG-19 首頁](screenshots/19-home-1024.jpg) | 1024×600 | 主要承托層與黃／白卡。 |
| [BG-20 聊天](screenshots/20-chat-1024.jpg) | 1024×600 | 現有訊息／限制提示、工具列與輸入區。 |
| [BG-22 浮鈕局部遮字](screenshots/22-chat-390-messages.jpg) | 390×600 | 高對比狀態的P3觀察。 |
| [BG-25 UI恢復](screenshots/25-restored-settings-1024.jpg) | 1024×600 | 已恢復預設的產品提示。 |
| [BG-30 正常捲動可讀](screenshots/30-default-chat-390-readable-user.jpg) | 390×600 | 預設背景完整讀到受遮使用者句；非同背景逐位置重驗。 |
| [BG-34 恢復後重載](screenshots/34-restored-after-reload-summary-1024.jpg) | 1024×600 | 概況仍為預設，與DOM補證對應。 |

## 剩餘界線

Chrome在本次過程出現code9中斷，恢復預設後亦曾發生；根因未隔離，不能歸咎PNG、斷言記憶體不足或認證browser穩定性。這不抹去已取得的限定畫面與恢復結果。

未覆蓋全部17頁、所有圖片／尺寸／錯誤狀態、Firefox、真手機、完整鍵盤／讀屏、forced-colors／reduced-transparency、真帳戶登入退出與完整封包測試。原交付的跨工作區retained狀態、模型成功表單及遠端HTTP字節核對限制不因本補驗消失。
