# 選配工作台：待辦月曆：點一天，再回到原來範圍

第 107 題新增兩張獨立重繪的完整頁示意，累計 107 題／217 款。
- A 依 [Fossify Calendar 1.12.2](https://github.com/FossifyOrg/Calendar/blob/0a936ec8c43b669ffb0a8c29b0d08347066a75ae/app/src/main/res/layout/fragment_month_day.xml#L6-L69)（相關程式 GPLv3），手機上方選日期，下方讀當日清單。Fossify 也可列出跨日事件。
- B 依 [Thunderbird 159.0](https://github.com/thunderbird/thunderbird-desktop/blob/f88f34886f667703f55095f2ede6f31b15b42116/mail/base/content/messenger.xhtml#L554-L597)（相關程式 MPL-2.0），桌面保留主月曆，右側小月曆選非今天的日期後只列出該日議程。

兩張都是非官方靜態示意。[育伴港的待辦月曆](https://github.com/2NTTY/child-ai-caregiver/blob/a2e176dbee2eac62b18eb3eed65060bcd3666705/frontend/src/components/tasks/TasksView.tsx#L146-L164) 點選一天會只看當天，但保留搜尋文字；再點同一天或按「取消日期」，就回到原有範圍。月曆圓點只反映已載入的事項，沒有圓點不等於沒有安排。沒有改動待辦或新增事件。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `0c81e6ea633b833c56e3d61c6b0f19284e307df9b2e1a4c526a2ad29b13683fd`。
候選 HTML 737731 位元組，SHA-256 `29271e0ba20a73aeadb4bf8bd4b34c6cc557f79449290cc72582ba8f357b391d`。
原有 106 題、215 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 107 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，沒有修改待辦、建立事件或傳送提醒。

四個純文字檔：本說明、`candidate-217/build.py`、`candidate-217/manifest.json`、`check-candidate217.cjs`。
完整還原包另行私人保存：220 個 ZIP 條目、219 筆 SHA-256 清單、218 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
