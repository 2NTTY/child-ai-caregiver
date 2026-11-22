# 選配工作台：概況：從生活片段查回原記錄

第 108 題新增兩張獨立重繪的完整頁示意，累計 108 題／219 款。
- A 依 [Gitea v1.25.4](https://github.com/go-gitea/gitea/blob/369830bada2fd8826a5135cb2fc66660a9bef708/templates/repo/home.tmpl#L1-L31)（相關程式 MIT），桌面概覽在列表前顯示最近一筆的短摘要及原始條目連結。Gitea 鎖定的是提交版本。
- B 依 [Mastodon Android v2.13.7](https://github.com/mastodon/mastodon-android/blob/9ae49ec403719a8894903e011a9ad71c91c71c0d/mastodon/build.gradle#L10-L17)（相關程式 GPLv3），手機概覽垂直排列短文，點選可開啟指定條目。這不是育伴港的社交功能。

兩張都是非官方靜態示意。[育伴港的最近生活片段](https://github.com/2NTTY/child-ai-caregiver/blob/a2e176dbee2eac62b18eb3eed65060bcd3666705/frontend/src/components/child-overview/ChildOverviewRecentRecords.tsx#L9-L30) 最多列出同一孩子三筆符合條件的已確認片段。「查看原記錄」按該筆識別碼尋找目前可讀的版本，不是摘要當時的固定版本，也不代表完整日誌。沒有查閱或改動真實資料。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `29271e0ba20a73aeadb4bf8bd4b34c6cc557f79449290cc72582ba8f357b391d`。
候選 HTML 743378 位元組，SHA-256 `c20e10e5484fcb396703e6cf88896be598e75793c83a77e2d3c90c57e39923a6`。
原有 107 題、217 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 108 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，沒有開啟或改動真實記錄。

四個純文字檔：本說明、`candidate-219/build.py`、`candidate-219/manifest.json`、`check-candidate219.cjs`。
完整還原包另行私人保存：222 個 ZIP 條目、221 筆 SHA-256 清單、220 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
