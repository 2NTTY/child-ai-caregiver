# 第 57 題｜家庭共享：家人看得到這個孩子的哪些資料？

例如家長把小晴的「照顧記錄」和「待辦」開放給「海星家庭」，附件一直沒有共享。後來只想保留待辦：家長需要看到自己正在改哪個家庭、哪位孩子和哪幾類資料，而不是再傳一份文件。「海星家庭」和「小晴」是虛構例子。

## 育伴港怎樣界定範圍

前置讀碼基準為 [2NTTY/child-ai-caregiver，master 的 3c02633](https://github.com/2NTTY/child-ai-caregiver/commit/3c02633a4160f097732c4b56812cb882e54de48b)。[家庭名單與加入提示](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/familyScreen.tsx#L99-L114) 區分「加入家庭」與「共享資料」；成為成員不會自動分享任何孩子的資料。[範圍與確認摘要](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/familyScreen.tsx#L188-L197) 的對象是選定家庭目前的成員，並非逐名授權。新選的類別取代本人為這個孩子提供的原範圍；至少保留一類才能保存。[既有共享清單及修改／撤回](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/familyScreen.tsx#L139-L159) 另設撤回入口，不是保存空清單；撤回整份共享不等於移除家庭成員，原件仍留在來源帳戶。這是對介面與契約的描述，沒有操作帳戶、傳送資料或驗證後端權限和生效時間。

## 兩款設計對照

1. **共享-01｜Apple 健康：逐類看清開放了甚麼。** [官方整屏原圖](https://www.apple.com/newsroom/images/product/os/ios/standard/Apple_wwdc21-ios15-health-app_privacy_06072021_inline.jpg.large.jpg) 先列一位既有共享對象，再分組列出選項；停止與此人共享的入口和單一項目的開關分開。畫面的開關全部開啟，未演示切換後的結果。[Apple Newsroom 原文](https://www.apple.com/newsroom/2021/06/apple-advances-personal-health-by-introducing-secure-sharing-and-new-insights/#:~:text=Privacy%20is%20fundamental) 於 2021-06-07 發布，屬 iPhone 12 Pro 上的 iOS 15 預覽，不是當前 iOS 實測。育伴港可借其閱讀順序，把「海星家庭目前的成員 · 小晴」「保留：待辦」「不再共享：照顧記錄」放進同一次核對。沒有借用逐人權限或醫療項目。
2. **共享-02｜Dexcom G7：從總覽分清哪些仍在共享。** [官方手冊 PDF 第 92 頁／印刷頁 84](https://dexcompdf.s3.us-west-2.amazonaws.com/en-us/G7-CGM-Users-Guide.pdf#page=92) 的 Follower status 左圖讓讀者同時看見服務總狀態和不同對象各自的共享狀態。Dexcom 展示的是「暫停給某一人」，並沒有在這張圖切換資料類別。育伴港則應在總覽列出「哪個家庭、哪個孩子、還共享哪些類別」。只保留待辦後，可以回到清單查核；完全停止是撤回本人為該孩子向該家庭提供的整份共享，不是暫停某個人的權限。[Dexcom 官方手冊索引](https://www.dexcom.com/en-us/guides) 提供美國英文版 AW00078-10 Rev 005（2026-05），截圖 App 組建號未標示。

兩款各有一條第一方原圖或指定手冊頁連結，及一條官方發布頁連結。圖像與手冊權利屬各權利人，未取得重刊許可；沒有鏡像、嵌圖、裁剪重發、抄錄示範人物或健康數據。未把來源產品的選人方式套作育伴港功能。

## 製作及驗證範圍

- 私用單檔：`育伴港選配工作台-57主題-家庭共享範圍外鏈版-20261119.html`，30,905,660 bytes，SHA-256 `eeb83f014f29584731ef643fedf1f7c221162fe5e40c90ac0f4cf2e79493fc0b`。基準為已交付的第 56 題版，SHA-256 `e65192acd7cbc4ac407c0b471b401af133f7ba183c4fa24a69a96810aeec15c8`。
- 合計 57 題、117 款：77 款離線、40 款外鏈。移除新增的一筆後，原 56 題資料段逐位元組一致；146 張既有離線圖逐張解碼核對 SHA-256。沒有新增內嵌媒體。
- 靜態與腳本語法檢查通過。離線 JavaScript VM 完成 39 項閱讀器檢查，包括所有主題的單看／並看、第 56 與 57 頁往返和末頁邊界、選擇／改選／清單定位／撤回、其他主題選擇保留、按鈕焦點與選取狀態、兩條原件和兩條來源連結。新題只有選配按鈕，沒有可操作的共享、撤回或權限控制。沒有使用瀏覽器、驗收真機或外部 App，沒有改動育伴港的實際共享設定。
