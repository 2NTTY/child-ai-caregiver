# 選配工作台：未送出草稿：先看到官方求助入口

第 110 題新增兩張獨立重繪的完整頁示意，累計 110 題／223 款。
- A 依 [Discourse v2026.10.0](https://github.com/discourse/discourse/blob/05445c3bf999c5502ccbe1e13539a15e88d9c9a9/frontend/discourse/app/templates/application.gjs#L111-L153)（相關程式 GPLv2-or-later），在完整論壇版面及未發出的草稿旁顯示相關主題。上游會向論壇查詢；育伴港的固定入口不同。
- B 依 [Thunderbird 159.0](https://github.com/thunderbird/thunderbird-desktop/blob/f88f34886f667703f55095f2ede6f31b15b42116/mail/components/compose/content/messengercompose.xhtml#L2442-L2457)（相關程式 MPL-2.0），完整寫信視窗在草稿下方顯示附件提示；未寄信或加入檔案。

兩張都是非官方靜態示意。[育伴港的助手畫面](https://github.com/2NTTY/child-ai-caregiver/blob/a2e176dbee2eac62b18eb3eed65060bcd3666705/frontend/src/screens/chatScreen.tsx#L173-L197) 可在尚未送出的草稿符合本機條件時，獨立顯示香港官方求助入口。草稿仍可編輯。提示不會送出訊息、啟動模型或自動聯絡服務，也不是醫療判斷或辨識保證。示意不包含症狀、電話或真實資料。程式授權並非官方圖像授權。

凍結基準 HTML SHA-256 `ae8a2d051ae0449c79cd43ec9ed0f900909f8f49291d912664ecabebc7ba0ed1`。
候選 HTML 754908 位元組，SHA-256 `3234c8314d8ea9919b0d839fab2adf9825100fa5c70d9fe5bd7b20df9ea01921`。
原有 109 題、221 張圖片位元組完整保留。兩張新圖、固定來源、離線 A/B、焦點回復及選配摘要已核。
Chrome：第 110 題可直達、核對兩個固定來源；兩圖皆可放大，按 Escape／點暗處關閉後各自回復原圖按鈕焦點。只驗收工作台，未送訊息、呼叫模型或聯絡服務。

四個純文字檔：本說明、`candidate-223/build.py`、`candidate-223/manifest.json`、`check-candidate223.cjs`。
完整還原包另行私人保存：226 個 ZIP 條目、225 筆 SHA-256 清單、224 個工作台檔案。此分支沒有圖片、原件、憑證或私人取件資料，不部署、不合併 master。
