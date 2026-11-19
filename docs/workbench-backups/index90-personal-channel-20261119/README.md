# 第 76 題｜到了 Telegram：這是收提示的本人帳號嗎？

假設家人共用平板，從育伴港開啟 Telegram，不代表已綁定。回來讀取狀態，若仍等待，就不要冒充已連接；找到候選也只是待確認。先看候選名稱及遮罩帳號是否認得，不對就不確認、不發測試，重新開始會使舊候選失效。只有明確確認這個本人帳號才綁定，不等於允許助手聯絡家人或已送出通知。工作台只看作者文件，不連任何帳號，也無配對碼。

## 兩個原作者的畫面

**本人渠道-01｜AudioCodes：開始後仍看得出正在等待。** 看版本說明第 30 頁連續兩個完整畫面：發出請求後仍顯示同一台裝置，標「Waiting for a response…」，可取消。這是另一裝置尚未回應，不是已配好。借的是跨裝置等待的狀態；它不是 Telegram 帳號、不是核對本人，也不要求家長開藍牙。

[看 AudioCodes 作者原書第 30 頁的完整等待畫面（需連網）](https://www.audiocodes.com/media/15462/c448hd-and-c450hd-ip-phones-for-microsoft-teams-release-notes-ver-179.pdf#page=30)。[AudioCodes 作者刊期頁](https://www.audiocodes.com/media/15462/c448hd-and-c450hd-ip-phones-for-microsoft-teams-release-notes-ver-179.pdf#page=6)；[AudioCodes 版權聲明](https://www.audiocodes.com/media/15462/c448hd-and-c450hd-ip-phones-for-microsoft-teams-release-notes-ver-179.pdf#page=60)。

AudioCodes 版本說明 1.7.9（2020-10-28），§3.4.1 示例為電話軟件 1.3.51／Teams 2020040801；截圖日期未列。 保留所有權利；只連作者原 PDF 的頁面，不抽取或嵌入圖片。

**本人渠道-02｜任天堂：回來後先核對候選帳號。** 在任天堂官方圖解下選 Switch 2 第 8 步：同時見候選暱稱、遮罩帳號和可選的連接／取消。這才是確認，不是只從手機回到主機就連好。若對不上，先取消。任天堂的帳號規則不適用於育伴港，也不是通知權限或送達示例。

[開任天堂官方圖解：看 Switch 2 第 8 步（需連網）](https://www.nintendo.com/my/parents/switch/preparation/connect-created.html)。[任天堂官網圖片與外鏈政策](https://www.nintendo.com/my/about_hp.html)。

任天堂馬來西亞官方英文圖解，Nintendo Switch 2，硬件分支及步驟可定位，軟件 build、發布日與捕捉日未列。 依作者政策只連正式 HTML 教學頁；不直連原 JPG 或嵌入。

## 當時 master 的實作依據

由 GitHub connector 讀取 refs/heads/master，固定 [7bd8cbbfcf24ac577048ea24a8bd221f5beb6055](https://github.com/2NTTY/child-ai-caregiver/commit/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055)；只讀原碼，未作實機驗收。

1. [正式設定的「本人的通知渠道」同頁分開 Push 與 Telegram，Telegram 載入 production model](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/frontend/src/production/SettingsDomains.tsx#L106-L120)。[本人渠道的現有綁定身份、狀態及不同操作](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/frontend/src/components/notifications/ChannelCards.tsx#L297-L320)；[私人步驟的到期時間、開啟 Telegram、回來手動讀取、無候選或候選名稱與帳號提示](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/frontend/src/components/notifications/ChannelCards.tsx#L320-L340)。這是跨兩個 app 的完整任務，並非只研究一個按鈕。
2. [開始和確認的語意不同；綁定不是廣泛聯絡授權](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/frontend/src/components/notifications/ChannelCards.tsx#L39-L50)；[重開對舊候選的影響、確認勾選、提交與取消](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/frontend/src/components/notifications/ChannelCards.tsx#L108-L129)。[正式操作檢查同一候選及未過期版本，分開 begin、confirm、revoke、test；完成後重讀](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/frontend/src/production/useProductionTelegramSettings.ts#L54-L77)；[候選名稱及帳號提示綁在這次確認，僅開始步驟會開啟外部入口](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/frontend/src/production/useProductionTelegramSettings.ts#L81-L94)。
3. [伺服器建立十分鐘的 waiting 步驟；新步驟取代仍在等待／已看到候選的舊步驟](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/server/firestore-telegram.ts#L99-L123)。[在 Telegram 完成後只增加候選、轉為 seen](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/server/firestore-telegram.ts#L220-L235)；[另一次確認才使這一個目標成為 active binding](https://github.com/2NTTY/child-ai-caregiver/blob/7bd8cbbfcf24ac577048ea24a8bd221f5beb6055/server/firestore-telegram.ts#L125-L144)。產品顯示的是遮罩帳號提示，不是要求家長比較密碼或提供私人啟動連結給另一人。

## 私用版本與驗證

- 私用離線檔：`育伴港選配工作台-76主題-本人通知渠道核對-20261119.html`；30,980,076 bytes；SHA-256 `ae7001b943c6166b755cc276f258ec51f67b807281a7b6136f78367c5e6a371a`。保存已交付第 75 題基準 `898e9b0ae0a1e2165d2fd8992dc66d4c32c8a51d7d806e78f45bcee539ba6345` 的全部紀錄與原圖。

- 76 題、155 款。原來的 146 張圖逐張核對；本題作者圖只保留原始連結。頁上不會對作者網站預取、登入、開啟、確認或測試任何綁定。

- 已驗證離線結構、內容安全策略、JS 語法以及新版閱讀器的模擬導覽、並看、選擇、複製來源、替換和撤選。未做瀏覽器／真機或產品功能實測；沒有讀取真實家庭資料、調用模型或實際派發事項。本分支只有文字備份，沒有建立 PR、合併或發布網站。
