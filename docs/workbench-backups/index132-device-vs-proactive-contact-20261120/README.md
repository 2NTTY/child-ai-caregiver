# 選配工作台第 114 頁：只關這部手機的聊天通知，還是讓助手不再主動聯絡？

- **A｜同頁看清這部手機和這位孩子。** [Aionda Mail 官方 Android 原圖](https://mail.aionda.com/docs/handbook/en/images/native-android-push.png?v=6d141ea55111e784)把帳戶偏好、手機系統權限和實際投遞分開；不等於育伴港的孩子設定。
- **B｜先選目的，再看哪裏會變。** [Apple Driving Focus 原圖](https://cdsassets.apple.com/live/7WUAS350/images/ios/ios-26-iphone-17-pro-settings-focus-driving-setup.png)先說影響才進設定；[實際通知設定](https://cdsassets.apple.com/live/7WUAS350/images/ios/ios-26-iphone-17-pro-settings-focus-allowed-notifications.png)明示靜音範圍。只借用引導方式；不套用 iOS 設定或同步規則，選卡不會保存。

育伴港[裝置設定](https://github.com/2NTTY/child-ai-caregiver/blob/400b159d221e8d30875494806dd24eb81eada73a/frontend/src/production/useProductionPushSettings.native.ts#L119-L142)只改已綁定的這部 Android，聊天推播關閉時也關預覽，重開預設同開預覽。其他裝置、班級通知及系統權限不改。[主動助手](https://github.com/2NTTY/child-ai-caregiver/blob/400b159d221e8d30875494806dd24eb81eada73a/server/firestore-proactive-wakes.ts#L27-L35)按本人和目前孩子設定，不阻止自己發問或刪除原待辦。[派送](https://github.com/2NTTY/child-ai-caregiver/blob/400b159d221e8d30875494806dd24eb81eada73a/server/firestore-chat-notification-policy.ts#L38-L65)另外核對資格；不承諾收回已送出或在途推播。兩款是只讀比較，未改真設定，未驗收實際推播。原作者、精確圖址和版本界線見 `spec114.json`，原圖只外連。

## 重建與檢查

- 保留前 113 頁和既有選項。共 114 題、231 款，其中 135 款只外連，165 張既有離線圖不變。
- 用已驗證的 #113 HTML（SHA-256 `10d7b4f77053c046bcf890adc189dd7709ec3785766e22537e9c77560a9178be`）執行 `python append114.py baseline113.html spec114.json output114.html`。
- HTML 34,334,975 bytes，SHA-256 `decdd379b84934f9b56586a8519e470e64d2a01e281512de7e91b740106c072f`；單檔 ZIP 22,758,398 bytes，SHA-256 `bff4c8cbbcc79841b739d0c913613caeb31b859c15af2d4571fca798fc6b8f8b`。
- 專項離線檢查涵蓋既有記錄保留、兩案來源、主題搜尋、比較及選擇摘要。獨立分支只備份重建文本，不更新網站、主分支或四方案。
