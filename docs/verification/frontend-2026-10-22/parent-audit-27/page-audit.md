# 育伴港逐頁家長視角審查

2026 年 10 月 22 日。以下「已看／操作」均指 Site85 基線；snapshot27／27a 及 Site86 的新增驗收另列，不能用基線照片證明修後效果。

**覆蓋是代表態，不是全功能通過。** 17 個家長 route 各看過 1024×600 與 390×600 CSS px；320×600 只抽查登入、待辦及說明。歷史八類、設定八區均曾進入，但不是每個子頁及狀態都有雙尺寸。

## 登入 `/login`

- **家長目的**：安全進入照顧空間，找回帳戶。
- **問題與影響**：登入及註冊代表畫面可讀；錯誤狀態沒有觸發，不能把 source 問題說已實屏重現。
- **優先級與原 ID**：IA-13 P2；家庭宣傳亦涉 IA-05 P2。
- **本批處理**：本批未修改。
- **基線已操作**：利用fixture已攔截、只改分頁狀態的合成登出抵達；切註冊再切登入；320捲至登入按鈕。沒有填寫或提交憑證。
- **基線未覆蓋**：驗證錯誤、寄信、真登入、真註冊與soft keyboard不在本輪。
- **源碼證據**：[`frontend/src/screens/loginScreen.tsx:59-64`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/loginScreen.tsx#L59-L64)；[`frontend/src/components/navigation/app-navigation.ts:50-53`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/navigation/app-navigation.ts#L50-L53)
- **畫面索引**：E103, E104, E105, E106, E107（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 首頁 `/`

- **家長目的**：先知道今天最重要的事，繼續未完工作。
- **問題與影響**：引導及助手不可用提示先於現有關注與待辦；相機只在部分捲動位置重疊。
- **優先級與原 ID**：V03 P2；V04 P3。
- **本批處理**：本批未修改；相機保持既定外形，正常捲動可完整閱讀，不列阻斷。
- **基線已操作**：正常捲動、從繼續使用引導到guide；未使用相機／麥克風。 17:23補核正常wheel捲動每段及到底再下捲，確認相機不永久遮擋。
- **基線未覆蓋**：未驗首頁所有健康提醒成功態、自選背景、右欄HomeFocus重複問題。
- **源碼證據**：本項為畫面觀察或正向保留，沒有另造源碼因果。
- **畫面索引**：E001, E002, E028, E029, E108, E109, E110, E111, E112（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 聊天 `/chat`

- **家長目的**：說出近況或問題，獲取可行幫助。
- **問題與影響**：對話、活動待確認與 Bell 分工已成立；不要改成管理卡牆。
- **優先級與原 ID**：本輪未新增主要問題。
- **本批處理**：本批未修改；保留對話閱讀與原活動入口。
- **基線已操作**：捲讀歷史、回最新、開活動待確認modal，Escape關閉且AX回焦原活動按鈕。沒有發訊息。
- **基線未覆蓋**：真模型、串流、送出、聲音、附件及全套keyboard不在本輪。
- **源碼證據**：本項為畫面觀察或正向保留，沒有另造源碼因果。
- **畫面索引**：E016, E017, E018, E019, E020, E021（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 待辦 `/tasks`

- **家長目的**：知道接下來做甚麼，完成或調整安排。
- **問題與影響**：待處理 1，但近期 7 天顯示 0；較早未處理入口較弱。安排記錄仍有技術管線文字。
- **優先級與原 ID**：V05 P2；IA-06 P3。
- **本批處理**：本批針對概況深連結接入既有 task owner 作測試；未修改較早待辦呈現或安排記錄文字。
- **基線已操作**：點較早未處理→開詳情→展開安排記錄→關閉回清單；320打開操作選單。沒有執行改期／完成／取消。
- **基線未覆蓋**：完成、取消、保存、所有任務狀態及概況深連結未驗。
- **源碼證據**：[`frontend/src/components/tasks/TaskDetail.tsx:20-48`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/tasks/TaskDetail.tsx#L20-L48)
- **畫面索引**：E034, E035, E036, E037, E030, E031, E032, E033, E099, E100（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 關注與準備 `/growth`

- **家長目的**：追蹤孩子近況，為就診或會面準備。
- **問題與影響**：有關注時缺近旁助手入口；準備單助手動作排在完整清單後。
- **優先級與原 ID**：IA-03／IA-04／V06 P2，同一主題。
- **本批處理**：27原主次RED已由27a重驗關閉；320／390／1024主次、完整手動名稱／表單／回焦通過。準備單原手動modal、來源及owner保留。
- **基線已操作**：切關注／準備tabs、打開手動關注表單並Escape離開、正常捲讀時間線；未填表或提交。
- **基線未覆蓋**：準備單本輪只有空態；長文件reader焦點回歸屬前一獨立gate，不能冒充本輪多文件已覆。
- **源碼證據**：[`frontend/src/components/growth/GrowthView.tsx:90-99`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/growth/GrowthView.tsx#L90-L99)；[`frontend/src/components/preparations/PreparationWorkspace.tsx:219-238`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/preparations/PreparationWorkspace.tsx#L219-L238)
- **畫面索引**：E038, E039, E043, E040, E041, E042（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 概況 `/summary`

- **家長目的**：快速了解孩子整體狀態與變化。
- **問題與影響**：「核對這項任務」未帶 taskId；主 metadata 顯示 ID；窄版日期斷行。基線當時無預約／衝突卡。
- **優先級與原 ID**：IA-01 P1；IA-02／V07 P2。
- **本批處理**：snapshot27 有界瀏覽器已確認 A/B 精確 taskId、返回／320鍵盤重訪及320／390／1024負責人安全替代；姓名契約仍缺，日期排版未改。兩項新合成預約供候選驗收，不是代家長預約功能。
- **基線已操作**：切概況／成長檔案；用UI把摘要起點由2026-10-23改到2026-10-08並套用，預約／跟進仍0。
- **基線未覆蓋**：預約／衝突任務卡、負責人UUID實屏、匯出結果未驗。
- **源碼證據**：[`frontend/src/screens/SummaryScreen.tsx:69-85`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/SummaryScreen.tsx#L69-L85)；[`frontend/src/components/summary/SummaryRecords.tsx:40-48`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/summary/SummaryRecords.tsx#L40-L48)
- **畫面索引**：E022, E023, E024, E025, E026, E027（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 核對 `/care`

- **家長目的**：理解並確認助手整理是否符合原意。
- **問題與影響**：待確認卡正文優先可保留；已保存卡反覆強調通用類型，掃描具體事件較慢。
- **優先級與原 ID**：V09 P3。
- **本批處理**：本批未修改；已保存與本人已核對仍分開。
- **基線已操作**：待確認整卡開modal、Escape關閉；切已保存、捲讀原域卡。沒有確認或刪除記錄。
- **基線未覆蓋**：長文回原卡精確回焦屬前批Site85 smoke，不混成本輪全面回歸；非本輪全部卡操作。
- **源碼證據**：本項為畫面觀察或正向保留，沒有另造源碼因果。
- **畫面索引**：E044, E049, E045, E046, E047, E048（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 記憶 `/memory`

- **家長目的**：知道系統記得甚麼，修正或移除不合適內容。
- **問題與影響**：手機頁面定位較弱；記憶及來源技術文字需整理，部分識別只在次級層。
- **優先級與原 ID**：V02 P2；IA-08 P3。
- **本批處理**：本批未修改，不把短期摘要改稱有效任務。
- **基線已操作**：實際切三tabs，390用更多分類箭頭橫向露出參考資料後選取；未管理／改記憶。
- **基線未覆蓋**：raw來源ID及第二層版本識別未全展開，IA-08不冒稱都已實屏。50檔名short但實為long；53／54仍short，正確reference為56。
- **源碼證據**：[`frontend/src/components/memory/MemoryReferenceView.tsx:23-24`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/memory/MemoryReferenceView.tsx#L23-L24)
- **畫面索引**：E050, E057, E051, E052, E056, E053, E054, E055（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 歷史 `/history`

- **家長目的**：找回之前內容及變更。
- **問題與影響**：首屏分類、搜尋及兩個日期欄壓後內容；底欄位置語意與維護用語仍需改善。
- **優先級與原 ID**：V01／V02 P2；IA-09／V09／V10 P3。
- **本批處理**：候選將日期放入局部 modal、搜尋及動作收緊，保留讀者身分及範圍。只有核對類日期限制文案改短；掃描100／10、卡標題及底欄定位未改。
- **基線已操作**：切8分類；檔案修改從未載入點讀取歷史；消息整卡開全文再關閉。其餘分類主要閱讀，不逐卡操作。
- **基線未覆蓋**：所有分類雙尺寸／全部資料頁未覆；58只見任務分類首屏，不聲稱任務history全部卡有真圖。搜尋命中、翻頁、載入更多未操作。
- **源碼證據**：[`frontend/src/components/history/PersonalHistoryViews.tsx:48-69`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/history/PersonalHistoryViews.tsx#L48-L69)
- **畫面索引**：E058, E059, E060, E066, E067, E068, E069, E070, E071, E072, E061, E062, E063, E064（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 設定 `/settings`

- **家長目的**：控制帳戶、通知、外觀與模型選擇。
- **問題與影響**：通知重讀及版本先於欄位；模型含接線語句；助手授權與備註原本已有分區。
- **優先級與原 ID**：V01／V02 P2；IA-10／IA-11／IA-15／V10 P3。
- **本批處理**：候選只整理通知／模型設定層級與局部文案；IA-10、背景示例 IA-15 及手機定位未改。家庭能力仍未開放。
- **基線已操作**：切tabs及捲動；沒有改值／保存／換背景／輸入key／撤會話／刪帳戶。
- **基線未覆蓋**：8tabs不是每tab都兩尺寸；自選高對比背景未套用，真模型／通知接線／權限與保存完全未驗。
- **源碼證據**：[`frontend/src/production/AgentAuthorization.tsx:35-77`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/production/AgentAuthorization.tsx#L35-L77)；[`frontend/src/components/model-settings/ModelSettingsView.tsx:118-170`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/model-settings/ModelSettingsView.tsx#L118-L170)；[`frontend/src/components/appearance/BackgroundSettings.tsx:24`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/appearance/BackgroundSettings.tsx#L24)；[`frontend/src/components/navigation/app-navigation.ts:50-53`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/navigation/app-navigation.ts#L50-L53)
- **畫面索引**：E003, E004, E012, E013, E014, E015, E005, E006, E007, E008, E009, E010, E011（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 全部功能 `/more`

- **家長目的**：找到較少用但需要的功能。
- **問題與影響**：家庭入口描述比實際能力多；手機全部功能仍高亮核對，現在位置容易混淆。
- **優先級與原 ID**：IA-05／V02 P2。
- **本批處理**：本批未修改，不新增家庭協作。
- **基線已操作**：從目錄到家庭／聯絡／來源／說明；390由底部核對上拉實際導航至more。
- **基線未覆蓋**：寬版全部條目描述未逐張截圖；不是所有入口能力都做了功能驗收。
- **源碼證據**：[`frontend/src/components/navigation/app-navigation.ts:50-53`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/navigation/app-navigation.ts#L50-L53)
- **畫面索引**：E073, E074, E081（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 檔案 `/profile`

- **家長目的**：查看和更新孩子基本資料。
- **問題與影響**：孩子名、確認狀態、已知與未知資料可辨，寬窄閱讀層級合理。
- **優先級與原 ID**：本輪未新增主要問題。
- **本批處理**：本批未修改；保留內容優先，不強迫改成歷史卡。
- **基線已操作**：由more導航、尺寸切換、閱讀首屏；沒有按編輯或新增孩子。
- **基線未覆蓋**：編輯modal、修改來源與孩子管理未實作驗收。
- **源碼證據**：本項為畫面觀察或正向保留，沒有另造源碼因果。
- **畫面索引**：E083, E082（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 照片 `/photos`

- **家長目的**：查看及整理孩子相片。
- **問題與影響**：合成附件及來源可閱讀，提取同意與危險刪除清楚；手機底欄仍以核對高亮。
- **優先級與原 ID**：V02 P2，僅導航定位。
- **本批處理**：本批未修改；不因缺自動縮圖而繞過私人附件讀取界線。
- **基線已操作**：從來源進/photos，開既有合成四色圖，捲至同意及危險區；無上傳、勾同意、提取、刪除。
- **基線未覆蓋**：care?view=photos相容入口未單獨走；不驗照片寫入／模型。
- **源碼證據**：本項為畫面觀察或正向保留，沒有另造源碼因果。
- **畫面索引**：E089, E090, E091, E088, E092, E093（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 來源 `/sources`

- **家長目的**：找回提供的資料及來源內容。
- **問題與影響**：多段範圍與流程說明壓後來源本體；選取後仍重複用途與保存層次。
- **優先級與原 ID**：V01 P2；IA-14／V11 P3。
- **本批處理**：明確待處理，本批完全沒有修改 sources；不可因 history/settings 改善便說 V01 全部完成。
- **基線已操作**：點查看既有合成來源、捲讀詳細內容，再導航照片；沒有保存、修改、刪除或交助手。
- **基線未覆蓋**：完整原文disclosure、技術來源層、來源修改記錄未全部打開；沒有網頁抓取。
- **源碼證據**：[`frontend/src/components/shared-inputs/SourcesView.tsx:74-99`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/shared-inputs/SourcesView.tsx#L74-L99)
- **畫面索引**：E084, E085, E086, E087（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 聯絡 `/contact`

- **家長目的**：了解本人的通知渠道及授權。
- **問題與影響**：合成讀取失敗出現兩段重複且混讀寫提示；正常三關卡及保存 busy 未實屏。
- **優先級與原 ID**：IA-07 P2；V12 P3，同一狀態語意主題。
- **本批處理**：本批未修改；既有 Contact 型別兩錯另列工程限制，不增加設計問題數。
- **基線已操作**：導航及兩尺寸閱讀；未重試寫入、調整同意或發通知。
- **基線未覆蓋**：正常聯絡資料／渠道／三checkpoint／保存busy無樣本，明確待核。
- **源碼證據**：[`frontend/src/components/contact/ContactView.tsx:45-66`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/contact/ContactView.tsx#L45-L66)
- **畫面索引**：E077, E078（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 家庭 `/family`

- **家長目的**：知道誰可參與照顧及可見範圍。
- **問題與影響**：落地頁明說尚未開放，不是假空列表；但入口宣傳會讓家長期待成員、角色及交接。
- **優先級與原 ID**：IA-05／V02 P2。
- **本批處理**：本批未修改。可用聯絡設定不等於家庭協作已接通。
- **基線已操作**：從more進來，寬窄閱讀；未改任何權限或成員。
- **基線未覆蓋**：家庭協作本來未開放，不把未提供功能判為這次回歸。
- **源碼證據**：[`frontend/src/components/navigation/app-navigation.ts:50-53`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/components/navigation/app-navigation.ts#L50-L53)
- **畫面索引**：E076, E075（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 指引 `/guide`

- **家長目的**：了解安全和使用方法。
- **問題與影響**：回訪者先見帳戶與孩子管理，真正三步使用說明在後。
- **優先級與原 ID**：IA-12／V08 P2，同一主題。
- **本批處理**：本批未修改；後續應依首次引導狀態排序，保留能力與授權界線。
- **基線已操作**：切第3步、正常捲讀；320抽查；最後只用合成登出開login。
- **基線未覆蓋**：不聲稱完成新帳戶引導、孩子建立或通知授權。
- **源碼證據**：[`frontend/src/screens/guideScreen.tsx:62-133`](https://github.com/2NTTY/child-ai-caregiver/blob/db37215b5c658bbc41db3bc30822273513cd6ee6/frontend/src/screens/guideScreen.tsx#L62-L133)
- **畫面索引**：E094, E102, E095, E096, E097, E098（見 [結構化索引](evidence-index.json)；基線只附六張代表原圖）。

## 共用導航與消息

- **導航／資訊側欄**：寬版左側主導航與右側資訊分工保留；390 已開啟側欄、Escape 關閉，底欄上拉至全部功能。V02 位置語意仍待處理。右側欄寬版及 HomeFocus 重複未實屏，窄版預覽提示疊層不能直接當正式產品故障。證據 E079–E081。
- **Bell／消息**：真正保存正文、消息歷史整卡 reader 及聊天活動待確認分工已成立。最近消息底部的歷史／關閉入口可達；不改成背景投遞 run 列表。證據 E060、E063–E065。沒有驗真實投遞、已讀或 OS 通知權限。
- **管理員頁**：`/admin` 已 source trace 有 gated 入口，不屬 17 個一般家長 route；未操作管理功能，也未做後端權限安全驗收。
