# 工作台第 20 版：班級名冊的兩種安排

**GitHub 只保留自寫的文字索引，不能單獨還原完整預覽。** 本次差異只有這一份文件，不包含照片、卡通、名單、原始碼、圖片、執行檔、預覽 HTML、私人備份或其存取資訊。第五張圖是 B 的補充視窗，不是第三種設計。

## 兩個頁面與資料來源

- **A／Roster Caller：搜尋姓名，逐列看狀態。** Tarek N. Aziz 的 [Roster 頁與列模板](https://github.com/TNAziz/RosterCaller/blob/df169868a6e8f3db1e72316c921e82fbabaa312b/index.html#L694-L734)，`TNAziz/RosterCaller@df169868a6e8f3db1e72316c921e82fbabaa312b`。這是首頁裡的 Roster 分頁，固定在 20 人示例班；[作者的樣本生成器](https://github.com/TNAziz/RosterCaller/blob/df169868a6e8f3db1e72316c921e82fbabaa312b/docs/tools/make_sample_roster.py) 建立虛構名冊和繪製卡通，不是真實學生相片。出席標籤來自沒有缺席事件的示例，未查證任何人到場。
- **B／Rollcall：先選班，再管理班內成員。** Hindreen Abdullah 的 [RosterPage](https://github.com/hndfaw/app-2026-w32-rollcall/blob/08723ceecb0f5db1cd1ccbf2630e33c24cea1181/src/RosterPage.tsx) 與 [demo 資料](https://github.com/hndfaw/app-2026-w32-rollcall/blob/08723ceecb0f5db1cd1ccbf2630e33c24cea1181/src/core/demo.ts)，`hndfaw/app-2026-w32-rollcall@08723ceecb0f5db1cd1ccbf2630e33c24cea1181`。固定在載入示例後已選 Demo Class 的五人名冊；首次以空儲存開啟不是這個狀態。這五人是作者設定的示例參與者，未證實皆為兒童。
- **育伴港本身：** `/classes` 是班級管理，選班並不等同切換目前孩子；[固定版的名冊與待辦權限](https://github.com/2NTTY/child-ai-caregiver/blob/39f914dafc516d89904bfe99f38d112972480753/frontend/src/screens/familyScreen.tsx#L139-L188)。比較資訊安排不表示採用參考頁的出席、編輯或授權邏輯。

兩款原碼皆有 MIT 授權。私人端保留兩作者授權與精確來源；不把授權說明解讀為可無條件轉發素材或品牌。兩套來源皆固定成無可執行頁面：A 沿用原頁結構、CSS 與作者示例，B 按 JSX 分支及官方發布的 CSS 固定畫面。**擷取的是離線原碼靜態適配，不是作者原長圖或原應用操作驗收。**

## 五個私存畫面的 SHA-256（不含圖片）

| 視窗與狀態 | PNG 像素 | bytes | SHA-256 |
|---|---:|---:|---|
| A 桌面 | 1140 × 1600 | 428,212 | `f98f783618046aa73e656b142dc3106fe1ff45c276ff8653971186eab11c75e2` |
| A 窄窗 | 390 × 1616 | 388,435 | `95f2d6cb0511ef3a357729bb28b43e79de3323e9376f181251ab7406e8a09449` |
| B 桌面 | 1140 × 650 | 133,955 | `a1399745d254f1c3e40c59bf3038d9b49e37f5c76c03c7e1dc5c7a546bffcf58` |
| B 窄窗 | 390 × 880 | 114,412 | `70f724fc9f593b9c465c1b4ee5847875b222eff0612e767151ed018a41130588` |
| B 同版完整頂部導覽補圖 | 555 × 870 | 116,421 | `72057e48b6222f63a2fb7164df9cf6fe3e9da1c1276efd8174221773e51731e1` |

## 驗證及還原邊界

- 對 46 份來源證據驗 Git blob、長度與 SHA-256；另將 73 項私人來源封存逐項回讀。A 的 20 列、20 個卡通及末端提示／底部導覽皆完整；B 的 5 列及最後的新增按鈕可見。
- 在 B 原有 390px 窄框，頂部導覽向右佔約 517px，最右部分不在畫面內。保留原狀，以同一設計的 555px 附圖交代全貌；不能宣稱 390px 的頂導無橫向溢出。
- 此次新增第十二組比較。保留第 19 版十一組、25 個原入口及一個歷史單案的連結。比較器的並排、單看、桌面／窄窗、附圖、原尺寸、來源與授權、往返目錄都在 Chromium 實測；舊頁未逐一重驗，也未做真機、Safari 或原應用操作驗收。未執行上游腳本、接觸真實師生、點名、匯入、登入或改權限。
- 已從私人備份讀回比對：完整雙方案單頁 SHA-256 `feadcf413993fce15951c6226f81bbdaff5a4629c10a0fea7da2ad32cf3e8a47`；第 20 版增量包 SHA-256 `6d5d8e9d435d50f355a1fbafba1d1dcd301efa3046ee278d7a543df80123ce4c`。兩個值僅供驗檔；還原完整歷史工作台仍須原有基底及先前各版依賴。
