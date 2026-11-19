# 第 63 題｜自訂背景：換上喜歡的圖，訊息還看得清嗎？

假設用一張色彩豐富的海港插畫作背景。「明天下午三點帶畫簿」這句話當中，能不能一眼找到時間，也看得出圖裡的海港？左例看套用前可從兩句訊息判斷甚麼，右例看套用後整段對話的可讀效果。海港和例句均是虛構情境，不是家庭照片或訊息。這是純文字設計比較，不是要求更換設定。

## 育伴港現在怎樣運作

依據[固定修訂 3c02633a](https://github.com/2NTTY/child-ai-caregiver/commit/3c02633a4160f097732c4b56812cb882e54de48b)查核源碼，沒有以瀏覽器或真機執行產品。

1. **在哪裡換、換到哪裡。** 到[設定的「外觀」分頁](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/settingsScreen.tsx#L29-L33)找[應用背景](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/screens/settingsScreen.tsx#L93-L96)。這是登入後的個人工作區裝飾，影響首頁和聊天等頁；不是一個群組共用的桌布、某一段聊天的專屬背景或孩子頭像。[設定說明](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/appearance/BackgroundSettings.tsx#L28-L34)標明網頁和手機分開設定，登出後不顯示。
2. **選圖直接套用，小卡展示現在。** 設定內有[「今日」示例閱讀卡和恢復預設選項](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/appearance/BackgroundSettings.tsx#L19-L34)。選了有效圖片後，[本機保存成功才更新；失敗保留原背景，還原也以本機清除成功為準](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/preview/BackgroundContext.tsx#L37-L60)。小卡反映目前設定，不是要求按「套用」或「取消」的下一步。
3. **先讀字，再看露出的圖。** [設定預覽和工作區使用相同背景元件](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/appearance/AppBackdrop.tsx#L7-L16)，有淺色遮層，圖片只作裝飾。[網頁閱讀面板](https://github.com/2NTTY/child-ai-caregiver/blob/3c02633a4160f097732c4b56812cb882e54de48b/frontend/src/components/appearance/backgroundSurface.css#L1-L25)預設有實色底，在支援時可使用霧化；減少透明度或強制色彩時不用霧化。這不代表使用者可調整霧化，也不是所有圖片都適合閱讀或達到 WCAG 對比度的證據。

第 11 題比較外觀設定放在獨立頁還是總覽，第 60 題比較裁切後能否認出頭像。這一題要認出的不是圖片主角，而是**圖片上方的訊息**。

## 兩款原作者畫面與取捨

**背景-01｜Telegram：套用前，把兩句訊息放在照片上。** 把原片拉到約第 5 秒：燈塔上方有日期，白色和淺綠色氣泡各放一句訊息。先讀日期，再看氣泡內文；到約第 8 至 9 秒，燈塔變模糊，兩句話仍在原位。這是 Telegram 的套用前預覽，底部另有 Cancel／Set。值得借的是用同一段文字比較背景，而不是它的模糊、動態或確認控制。兩句短訊也不能代替一整段閱讀。 [看 Telegram 官方短片：第 4 至 10 秒的燈塔預覽（需連網）](https://telegram.org/file/811140201/17dc/zl5I4FqY-0I.8621957.mp4/fc46a9cbd83c40c5cd#t=4,10)。[Telegram 原文：Chat Backgrounds 2.0](https://telegram.org/blog/backgrounds-2-0)。

Telegram 團隊於 2019-01-31 發布的 iPhone 示範；燈塔來自片中的選圖網格。未標手機型號或 App 版本，不是現版實測。 只連作者短片與文章。沒有核實這支部落格影片可重發；工作台不截幀、不內嵌。

**背景-02｜Apple 訊息：套用後，用完整對話檢查長文和小字。** 在 Shred Heads 群組原圖，先讀左側深色氣泡中的一段白字，再找日期和底部輸入欄。紫灰色照片與深色剪影在哪些空隙露出？右邊藍色語音氣泡的波形又靠甚麼底色襯托？這張完整畫面讓你同時看正文、標記及操作區；它展示已套用的效果，沒有顯示怎樣選圖。可借這種讀法檢查育伴港的長回答，不必仿製 Apple 的群組或語音功能。 [看 Apple 官方整機原圖：照片上的完整群組對話（需連網）](https://www.apple.com/newsroom/images/2025/06/apple-elevates-the-iphone-experience-with-ios-26/article/Apple-WWDC25-iOS-26-Messages-custom-photo-Background-250609_inline.jpg.large.jpg)。[Apple Newsroom 原文：iOS 26 的 Messages 圖組](https://www.apple.com/newsroom/2025/06/apple-elevates-the-iphone-experience-with-ios-26/)。

Apple 於 2025-06-09 發布的 iOS 26 預覽公告；這是當年的 iPhone 宣傳畫面，未標手機型號，不是現版實測。 只連 Apple Newsroom 原圖與公告。未確認可將此圖重發至公開工作台；不擷取、不轉載。

**我會先選背景-02。** 如果問題是「忙著照顧孩子時，能不能很快找回提醒裡的時間」，完整對話比兩句示例更有用：讀完一段，再找小日期和輸入欄，便知道背景搶走了哪裏的注意力。若要決定設定頁的小卡應展示甚麼，再看背景-01 的白、淺綠氣泡和日期如何放在同一張圖上。不必在產品多加一次「套用」。

原件於 2026-11-19 核對。Telegram 直式原片為 540 × 960，約 27.65 秒；播放器若忽略標記，手動拉至約第 5 秒。Apple 原圖為 653 × 914，從狀態列到輸入區均可見。兩者都是原作者示例，不是測得的對比度，也不能代替在實際背景、畫面及文字尺寸下檢查。

工作台不自動載入原站素材。[Telegram 媒體說明](https://telegram.org/press)所述的圖庫截圖不等同這段影片的重發授權；[Apple 網站使用條款](https://www.apple.com/legal/internet-services/terms/site.html)亦不在此解讀為可以轉載該圖。只提供讀者主動點開的作者原件。

## 檔案與驗證界線

- 私用 HTML：`育伴港選配工作台-63主題-自訂背景可讀性外鏈版-20261119.html`，30,928,031 bytes，SHA-256 `14c3a50cb21c9ed85804b994b29551ee7a467a307e4a72d1a9e3cbad17c4410f`。62 題版已交付檔的基準為 `d91c18288fe81db612fa20e601a3367a556acd77fa0fdb79394b4ac40f062858`。
- 共 63 題、129 款：77 款離線、52 款外鏈。從新版資料區移除第 63 題新增的位元組，即可逐位元組還原前版完整資料區；146 張舊圖均經解碼、逐張核對 SHA-256。新題只有兩個主要作者原件（短片、原圖）及 2 個補充連結，沒有新增任何內嵌圖片或遠端自動載入。
- 靜態、CSP 雜湊與 JavaScript 語法通過；離線 VM 通過 57 組檢查，包括全 63 題單看／並看、新題連結、選取／改選／撤回、摘要往返、保留舊選擇、焦點狀態及末頁邊界。VM 只模擬工作台閱讀器，不會開原站。沒有瀏覽器、真機、實際選圖／還原、對比度量測、模型、TypeScript 或產品匯出測試；沒有變更育伴港或發布預覽。
