# 工作台第 24 版：通知安靜時段

本提交僅備份來源版本、圖像指紋與驗收範圍。**這個 GitHub 分支不能獨立重建完整預覽。** 不含圖片、原始碼副本、預覽 HTML、私人資料或存取連結。

## 兩款完整頁

- **A｜Hourly Beep 1.1.0：一張安靜時段表單。** [原頁](https://github.com/mahdiyazdani/hourly-beep/blob/aaa4606423f80f10b6e5557001b8a55f063139ba/options.html)及[時段預設](https://github.com/mahdiyazdani/hourly-beep/blob/aaa4606423f80f10b6e5557001b8a55f063139ba/options.js)，`mahdiyazdani/hourly-beep@aaa4606423f80f10b6e5557001b8a55f063139ba`，[GPL v3](https://github.com/mahdiyazdani/hourly-beep/blob/aaa4606423f80f10b6e5557001b8a55f063139ba/LICENSE)。先選開關和兩個時刻，下方說明跨夜以及起訖相同表示全天安靜；完整頁以儲存與測試報時聲按鈕結尾。
- **B｜MewMewNotification 1.5.2：通知規則中的一個時段。** [原選項頁](https://github.com/CosmosChiang/MewMewNotification/blob/eba9ff9e20677f97dde3c4a651ea0dc9a8f27d6c/options.html)及[分頁與保存邏輯](https://github.com/CosmosChiang/MewMewNotification/blob/eba9ff9e20677f97dde3c4a651ea0dc9a8f27d6c/scripts/options.js)，`CosmosChiang/MewMewNotification@eba9ff9e20677f97dde3c4a651ea0dc9a8f27d6c`，[MIT © 2025 MewMewNotification](https://github.com/CosmosChiang/MewMewNotification/blob/eba9ff9e20677f97dde3c4a651ea0dc9a8f27d6c/LICENSE)。使用作者繁中翻譯，選定完整「通知」分頁；這不是首次開啟的 Redmine 分頁。先選專案和變更類型，再設時段與合併；起訖相同於保存時不被接受。截到通知保存與全域重設，不含其他分頁。沒有帳戶、密鑰、專案或遠端連線。

兩案固定成已啟用、22:00 至次日 08:00，以便比較；兩案原預設均未啟用。A 是定時報音，B 是議題通知，不能視為相同服務。[育伴港本人通知偏好](https://github.com/2NTTY/child-ai-caregiver/blob/39f2f32287e032501c7b0c2663db57972e7fce9b/frontend/src/production/SettingsDomains.tsx) 還包括通知時區、預約例外與保存前核對；該頁不等同綁定渠道或授權發送。

## 私人整頁擷取指紋（SHA-256）

- A-wide（1180 × 600）：`6c59215ef72ada06988686e47407668ca2059e8d859570b2b417e1f0e430a3e2`
- A-narrow（390 × 600）：`0e1b7a92317ecb083975068bec7d6175796b549834f1d644567bdabb6f14e51d`
- B-wide（1180 × 2120）：`d3088ecc334f1ff518dfde17e6c4c2d22ab2f67d075dbe415e59f86921a1883f`
- B-narrow（390 × 2390）：`ba999c8cf253010d777249a42959461410c14cfddbf68687d1a2f53b9a1b153a`

兩款均由固定來源的唯讀狀態離線擷取，不是作者提供的截圖。驗了桌面與 390px 窄窗、兩案／單案、原尺寸、來源及返回；可跳至長圖中的安靜時段，仍保留完整頁。B 桌面時刻並排、窄窗上下排列。兩份原 HTML 均無行動 viewport 宣告，這不是實機、已安裝擴充、通知送達或儲存驗收。沒有執行原程式、播放聲音、授權或發送。

本版共 16 個比較分組、25 個舊入口及 1 個歷史單案；未重驗每一個舊頁。私人單頁 SHA-256：`b1ef9c2e109bf19efa77e70ebda480a5a522f6f1054c5fb81d06000f30ec0e94`。本版私人增量 SHA-256：`cebb78ac41855e6bb028ad121e3bf01896d7e64322af86cec25e6596749d6f33`。完整歷史目錄仍需先前的私人基底與增量。
