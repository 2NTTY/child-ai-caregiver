# 選配工作台：已儲存與重新覆核

65 題／133 款的獨立候選。第 65 題有兩張非官方重繪：A 參考 [MediaWiki FlaggedRevs（1.43 相容分支快照，GPL-2.0-or-later）](https://github.com/wikimedia/mediawiki-extensions-FlaggedRevs/blob/afe4e02273238909dc4d72bbec43ad002d1931de/includes/frontend/specialpages/reports/PendingChanges.php#L30-L73)，清單中的改動已儲存，仍待人工覆核，版本比較不會批准改動；B 參考 [Gerrit Code Review v3.13.0（Apache-2.0）](https://github.com/GerritCodeReview/gerrit/blob/b8869cf21dd43599c921d1c42454e4d93ebff050/Documentation/user-review-ui.txt#L9-L32)，在這次改動不沿用舊票的例子中，修訂一的 +1 留在歷史、不是最終批准，修訂二仍待覆核。兩圖都是虛構、獨立的介面示例，不是同一流程或育伴港的實際資料。程式授權不是圖像授權。

獨立差異檢查確認原有 64 題、131 張圖、來源、選擇結果與互動保留；第 65 題的來源、圖像放大、焦點及關閉邏輯通過本機模擬 DOM 檢查，內容安全政策未放寬。候選 HTML 為 498,453 位元組，SHA-256 為 `0e8cad0f7ef22fba35fba331e8e0a775f6d62ba44609daa80314b9b1f9bbfb27`。基準 HTML SHA-256 為 `8a705a91195b1c38eebdabb60dffa002b460ad989f653726c9dc11bf5080ac7e`；候選清單 SHA-256 為 `6a4d8697e9d6668df5c7823b365c0771e93ffce9837ea18dc92e2f803fe4f6a5`。

這份備份只含中繼資料、組裝和檢查工具，不含圖片、私人原件、憑證或私人取件資料。完整還原另用留存副本，把 `out/index.html` 和 `out/visuals/` 一起放在原有的尾斜線路徑。此備份不是部署，不改動產品網站。
