# 選配工作台：班級移出教師空間：指定成員接手前，甚麼還沒改？

第 77 題新增兩張獨立重繪的完整頁示意，累計 77 題／157 款。
- A 依 [Gitea v1.24.6](https://github.com/go-gitea/gitea/blob/08c6ea6728ee35a16f9a39588e725044b7f389cd/templates/repo/settings/options.tmpl#L816-L838)（相關程式 MIT），從發起人視角顯示現任擁有人和等待指定成員接受。
- B 依 [Nextcloud Server 31.0.12](https://github.com/nextcloud/server/blob/6b72bb307e91390c6efe4072b2829bbd1028651c/apps/files/lib/Notification/Notifier.php#L73-L124)（配合相容的 Notifications 4.0.0，從收件人視角顯示原有資料及接受前的選項。兩個固定版本及逐檔授權見清單。

兩張都是非官方靜態示意，使用虛構資料。[育伴港現有畫面](https://github.com/2NTTY/child-ai-caregiver/blob/077d05722522fd3c393824ac308c063e8fa88cc6/frontend/src/screens/familyScreen.tsx#L200-L224) 在指定成員接受前保持班級附屬原教師空間；發起人自己接手則是另一流程。這些上游的取消、拒絕或通知不是產品承諾。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `38f98b62e296c1fb682f5911f4a800ac6ab64a1db896093923ddf21265e2ab39`。
候選 HTML 571148 位元組，SHA-256 `75e8cd1c85b863d1c3a9840215259aedd75861aa91a123adfcc5e43527fe7f57`。
原有 76 題、155 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 77 題並排顯示兩個來源；A 和 B 可分別放大，A 按 Escape、B 點暗處後均關閉並回復原按鈕焦點。展開 B 可核對伺服器及相容通知程式的各自固定版本。

四個純文字檔：本說明、`candidate-157/build.py`、`candidate-157/manifest.json`、`check-candidate157.cjs`。
完整還原包另行私人保存：160 個 ZIP 條目、159 筆 SHA-256 清單、158 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
