# 選配工作台：搜尋範圍

66 題／135 款的獨立候選。第 66 題有兩張非官方重繪：A 參考 [Sourcegraph 最後公開的 Apache-2.0 快照之非企業功能](https://github.com/sourcegraph/sourcegraph-public-snapshot/blob/1cd36d2dbbd2a9ab638cc437d208d2717eaefb0b/client/web/src/search/results/StreamingSearchResults.tsx#L426-L452)，達到結果上限後，改用較高上限另跑一次，不是接續原搜尋；B 參考 [Grafana OSS v12.0.0 Explore（AGPL-3.0-only）](https://github.com/grafana/grafana/blob/4c0e7045f97f356716755b47183b22e7f12bb4bf/public/app/features/explore/Explore.tsx#L429-L465)，保留查詢式但改到較早時段，不是在同一時段加載更多結果。兩者都不表示搜尋結果已完整。兩張圖是互不相連的虛構示例，不是育伴港對話搜尋的實際畫面或規則。程式授權不是圖像授權。

獨立差異檢查確認原有 65 題、133 張圖、來源及互動不變。第 66 題的來源、圖像放大、焦點、關閉及直達捷徑通過本機模擬 DOM 檢查，內容安全政策未放寬。候選 HTML 為 506,379 位元組，SHA-256 為 `af2ce3f9e27d4a31d5a26bb3e268fa73a2550811cb8ed576d9275940d93e3165`。基準 HTML SHA-256 為 `0e8cad0f7ef22fba35fba331e8e0a775f6d62ba44609daa80314b9b1f9bbfb27`；候選清單 SHA-256 為 `e6466090df9dfd83de6d4225ae2c81594e195320f8d82d9bb84a160b7b9ef99d`。

這份備份只含中繼資料、組裝和檢查工具，不含圖片、私人原件、憑證或私人取件資料。完整還原另用留存副本，把 `out/index.html` 和 `out/visuals/` 一起放在原有的尾斜線路徑。此備份不是部署，不改動產品網站。
