# 第 71 題｜接收班級交接：這筆資料要放在哪位學生名下？

假設海星班老師收到一個含小澄和小禾兩筆普通資料的交接包。老師已確認小澄是哪位班員；小禾卻與名冊上的一位學生同名。**同名不是身分證明，搜尋一頁沒見到也不是沒有這位班員。** 這次要決定的是每一筆資料的接收對象，不是選 Excel 欄位、判斷重複記錄，或合併兩個孩子的檔案。下文的人名、班名和情節均為虛構。

| 老師現在想知道甚麼？ | 比較哪種設計？ |
| --- | --- |
| 整批還有哪一位沒有去向？ | A 把來源和目標並排，一次看清已配和待查的列；兩列名字相同也要能回去再查。 |
| 這個同名的學生真是我要找的人嗎？ | B 先看眼前是哪一筆，再找已存在的班員；沒有足夠依據就不選。 |
| 今天只接收已核實的小澄，可以嗎？ | 本例只含普通資料。取消選取未核實的小禾，核對仍選取的小澄及資料類別，再決定是否開始。不能保留小禾為已選卻未配對而略過檢查。 |

## 兩個作者的工作畫面

**交接配對-01｜CodeTwo：先看整批，每一列放到哪裏。** 打開 Match mailboxes 工作視窗，沿每一列從來源郵箱讀到目的端郵箱，再縱向掃一次，核對各列去向。要找的不是「姓名欄應放到哪個欄位」，而是兩邊的哪兩筆記錄屬於同一組。手冊另外說明可以手動指定既有目標或解除配對；儲存的是去向設定，真正遷移是之後的另一步。放到海星班，這種排法易見哪位已配好、哪位要留待核實；但表上兩個名字一樣，仍不能證明是同一個孩子。不借用郵箱的自動配對或新建帳戶。 [看 CodeTwo 原圖：來源與目標郵箱的完整配對視窗（需連網）](https://www.codetwo.com/admins-blog/wp-content/uploads/2023/10/tenant-to-tenant-migration-matchin-mailboxes-window.png)。[CodeTwo 作者教學：第 6 步配對郵箱，啟動遷移是後續步驟](https://www.codetwo.com/admins-blog/how-to-migrate-mailboxes-between-office-365-tenants/)；[CodeTwo 配對手冊：手動指向既有目標、解除配對及儲存](https://www.codetwo.com/userguide/office-365-migration/mailbox-matching.htm)。

CodeTwo Office 365 Migration，Windows 桌面程式。作者教學更新於 2025-03-04；未註明截圖日期、軟件 build 或 Windows 小版本。網址中的年月不是拍攝日期。 CodeTwo 官方教學原圖。未見可在其他工作台重發截圖的許可；只連作者頁與原圖，不嵌入、複製或改畫。

**交接配對-02｜BigSeller：先認清一筆，再找既有對象。** 先開第一張：在 SKU Mapping 清單中，從一筆尚未配對的商店商品進入。再開第二張：找的是倉庫內已存在的 Merchant SKU（商品編號），搜尋後才指定對象。第一張交代「從哪筆來」，第二張才回答「放到哪筆」；不是匯入檔案、合併兩項商品或新建商品。借到海星班的是逐位查找的次序，不是把商品編號換成孩子的學號。這種排法方便先釐清小禾的身分，卻不如 A 容易一眼看見整批還缺誰；線索不足便先不配對。 [看 BigSeller 第一張原圖：未配對清單與單筆入口（需連網）](https://bigseller-1251220924.cos.accelerate.myqcloud.com/static/faq/2024/1732267874228091.jpg)。[BigSeller 第二張原圖：搜尋並選擇既有 Merchant SKU](https://bigseller-1251220924.cos.accelerate.myqcloud.com/static/faq/2024/1732267887912770.jpg)；[BigSeller 作者教學：只看 Method 1 的手動配對兩步](https://help.bigseller.com/en_US/detailPage/how-to-map-merchant-sku-on-sku-mapping-page.4570)；[BigSeller 使用條款](https://www.bigseller.com/en_US/terms.htm)。

BigSeller 英文 Help Center，桌面網頁管理介面的 Method 1: Manually Mapping。作者頁更新於 2025-07-17 11:00，時區未註明；截圖日期、產品 build 和瀏覽器版本未列。 BigSeller 官方文件所連的作者原圖。未見截圖轉載許可；僅提供原文與圖檔連結及自撰說明，不嵌入、拼接或重畫。

## 在育伴港，配對和「開始匯入」是兩件事

根據[倉庫修訂 5937854（合併 #682）](https://github.com/2NTTY/child-ai-caregiver/commit/593785493e5786eea72029f40d6ba7cdb23f75e2)的程式及合成測試內容。這是既有接收表單中的工作，不是另設的比對中心，亦不是實際部署驗收。

1. **先查接收班級和權限。** [表單的逐人指派說明及班級選擇](https://github.com/2NTTY/child-ai-caregiver/blob/593785493e5786eea72029f40d6ba7cdb23f75e2/frontend/src/components/account/HandoverImportControls.tsx#L539-L553)把哪些資料進哪個班交由有寫入權的教師決定。能查看名冊，不代表能將資料寫入該班。
2. **在同一個接收班級內查找。** 小澄已明確選好，老師可[換搜尋條件或繼續載入名冊](https://github.com/2NTTY/child-ai-caregiver/blob/593785493e5786eea72029f40d6ba7cdb23f75e2/frontend/src/components/account/HandoverImportControls.tsx#L555-L564)找小禾；不要把這個名冊的下一頁當成交接包的下一頁。[仍在相同有效範圍的既有選擇可以保留](https://github.com/2NTTY/child-ai-caregiver/blob/593785493e5786eea72029f40d6ba7cdb23f75e2/frontend/src/production/handover-class-targets.ts#L45-L54)。若換了班，或原本的授權已失效，就不能沿用先前配對。[合成測試記錄了同名不預填及分頁搜尋](https://github.com/2NTTY/child-ai-caregiver/blob/593785493e5786eea72029f40d6ba7cdb23f75e2/frontend/scripts/handover-class-import.test.cjs#L169-L188)和[授權或班級範圍改變](https://github.com/2NTTY/child-ai-caregiver/blob/593785493e5786eea72029f40d6ba7cdb23f75e2/frontend/scripts/handover-class-import.test.cjs#L189-L206)的例子。
3. **不確定，就保留未配對或取消選取。** [勾一筆來源並不預填目標，亦可取消該筆](https://github.com/2NTTY/child-ai-caregiver/blob/593785493e5786eea72029f40d6ba7cdb23f75e2/frontend/src/components/account/HandoverImportControls.tsx#L257-L280)。[每筆仍選取的來源都要有有效去向](https://github.com/2NTTY/child-ai-caregiver/blob/593785493e5786eea72029f40d6ba7cdb23f75e2/frontend/src/components/account/HandoverImportControls.tsx#L215-L230)，還要核對[選取的資料類別及開始界線](https://github.com/2NTTY/child-ai-caregiver/blob/593785493e5786eea72029f40d6ba7cdb23f75e2/frontend/src/components/account/HandoverImportControls.tsx#L608-L620)。[另行建立學生有獨立條件](https://github.com/2NTTY/child-ai-caregiver/blob/593785493e5786eea72029f40d6ba7cdb23f75e2/docs/API.md#L1376-L1378)，不是找不到的預設結果。這裏不假設有學號、照片、相似度評分、推薦班員或自動按姓名配對。

第 12 題查看已有名冊，第 43 題問要保留哪些匯入資料，第 65 題處理整班管理權，第 70 題看批次開始後的結果。即使檔案與欄位全對，老師在開始前仍須回答這一題：**這筆究竟要放在誰名下？**

## 離線版本與驗證範圍

- 私用離線 HTML：`育伴港選配工作台-71主題-班級交接逐人配對外鏈版-20261119.html`，30,962,232 bytes，SHA-256 `e6ab09edb986327436ef0ca95e0ec795005df39cc738772303e00d990adf4810`。基準為已交付的第 70 題版（30,957,796 bytes，SHA-256 `4898c19539109f5895bd0b792001ec0fd4d44e8b860bb563fe1331fcdc43c2b5`），其私用文字備份收件修訂為 `3a9db4b7f9e2cf2d89ea16f3a9d9bd2314132446`。
- 共 71 題、145 款：77 款離線、68 款外鏈。移除新增記錄後，原資料區逐位元組還原為第 70 題版。原有 146 張內嵌圖按原序逐張解碼核對 SHA-256。新題兩個主連結和五個輔助連結都須主動點開；無新增、重畫或自動載入的圖片。
- 已核對離線結構、無 DNS 預取政策、內容安全策略及 JavaScript 語法；本機不連網的模擬閱讀器通過 81 組檢查，覆蓋全 71 題單看／並看及新題的作者連結、無預設選擇、選取、替換、摘要返回、撤選、焦點與最後一頁的界線。
- 以上是本機組裝驗證，不是遠端交付收據。未做瀏覽器或真機驗收、產品建置、實際登入或操作。沒有查閱或傳送真實家庭及學生資料、選取真實目標、匯入資料、或調用模型。此分支只備份來源及驗證文字，不含完整預覽檔或私用素材；沒有 PR、合併或公開發布。
