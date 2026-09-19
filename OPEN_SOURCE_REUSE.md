# 開源復用研究與原型建議

查核日期：2026-09-19｜用途：先完成導師可跟進的原型，日後再尋找比賽。

**建議先評估 Baby Buddy 作單家庭原型底座，保留日常記錄與 API，另外開發你們的主動補問、香港來源卡、受控交接及可追溯摘要。** 如果確定首版一定要原生手機 App，再改選小型 Expo 官方起點；兩條路擇一，避免維護兩套產品。

本次只查閱官方倉庫、文件與許可資料，沒有下載、安裝或運行候選程式。可復用性是初步工程判斷，並非安全審計、成功部署或醫療驗證。尚未量測 token 節省幅度。

## 1. 最接近產品的候選

| 候選 | 已核實的能力 | 許可 | 本項目採用建議 |
|---|---|---|---|
| [Baby Buddy](https://github.com/babybuddy/babybuddy) | Python／Django 育兒事件記錄；繁體中文、手機畫面、REST API | [BSD-2-Clause](https://github.com/babybuddy/babybuddy/blob/master/LICENSE) | 第一個啟動驗證對象：單一合成家庭底座 |
| [Baby Buddy MCP](https://github.com/babybuddy/babybuddy-mcp) | 用工具連接 AI，新增／查詢／修改記錄；Python／FastMCP | 倉庫標示 BSD-2-Clause；本次未成功取得獨立 LICENSE 正文，复制前需完成該項核查 | 先參考工具封裝，未核對及限制權限前不直接接真實資料 |
| [BabyTracker](https://github.com/mbentancour/babytracker) | Go＋React＋PostgreSQL；手機響應式介面、時間軸、CSV、API／webhook、每兒童及每功能權限 | [MIT](https://github.com/mbentancour/babytracker/blob/main/LICENSE) | 備選底座；若偏好 React 介面可作比較，但先驗證維護與實際權限 |
| [UNICEF Bebbo](https://github.com/UNICEFECAR/parenting-app-bebbo-mobile) | React Native＋TypeScript；育兒內容、發展／成長／接種／檢查流程、CMS 整合 | [GPL-3.0](https://github.com/UNICEFECAR/parenting-app-bebbo-mobile/blob/main/LICENSE) | 主要參考資訊架構；原生、CMS 與內容配置較重，暫不整套搬入 |

Baby Buddy 發布頁目前可確認 [v2.10.1](https://github.com/babybuddy/babybuddy/releases/tag/v2.10.1)；啟動評估時可從固定發布版本開始，另記實際 commit。不要把浮動分支當不可改變的依據。其他候選實際採用時亦須記錄固定版本和當時許可，不能只保存首頁連結。

## 2. Baby Buddy 為甚麼最值得先試

它已有你們需用的兒童、餵哺、睡眠、尿片和筆記等記錄接口及 OpenAPI 結構，可減少重建表單和資料讀寫的工作。來源：[官方 API 文件](https://docs.baby-buddy.net/api/)。

但有兩個會改變實作決定的限制：

1. **多人帳戶不是多家庭隔離。**官方用戶文件寫明只讀用戶可讀全部資料，標準用戶可新增與修改各類記錄。因此先用單一合成家庭演示；若往多家庭服務發展，要獨立設計家庭隔離與權限，不能只開放註冊。來源：[Managing Users](https://docs.baby-buddy.net/user-guide/managing-users/)。
2. **AI 記錄已有實現。**其 MCP 提供多種讀寫工具，部分可修改或刪除記錄。接上一個模型不能作為你們的獨有成果，也不代表所有工具都應交給模型。先只開必要的讀取與「待確認記錄草稿」，獲確認後由應用程式寫入。來源：[MCP 官方說明](https://docs.baby-buddy.net/mcp/)、[MCP 倉庫工具列表](https://github.com/babybuddy/babybuddy-mcp#available-tools)。

如果不用 MCP，亦可由你們的服務直接呼叫受限 API；MCP 不會自行提供定時排程、家長同意、醫療正確性或可靠通知。

## 3. 真正要新增的內容

| 沿用或参考 | 你們需要新增與驗證 |
|---|---|
| 登入、日常事件表單、圖表與 API | 粵語／文字輸入的确认卡；單位、約數和更正的保留 |
| 事件時間軸 | 交接時辨識與任務有關的缺項；先問一個關鍵問題 |
| 基本帳戶與資料讀寫 | 指定照顧者、可見內容、撤權、到期、去重和發送結果 |
| 原有匯出／報表 | 一頁到診摘要、原始事實索引、資料缺項、家長问题 |
| 翻譯結構與內容索引概念 | 香港官方來源卡、適用範圍、更新審閱及引文支持檢查 |

首頁可以改成「今天需要跟進甚麼」，以任務完成帶動記錄；不要僅換品牌、顏色和提示詞。這些新增功能是待實作計劃，不表示原項目必定完全沒有相關功能。

日後可以如實向導師或評委表述：

> 本項目在 Baby Buddy 的開源記錄功能基礎上，新增香港家庭的主動補問與交接流程，並驗證摘要追溯及權限控制。

只有完成後才使用「新增」「驗證」的過去式；採用前先寫「計劃新增」。

## 4. 其他候選的取捨

**BabyTracker** 的文件列有每兒童／每功能權限與整合 API，值得參考交接權限設計；但功能數目多、技術組合不同，不宜和 Baby Buddy 同時整合。若選它，需實際測試跨帳戶讀寫、撤銷 token、照片存取及匯出，不能把 README 的安全描述當驗證結果。來源：[倉庫](https://github.com/mbentancour/babytracker)、[API 文件](https://github.com/mbentancour/babytracker/blob/main/API.md)。

**Bebbo** 可參考照顧者導向內容分類及年齡流程。整套採用涉及 React Native 原生開發、CMS／國家內容及 Firebase 等配置；香港內容、接種和求助流程需要重新核對。程式許可不能一併當作所有圖片、品牌及育兒材料的再使用授權。來源：[官方倉庫與配置](https://github.com/UNICEFECAR/parenting-app-bebbo-mobile)。

本次亦看過 [MomNova](https://github.com/PriyankaBaskaran/MomNova-Smart-Parenting-Assistant-Prototype)：其 .NET／AWS 多服務架構與情緒分析導向，與本項目「最少依賴的家庭交接原型」不太匹配，故不列為首選。其醫療／心理相關能力及 README 統計不能直接沿用為已驗證的香港證據。

## 5. 如果確定要先做原生手機 App

可改用 [Expo 官方預設模板](https://github.com/expo/expo/tree/main/templates/expo-template-default)，需要登入時參考 [Supabase Expo 使用者管理示例](https://github.com/supabase/supabase/tree/master/examples/user-management/expo-user-management)。前者採 [MIT](https://github.com/expo/expo/blob/main/LICENSE)，後者所屬倉庫採 [Apache-2.0](https://github.com/supabase/supabase/blob/master/LICENSE)；採用時仍需檢查子目錄及依賴的個別聲明。

這條路起點较小，但育兒記錄、時間軸和業務流程需要自己建立，不能同時宣稱已沿用 Baby Buddy 的整套功能。

**重要的示例差異：**Supabase 的使用者管理示例包含公開個人資料／頭像的示範策略，不能把同一策略直接用於兒童健康記錄。需改為家庭成員範圍的存取檢查與私有檔案。來源：[示例 README](https://github.com/supabase/supabase/blob/master/examples/user-management/expo-user-management/README.md)。

普通排程函數已足夠檢查到期任務，只有確實需要理解文字或生成摘要時才呼叫模型。可參考 [Supabase 定時函數文件](https://supabase.com/docs/guides/functions/schedule-functions)。此方案不要求同時加入 n8n、Dify 和 LangGraph。

香港的模型服務開通、付款、網絡及資料處理地區要逐一核查；自行部署的源碼不等於附帶所有雲端服務資格。例如 [Supabase 地區列表](https://supabase.com/docs/guides/platform/regions)未列香港，不能因使用其雲服務就承諾資料留港。可先用合成模型回應建立流程。

## 6. 複製與參賽原創性的處理

- **BSD-2-Clause：**再發布源碼保留版權、條件及免責文字；發布二進位時在附帶資料重現相應聲明。來源：[Baby Buddy LICENSE](https://github.com/babybuddy/babybuddy/blob/master/LICENSE)。
- **MIT：**副本或實質部分保留版權及許可聲明。來源：[BabyTracker LICENSE](https://github.com/mbentancour/babytracker/blob/main/LICENSE)。
- **Apache-2.0：**按條款附許可、保留相關歸屬及 NOTICE、標示修改等。來源：[Supabase LICENSE](https://github.com/supabase/supabase/blob/master/LICENSE)。
- **GPL-3.0：**分發受其覆蓋的修改版涉及沿用 GPL、保留聲明及按條款提供相應源碼等義務；私人運行不等於須向全世界公開。來源：[Bebbo LICENSE](https://github.com/UNICEFECAR/parenting-app-bebbo-mobile/blob/main/LICENSE)。

許可允許復用與比賽是否接受衍生作品是兩回事；目前沒有比賽規則，不能保證日後任何比賽都適用。品牌、圖片、文件內容及各依賴亦需另行核查。避免把「GitHub 公開可見」當作允許任意複製。

採用時保留上游 LICENSE，另建立 THIRD_PARTY_NOTICES 與修改清單，逐項寫清：

| 倉庫與固定版本／commit | 許可核對 | 沿用模組 | 修改模組 | 自行新增 | 執行與測試證據 |
|---|---|---|---|---|---|
| [採用後填寫] | [檔案及日期] | [待填] | [待填] | [待填] | [待填] |

目前尚未採用代碼，因此此表不填成已完成。

## 7. 如何減少 AI 開發消耗

1. **先跑小範圍驗證。**只驗證底座能啟動、手機可操作、能新增及更正一筆合成記錄、接口可查詢。不能跑通就先記原因，避免立刻大改整個專案。
2. **選一個底座。**不要讓 AI 同時維護 Django、Go、React Native 和多個 Agent 平台。
3. **固定一頁範圍及技術地圖。**保存版本、資料模型、重要模組位置和未完成事項，每次只讀與當前任務相關的內容。
4. **一次完成一條任務。**例如只做「輸入模糊單位→補問→確認→入檔」，完成後留下運行結果，再接下一條。
5. **修改現有功能時保留架構。**直接定位表單、API 或報表模組，避免反覆生成整個專案或重寫已正常工作的部分。
6. **運行時不用模型輪詢。**排程查詢、去重、權限與數字統計由程式處理；模型只讀必要的增量資料，沒有新資料就沿用已核對摘要。
7. **把週報當作工作索引。**記錄實際改了甚麼、怎樣驗證、下一步是甚麼，減少下次重讀完整對話。

以上旨在減少重複工作，不預先保證節省某個百分比的 token。模板越大不一定越省，還要比較理解、修復依賴和修改的成本。

## 8. 建議第一個可驗收里程碑

先做一個可在手機瀏覽器使用的單家庭合成資料原型：

1. 沿用底座完成文字事件輸入與更正。
2. 新增一張模糊欄位確認卡。
3. 用手動推進的演示時間觸發一次交接補問，清楚標示模擬。
4. 生成包含原始記錄 ID 和缺項的一頁摘要。
5. 向導師展示沿用與新增的部分，取得範圍回饋。

第一輪之後再加粵語、兩個測試帳戶和真實推送。照片 OCR、社交帳戶與原生打包不阻擋第一個完整流程。
