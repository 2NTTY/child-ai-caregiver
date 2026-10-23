# Snapshot31 補充：Summary 自然focus回歸與本人短標籤

**本地限定驗收：63檔來源freeze、11 unique scripts／80 PASS、唯一export及31指定browser場景通過。完整TS門檻仍未通過，不是全站或正式服務全綠；本收據不代表PR／Sites已交付。** [30歷史報告](../snapshot30/README.md)的Summary紅與兩環境fullTS137保留，[29原包](../README.md)不改寫。

## 修補範圍（63檔／553 product inputs）

- Summary已載同scope讀取：日期／期間／時區／套用控制保留現有焦點，同時阻擋操作，日期改用Web readOnly策略；普通disabled與native分支不擴大例外。初讀、error、pending及失權繼續守門。
- 檔案overview只在同scope且來源／存取權限可靠的重驗保留已確認內容；不得用舊內容掩蓋失權／stale／失敗。此處對應30 tab／marker位移紅，不以單元DOM測試代替像素覆驗。
- 記憶private可見短名「只供本人」改「本人」，不改權限值或操作；定向斷言另核。
- 兩個既有測試harness需要同步實際抽取元件／依賴；原紅、修復及最終綠分層保存。額外舊memory-reference測試的loader／隔離缺layout失敗不計入必要通過總數，也不刪失敗。

## 計數及證據邊界

最後去重scripts／tests以builder最終receipt為準；不加29的159、30的144、作者或中間重播。31新照片只證31新操作；其他30場景按相關來源精確未變的收據列為歷史沿用，**不是31重跑**。共用UI已改，不能僅因某頁檔案未改就宣稱所有行為不受影響。

完整TS前版門檻未通過；若31未再跑則寫未再跑，不借export或preview綠抵銷。正式API、真模型、家庭資料、實體裝置與全站全分支不在本包驗收內。

## 已核的候選identity

最終 **63檔＝37產品＋25測試＋1設計文件，553 inputs**；相對30為5產品＋4test差異，其中重疊既有檔案，因此不是57＋9。Export heap384／single worker：exit0、133.295秒、RSS656436KiB，65raw／36HTML／72包裝檔，來源與inputs前後一致，靜態validator PASS。Bundle SHA256 `9ce151e4f0313d609b088e007e915d03f59e7ce9631dd83a10627a70ce851b4c`；公開fixture原hash461064…不變。

[來源63檔](receipts/source-scope63.json)／[30→31差異](receipts/delta-from30.json)／[export identity](receipts/export-identity.json)／[tests與原紅](receipts/checks.json)／[全部本次產品清單](all-changes.md)。31未再跑fullTS；不把30兩環境exit137說成31曾跑或host OOM已證。

[作者原紅與Paper／native修補歷程](receipts/author-focused-history.json)保留逐版結果；這些測試不再加進最終80。

## 31獨立瀏覽器覆驗

Summary1024×600自然focus保留未套一日／日期、原week報告、期間按鈕焦點與overview幾何；原30失焦／31.25px跳動在本次取樣未復現。Ready-state真Enter／Space／Escape通過；日期quiet-read真Tab移焦後，Paper樣式與readonly回復正常、不搶回焦點。日期這段是混合UI／harness預備，不冒稱第二次純AltTab。390記憶顯示「本人」與完整AX名稱通過；未重跑30分頁。

[31 browser與4張原圖](browser-evidence.md)／[精確focus及Paper觀察](receipts/browser-focus-observations.json)／[18-route版本分層矩陣](route-coverage.md)／[來源沿用核對](receipts/source-carry-forward.json)。30紅項仍留原報告；沒有把不同版本測試相加。
