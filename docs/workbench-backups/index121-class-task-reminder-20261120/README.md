# 育伴港選配工作台｜第 103 題：老師點開到期提示：先看原待辦，還是先看班級？

[育伴港現有程式](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/frontend/src/production/ProductionProvider.tsx#L74-L88)在重核裝置與班級權限後，會選到正確孩子並開原待辦。下面只比較登入後的落點；核對不過不展示舊資料。沒有發真通知或改功能。

- **103A 直接看那一筆**：[Deck Android 作者的完整單卡原圖](https://github.com/stefan-niedermann/nextcloud-deck/blob/d936723f36b5695385867260311b5e3d910b0edb/fastlane/metadata/android/en-US/images/phoneScreenshots/5.png)，1152 × 2465，Git blob `100e6e2b4952e5167c9acc651ff4ad7e4a118ce1`。[作者 FAQ](https://github.com/stefan-niedermann/nextcloud-deck/blob/d936723f36b5695385867260311b5e3d910b0edb/FAQ.md#L112-L122)證實點到期推播直入原卡；原圖只示例單卡，不是該次推播實錄。Nextcloud Deck for Android 貢獻者，[GPL 3+ 原版條款](https://github.com/stefan-niedermann/nextcloud-deck/blob/d936723f36b5695385867260311b5e3d910b0edb/LICENSE)。
- **103B 先進原班級並標出那一筆**：[Element X iOS 完整合成房間原圖](https://github.com/element-hq/element-x-ios/blob/093ece2ab0ee8094bb7afc88817c102a766097e6/UITests/Sources/__Snapshots__/Application/roomScreen.testTimelineLayoutHighlightExisting-iPhone-en-GB.png)，1206 × 2622，[實體原檔](https://media.githubusercontent.com/media/element-hq/element-x-ios/093ece2ab0ee8094bb7afc88817c102a766097e6/UITests/Sources/__Snapshots__/Application/roomScreen.testTimelineLayoutHighlightExisting-iPhone-en-GB.png)以 Git LFS SHA-256 `d4000b1a36efd36a02fc875d9279d9fc4882c4e0519f07d8f9aa360bc6855ac9` 核對，不用指標檔的 Git blob 冒充圖。圖中綠線定位第 5 則，保留群組和鄰近訊息；[原產品通知聚焦選項預設關閉](https://github.com/element-hq/element-x-ios/blob/093ece2ab0ee8094bb7afc88817c102a766097e6/ElementX/Sources/Application/Settings/AppSettings.swift#L377-L378)，圖不是實機推播紀錄，也不是育伴港已完成行為。© 2025–2026 Element Creations Ltd.、© 2022–2025 New Vector Ltd.，[AGPL 第 3 版原版條款](https://github.com/element-hq/element-x-ios/blob/093ece2ab0ee8094bb7afc88817c102a766097e6/LICENSE)。[上游原創測試素材與授權說明](https://github.com/element-hq/element-x-ios/pull/3783)。

103 題、209 款（115 款只外連）、163 張離線原圖。保留前 102 題和程式；新題跳轉／搜尋／左右對比／選擇／來源複製經離線驗證。由 #102 的獨立還原本重建；調整授權標示後重驗新題及舊搜尋，再逐 byte 核對。未驗部署／真機／真通知、未建立 PR、合併或發布。

完整 HTML 33,875,128 bytes，SHA-256 `f3e05ebce3db09bc796d0388d2f4bb435bc779d335945a740ca57319c6247850`。為保留未縮減的原圖和所有舊題，私存單檔 ZIP（僅含 `育伴港選配工作台-103主題-20261120.html`），22,484,212 bytes，SHA-256 `65477fd5c95b3c131b55caa9ea63078eba6adb1b3a580844e3618be900198390`；本機驗證解出 HTML 與原檔逐 byte 相同。公開倉庫分支只放可重建增量，不放原圖或整包。

重建需要 Python 3 + Pillow、[第 102 題完整 HTML](https://github.com/2NTTY/child-ai-caregiver/blob/d2406a82ce33c79bad3760397edde929bd25c28c/docs/workbench-backups/index120-reference-scope-20261120/README.md)，以及將上述兩張圖與條款按 `spec103.json` 的檔名放到同資料夾：

```sh
python append103.py baseline102.html spec103.json 育伴港選配工作台-103主題-20261120.html
```

`zip-proof.py` 可核對私存 ZIP 的唯一檔名、大小與內容指紋，或還原到新的檔案，不覆寫現有檔。
