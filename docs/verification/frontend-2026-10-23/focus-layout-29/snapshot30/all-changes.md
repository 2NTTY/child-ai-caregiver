# 本次全部修改：整合至 snapshot30

以 [57檔凍結清單](receipts/source-scope57.json)為準。以下按用途合併說明，不將相同檔案重複計數；所有34個產品路徑另列末表。`29保留`表示該產品檔在29→30沒有改動，不表示30重新做過所有舊驗收。

| 區域 | 本次已實作內容 | 版本分層 |
|---|---|---|
| 歷史待辦版式 | 待辦歷史由卡片格網改單欄緊湊閱讀列；保留詳情、整列操作、焦點及scroll錨點。 | 29；30保留並重跑相關定向測試。 |
| Care事件／讀取／焦點 | 已保存事件正文優先、AX名稱最多100 Unicode字；同scope空snapshot／count／已讀頁面／詳情保留；寫後回首頁而非舊cursor；純讀取保焦但拒絕動作。 | 29功能保留；30進一步調整詳情及確認時間metadata。 |
| 記憶／待辦讀取範圍 | loaded-ID邊界原子更新；保留歷史／載入更多範圍，不按頁數粗略截斷。 | 29；30無owner改動，自然focus補驗另列。 |
| 備註／聊天 | 備註按已掃描cursor重讀，允許零匹配頁；刪除窗凍結版本；stale重試保搜尋焦點；聊天已載空snapshot不回首次載入。 | 29；30保留。failed空備註與首次失敗的既有限制不抹掉。 |
| 設定／來源／概況 | 相同依據保確認及草稿；來源readFresh不製造假stale、寫入仍鎖；概況空snapshot與已套用period保持。 | 29；30保留，未驗場景須用30新證據。 |
| 共用Tabs／導航 | sibling badge改變後量測實際位置；管理順序核對→記憶→檔案→全部功能。 | 29；30未改同底層，不將29圖片改稱30。 |
| 待辦metadata | 本文與details優先；種類、負責人、預定時間、加入／更新時間使用小圖示metadata；無選填詳細內容不顯示空佔位；保留狀態／版本及資格警告。 | 30新增。 |
| 準備單metadata | 標題及摘要先行；用途、孩子、使用／更新／資料截至日期、來源及可見範圍用metadata；未填選填使用日期不空列，較新來源版本警告仍保留。 | 30新增。 |
| 關注時間線metadata | 事件標題／正文先行；真正待核對／已確認仍用狀態badge；普通事件種類／時間改圖示metadata。 | 30新增。 |
| 助手提案metadata | 已知欄位按精確語意選圖示；來源／負責人／可見範圍縮短重複字，AX仍有完整標籤；未知欄位不硬配information圖示或推斷來源種類。 | 30新增；保留確認／權限／原操作流程。 |
| Care詳情metadata | 種類、真來源、數量及原文事件時間改圖示metadata；已保存閱讀可省略未填選填數量，必需缺失仍提示；確認時間保完整AX；長值可縮排而不截掉原文。 | 30新增；審核發現的shrink缺口已修。 |
| 記憶閱讀／來源 | 內容主於topic；可見範圍及來源種類用metadata，來源只打開既有provenance；無選填期限不空列，適用性／來源變更／確認者保留；安全URL處理及開啟失敗完整原文恢復。 | 30新增；URL及長值兩項原紅保留，修後定點重播。 |
| Contact表單契約 | schema加入現有native_push，max bindings由2對齊3；保留同渠道唯一、本人可用綁定與精確版本判斷、原projection。 | 30獨立契約修補；不宣稱已測原生通知投遞。 |
| 設計文件 | 既有頁型規範保留；另補已採納metadata／真互動／必要空值與本人短名原則。不是測試證據。 | 30 build凍結doc未改；交付另附doc-only更新，見[附加收據](receipts/documentation-addendum.json)。 |

## 34個產品檔及版本

| Product path | 29→30 |
|---|---|
| `frontend/src/components/agent/AgentRunView.tsx` | 30新增／修改 |
| `frontend/src/components/agent/proposal-presentation.ts` | 30新增／修改 |
| `frontend/src/components/care/CareRecordDetail.tsx` | 30新增／修改 |
| `frontend/src/components/care/CareReviewHistoryView.tsx` | 29保留，bytes不變 |
| `frontend/src/components/care/CareSavedRecordsView.tsx` | 30新增／修改 |
| `frontend/src/components/contact/contact-form.ts` | 30新增／修改 |
| `frontend/src/components/growth/GrowthConcernTimeline.tsx` | 30新增／修改 |
| `frontend/src/components/memory/MemoryReferenceView.tsx` | 30新增／修改 |
| `frontend/src/components/model-settings/ModelSettingsView.tsx` | 29保留，bytes不變 |
| `frontend/src/components/navigation/app-navigation.ts` | 29保留，bytes不變 |
| `frontend/src/components/preparations/PreparationWorkspace.tsx` | 30新增／修改 |
| `frontend/src/components/shared-inputs/SourcesView.tsx` | 29保留，bytes不變 |
| `frontend/src/components/summary/SummaryView.tsx` | 29保留，bytes不變 |
| `frontend/src/components/tasks/TaskContent.tsx` | 30新增／修改 |
| `frontend/src/components/tasks/TaskHistoryView.tsx` | 29保留，bytes不變 |
| `frontend/src/components/tasks/TaskListRow.tsx` | 29保留，bytes不變 |
| `frontend/src/components/ui.tsx` | 29保留，bytes不變 |
| `frontend/src/components/useQuietReadFocus.ts` | 29保留，bytes不變 |
| `frontend/src/production/AgentAuthorization.tsx` | 29保留，bytes不變 |
| `frontend/src/production/AgentAuthorizationOwner.ts` | 29保留，bytes不變 |
| `frontend/src/production/CareProfileDomains.tsx` | 29保留，bytes不變 |
| `frontend/src/production/CareReadCoordinator.ts` | 29保留，bytes不變 |
| `frontend/src/production/SettingsDomains.tsx` | 29保留，bytes不變 |
| `frontend/src/production/TaskKnowledgeSummaryContent.tsx` | 29保留，bytes不變 |
| `frontend/src/production/task-knowledge-memory.ts` | 29保留，bytes不變 |
| `frontend/src/production/task-knowledge-read-window.ts` | 29保留，bytes不變 |
| `frontend/src/production/task-knowledge-summary.ts` | 29保留，bytes不變 |
| `frontend/src/production/task-knowledge-tasks.ts` | 29保留，bytes不變 |
| `frontend/src/production/usePhotoInputSources.ts` | 29保留，bytes不變 |
| `frontend/src/production/useProductionModelSettings.ts` | 29保留，bytes不變 |
| `frontend/src/production/useProductionNotificationPreferences.ts` | 29保留，bytes不變 |
| `frontend/src/screens/careScreen.tsx` | 29保留，bytes不變 |
| `frontend/src/screens/chatScreen.tsx` | 29保留，bytes不變 |
| `frontend/src/shared-input-view-model.ts` | 29保留，bytes不變 |
