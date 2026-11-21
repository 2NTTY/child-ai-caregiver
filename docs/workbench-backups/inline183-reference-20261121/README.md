# 選配工作台：概況的完整回顧：查一日或連續七日的已確認記錄

第 90 題新增兩張獨立重繪的完整頁示意，累計 90 題／183 款。
- A 依 [TimeTagger v26.1.3](https://github.com/almarklein/timetagger/blob/681720d84c94be660f30947db4b23e52d36cbe32/timetagger/app/front.py#L248-L259)（相關程式 GPL v3），在既有工作畫面上開啟聚焦的詳細表格，查看對應的時段和記錄。
- B 依 [Home Assistant Frontend 20261028.5](https://github.com/home-assistant/frontend/blob/e32bc0696ebefde323f5b791269ad0c57f3f99d9/src/panels/energy/ha-panel-energy.ts#L154-L168)（相關程式 Apache-2.0），由同一期間控制多張概況卡，不必逐張設定日期。

兩張都是非官方靜態示意，使用虛構展板資料。[育伴港的完整回顧](https://github.com/2NTTY/child-ai-caregiver/blob/7fa1d973eef5b613af5ecdb766195dabe4c5c498/frontend/src/production/TaskKnowledgeSummaryContent.tsx#L42-L55) 要先選開始日，套用一日或連續七日。結果只涵蓋期間內可核對的已確認記錄，缺資料不等於沒有發生。上游的任意區間、曆週和報告匯出不是產品承諾。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `0d66bb9f45ae9c2e1056945e2b58932b4f1dbd4a753637b7844a2a8411570a60`。
候選 HTML 649101 位元組，SHA-256 `765dd2fe0ba5fbf9837717d85fde16787c65eedf4ee5cdd780ae14d4f70a060f`。
原有 89 題、181 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 90 題並排顯示兩個來源；兩圖可分別放大並以 Escape／暗處關閉、回復原按鈕焦點。只驗收工作台，未擷取或操作真實記錄。

四個純文字檔：本說明、`candidate-183/build.py`、`candidate-183/manifest.json`、`check-candidate183.cjs`。
完整還原包另行私人保存：186 個 ZIP 條目、185 筆 SHA-256 清單、184 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
