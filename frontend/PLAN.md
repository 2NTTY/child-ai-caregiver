# 育有方前端單一計劃

本計劃只管理 frontend/** 的設計與前端實作。產品功能、正式 API、權限與跨模組驗收，以根目錄 [AGENTS](../AGENTS.md)、[STATUS](../STATUS.md)、[PLAN](../PLAN.md)、[SPEC](../SPEC.md) 及 [P2 UI 清單](../docs/P2_UI_HANDOFF.md) 為準。前端不修改 Server、Agent、資料庫、根目錄依賴或正式 App；合併只按使用者明確指示進行。

| 次序 | 前端工作包 | 狀態 | 交付及關口 |
|---|---|---|---|
| 1 | FE-W01 Web 主頁基線 | 待使用者視覺驗收 | 獨立 Expo Web 預覽、資料模型、Paper 共用元件、合成狀態與響應式首頁；原分支 codex/fe-w01-web-home |
| 2 | FE-W02 Web 共用框架與核心畫面 | 待使用者視覺驗收 | 依新增對話／設定／登入參考圖，完成共用導覽及右資訊欄、主頁、對話、照顧記錄、子女檔案、家庭協調、記憶與話題、設定及登入畫面；所有資料仍屬合成預覽；本包分支 codex/fe-w02-web-shell-chat-settings-auth，基於 FE-W01 commit e70a13d |
| 3 | FE-W03 待辦預覽與訊息提示 | 待使用者視覺驗收 | 在 FE-W02 的右資訊欄加入按孩子分隔的本地清單、頂部鈴鐺及原操作狀態提示；對照正式功能缺口並交接。分支 codex/fe-w03-dashboard-todos-notifications，基於 FE-W02 commit 271f10b。正式任務／通知待其業務契約交付 |
| 4 | FE-W04 外殼、孩子摘要與引導 | 待使用者視覺驗收 | 依新增截圖統一右欄開關、頂部孩子資料、左側品牌／對話入口及條件式引導；分支 codex/fe-w04-shell-child-guide，基於 FE-W03 commit 2671a9b。孩子資料正式 API 已存在但此預覽無登入會話；引導完成狀態仍缺正式契約 |
| 5 | FE-W05 Web 動態方向比較 | 比較已完成；暫不採用 | 從 FE-W04 commit 591a23d 建 `codex/fe-w05-motion-preview`；只在 `/motion-preview` 示範 A／B／C 三種節奏，核對 reduced motion／鍵盤／320px，詳見 [MOTION_OPTIONS](MOTION_OPTIONS.md)。保留獨立比較頁作日後參考，不套入正式畫面 |
| 6 | FE-W06 既有契約流程與跨尺寸介面 | 實作及輕量檢查完成；待使用者視覺驗收 | 基於 master `22f5c66`，分支 `codex/fe-w06-care-record-flows`；/care、/profile、/family、/memory、/tasks 及 /settings 本人偏好投影已實作。新增品牌／OKLCH 配色位置、完整 MD3、SVG、Dialog／選單及孩子切換比例修訂，10 頁四種 Web 寬度、共用互動與 Web／Android export 通過；所有寫入仍未接真 API |
| 7a | FE-W07 本人渠道設定前端 | 實作及輕量檢查完成；待視覺／正式接線 | 前置已 review 的 FE-W06 `6c7216f`，分支 `codex/fe-w07-notification-settings`；主線 `34892c7` 已合併 S13-W05／W06（PR #58／#59）。/settings 的本人 Web Push 訂閱／撤銷／明確測試、Telegram 開始私人綁定／候選核對／撤銷／投遞及回覆分開已實作；四 Web 寬度、合成關鍵流程及 Web／Android export 通過。不觸發真權限、訂閱、bot 或外發 |
| 7b | FE-W08 Agent 主要入口 | 實作及輕量檢查完成；待視覺驗收 | 前置已 review 的 FE-W07 `1e1fb7b`（draft PR #65），分支 `codex/fe-w08-agent-entry`；移除桌面導覽第二項，統一下方固定的深綠 SVG／雙層文字入口，保留手機對話分頁及原草稿。外殼導航沿 Expo Link asChild，修復只有 link 角色而無 href 的鍵盤問題；typecheck、40 個重排及四尺寸 Agent 互動、Web／Android export 通過 |
| 7c | FE-W09 Agent 對話投影 | 實作及輕量檢查完成；待視覺／接線 | 基於 `83106c0`，分支 `codex/fe-w09-agent-conversation`，正式契約核對 `90dacd4`。運行／候選／來源及手動私人背景結果、明確共享與原決定查核已實作；四尺寸關鍵合成互動、Web／Android export 通過。真 composer 保存／要求回覆沿原 ChatController 待接線；入口見 [AGENT_HANDOFF](AGENT_HANDOFF.md) |
| 7d | FE-W10 手機比例與密度 | 實作及輕量檢查完成；待視覺／真機驗收 | 前置已 review 的 FE-W09 `0ff9533`（draft PR #69），分支 `codex/fe-w10-mobile-density`。核對 Android／Apple／Paper 5.15.3 MD3 與 Lucide：集中手機字級／圖標／觸控及卡片規則，調整孩子年齡／基準、標題動作、快速記錄與窄 composer；10 頁四尺寸及必要手機互動／150% Web 文字、Web／Android export 通過。研究存 [MOBILE_DESIGN](MOBILE_DESIGN.md) 並補既有 Skill；沒有改色階或後端 |
| 7e | FE-W11 照片與記錄前端 | `ddcf651`／draft PR #73 已交付；待視覺／正式接線 | 前置 FE-W10 `596c657`（draft PR #70），分支 `codex/fe-w11-photos`。直接讀 GitHub master 的 P2 UI 交接及照片契約，交付前重核 `ce87370` 未改照片章節／型別／封裝；原圖／私人保存／候選／人工原文／家庭共享／查核及刪除投影、Web 選圖與原生薄 port 已實作。三項原文單元、11 頁四尺寸、必要照片／手機互動及 Web／Android export 通過；真 API／原生選圖／裝置權限待主聊天 |
| 7f | FE-W12 手機背景及外殼層次 | 實作及輕量檢查通過，追加現有 draft PR #73 | 依使用者 2026-10-01 意見，手機問候使用全幅海旁背景與左側／底部漸淡；常駐頂部／側欄同色，沿現有 OKLCH 表面角色。修訂基線 `685cdfc`，沿同一前端 draft 分支；44 個外殼重排、最終 390／320／150% Web 文字、typecheck、Web／Android export 通過，沒有新增依賴或單元測試 |
| 7g | FE-W13 本人模型設定 | `095f135` 實作及輕量檢查通過，追加現有 draft PR #73 | 前置 `433d312`，直接讀 GitHub `ce87370` UI-P2-18／API／型別／Panel／封裝；平台／個人／停用、密鑰及費用同意、背景 opt-in、個人上限、分開用量、模型 metadata-only 查核及二次刪除已投影。typecheck、三項 command 檢查、四尺寸／鍵盤／unknown 重讀／範圍清理、390／320 放大文字及 Web／Android export 通過；[MODEL_SETTINGS_HANDOFF](MODEL_SETTINGS_HANDOFF.md)，待視覺及真接線／真機 |
| 7h | FE-W14 私人來源及共享核對 | `d00a6bb` 實作及輕量檢查通過，追加現有 draft PR #73 | 前置 `c09c22b`；直接讀 GitHub `ce87370` UI-P2-15／API／型別／Panel／封裝。私人來源／貼上／指定清單、原日期／取得、精確片段／候選、參考／孩子實際記錄、刪除、收據及直接 unknown／範圍清理已投影；共用 RecordDraftFields 和 Paper 多行輸入公開樣式。四項來源／三項照片規則、48 個重排、來源流程／放大文字及 Web／Android export 通過；[SHARED_INPUT_HANDOFF](SHARED_INPUT_HANDOFF.md)，待視覺、真接線／OS share／真機 |
| 7i | FE-W15 成長關注 | `ef536e8` 實作及輕量檢查通過，追加現有 draft PR #73 | 前置 `3e153a7`，直接讀 GitHub `ce87370` UI-P2-07／API／型別／Panel。理由／來源、知悉／任務分開、暫緩／關閉、有限近況／四主題、原 body／授權／fact 版本查回及清理已投影；三項規則、四尺寸及 390／320 放大文字、typecheck／Web 29 路由／Android 31 資產 export 通過。[GROWTH_HANDOFF](GROWTH_HANDOFF.md)，待視覺、真接線／refresh／跨頁及真機 |
| 7j | FE-W16 照顧摘要／到診準備 | `10aa70b` 實作及輕量檢查通過，追加現有 draft PR #73 | 前置 `e61bca2`，直接讀 GitHub `ce87370` S14-W01／API／型別／Panel；期間／來源／原單位、RHF 問題／清單、規範內容／共享確認、原收據／基準／預約失效及清理已投影。兩項規則、四尺寸／390 及 320 放大文字、typecheck、Web 31 路由／Android 31 資產 export 通過；[SUMMARY_HANDOFF](SUMMARY_HANDOFF.md)，待視覺、真接線／精確導航／跨頁及真機 |
| 7k | FE-W17 主動聯絡及功能補缺 | `ebcaa73` 實作及輕量檢查通過，追加現有 draft PR #73 | 前置 `3d4badf`，直接讀 GitHub `ce87370` 的 UI-P2-09／API／型別／Panel。本人同意／任務授權／台帳／ack 分開、期限／版本／原收據與草稿／範圍清理；最後補 UI-P2-06 固定求助入口。三項規則、聯絡及求助四尺寸／390 和 320 放大文字、typecheck、Web 33 路由／Android 31 資產 export 通過；[CONTACT_HANDOFF](CONTACT_HANDOFF.md)，待視覺、真接線／clearDrafts 差異／跨頁及真機 |
| 7l | FE-W18 表面層次及 Agent 輸入入口 | `eb9b48c` 實作及輕量檢查通過，追加現有 draft PR #73 | 前置 `f3ba9e3`，重核 GitHub `ce87370` 的照片／來源交接及 API。控制／資料標籤與外層導航分色；三項 SVG 輸入入口、照片 capture／普通選檔、來源導航及語音未接通提示，原草稿保留。typecheck、20 組色彩、60 個四尺寸重排／放大文字、六寬度 Dialog／選單及 Web／Android export 通過；[AGENT_HANDOFF](AGENT_HANDOFF.md)，真聊天附件／任意文件、語音／原生相機與實機仍待接續 |
| 7m | FE-W19 原對話頁直接拍照 | `f541a2d` 實作及輕量檢查通過，追加現有 draft PR #73 | 前置 `bed1342`；依使用者要求取消拍照跳頁。明確按下才開頁內 Web 相機，拍攝／取消／權限拒絕／後備選圖、原頁未送出預覽、草稿保留、track／blob 及遲到結果清理已實作。typecheck、Web／Android export、1440／1024／390／320 合成串流及原檔、鍵盤和 390／320 放大文字通過；[AGENT_HANDOFF](AGENT_HANDOFF.md)。實際裝置相機／系統權限、原生 adapter 和真正對話附件仍待接線／驗收 |
| 7n | FE-W20 Happy Hues 14／首頁背景 | 實作及輕量檢查通過；追加現有 draft PR #73 | 前置 `0ae3976`，只研究使用者指定第 14 款，按網站角色落實共用配色，必要派生仍用 OKLCH；Web 應用偏好可本地選圖／恢復及跨尺寸首頁套用，原生薄 port 已預留。typecheck／22 組對比／60 重排／Dialog、四尺寸背景／150% 文字與 Web／Android export 通過；[APPEARANCE_HANDOFF](APPEARANCE_HANDOFF.md)。正式保存無契約，不污染通知偏好／照片 API；視覺、原生 adapter 及真機待驗 |
| 7o | FE-W21 育有方前端品牌更名 | 實作及必要輕量檢查通過；待使用者視覺驗收 | 前置 `cb9112e`，從收尾基線 `6f36765` 恢復。品牌文字集中 branding.ts，原 SVG 圖形／比例共用 BrandLogo；各頁／提示／合成示例、Web／Expo 顯示名稱、當前前端文件及 selector 已同步，沿用美術與 Happy Hues 14。60 個重排、共用設計／Agent、四尺寸 Logo／鍵盤返回、typecheck 及 Web／Android bundle 通過；[交接](HANDOFF.md#brand-rename-pending)。原生實機／正式品牌整合待主聊天；根文件、後端及技術身份未遷移 |
| 7p | FE-W22 頂部控件及刪除保障 | 實作及必要輕量檢查通過；待視覺／正式接線 | 前置 `d2f1124`，沿 draft PR #73。鈴鐺／側欄共用 Paper 控件、真實 44／48 點擊範圍及狀態置中；danger 確認樣式、整位孩子稱呼／範圍確認和 unknown 保留已實作。四尺寸／鍵盤／照片二次確認、記錄及孩子刪除合成狀態、typecheck、Web／Android export 通過；[交接](HANDOFF.md#toolbar-delete-safeguards)。不新增 password payload 或帳戶刪除假按鈕，真正身份重新驗證交主聊天 |
| 7q | FE-W23 登入原版還原及裁切 | 實作及必要輕量檢查通過；待使用者視覺驗收 | 原從 `cab2841` 精確還原五檔的證據保留；本次從 `8295fa7` 補修窄高視窗裁切。左介紹／右登入及窄版上下排列保留；桌面右欄 36%／至少 400。原圖 x=1552 作固定可見右邊界，太陽排除、指尖留白，變窄只由左側裁切。2237 × 1265、1440 × 900、1024 × 1237／768、900 × 1237、390 × 844、320 × 720，以及同頁 CSS 縮放等效重排、本地驗證／鍵盤、typecheck、Web／Android export 通過；[交接](HANDOFF.md#login-original-reset)。沿 draft PR #73；真登入、背景偏好及原生實機仍由主聊天處理 |
| 7r | FE-W24 捲動及響應式修補 | 實作及必要輕量檢查通過；待使用者視覺驗收 | 基線 `5b77d90`，沿 draft PR #73。Web AppScrollView 復用 OverlayScrollbars 2.16.0 的既有 viewport；透明軌道覆蓋內容、原生維持 RN。登入 900 以下移除故事，桌面文字加 Expo BlurView 57.0.3；首頁單欄自然高度及手機完整圖片已修正。60 重排、登入／共用設計、局部圖片／高度／捲動／焦點及 Web／Android export 通過；[交接](HANDOFF.md#responsive-scroll)，Android 模糊目標及實機仍待接續／驗收 |
| 8 | Web 整套確認與正式接線 | 待主聊天及使用者 | 使用者比較全部 Web 畫面並明確確認；主聊天按 [HANDOFF](HANDOFF.md) 對正式 App 的既有 API／控制器接線與真服務驗收。未接通 P2 功能須等其業務包交付，不以預覽代替 |
| 9 | FE-W06 手機軟件介面 | 源碼及 bundle 完成；待視覺及真機驗收 | 按使用者 2026-09-29 指示提前做手機畫面；手機首頁依參考圖的品牌／問候、孩子卡片、提問、重點、待辦、快捷記錄及底部導航組裝。共用 React Native 元件、Expo Router Tabs／Safe Area／鍵盤及最終 Android bundle 通過；正式 P3 接線／APK／實機驗收仍待主聊天及後續條件 |

FE-W04 的可獨立驗收範圍是外殼調整、孩子摘要與引導頁的前端投影、條件顯示、Web 響應式／鍵盤檢查及正式接線交接；不宣稱孩子摘要已取得 Server 資料或引導完成狀態已有正式來源。下一批真正任務／通知流程仍須先核對所屬業務包的已交付契約，不依參考圖推造任務完成或訊息送達。

每包依 [WORKFLOW](WORKFLOW.md) 核對 active worktree、提取設計規則、實作、必要輕量檢查及展示合成運行畫面。FE-W01 → FE-W04 的源碼已隨 PR #40–#43 合併；FE-W05 只保留比較樣本，並非後續靜態畫面的前置。2026-09-29 已恢復開發，並依使用者明確新指示加入手機軟件介面，取代先等待整套 Web 視覺確認的開工次序。Web／Android 維持靜態；本次只完成有契約可對照的前端範圍。第 7／8 項未交付的 API、正式接線及集中驗收不能由前端代為完成或標為通過。

FE-W06 驗收範圍：既有靜態路由及新增 /tasks 在 1440／1024／390／320 CSS px 檢查重排；針對新表單檢查確認、失敗保留、同原操作查核、版本衝突、角色、孩子切換及離線。共用設計修訂另查 840／744 的更多選單、SVG、白色 Dialog／合理圓角、孩子切換比例、16 個 token 對比及固定 export 首次載入。Android 只核對 bundle 與共用介面源碼；系統鍵盤、返回鍵、Safe Area、TalkBack、真 session、通知及實機畫面尚待後續驗收。主聊天 P2 集中驗收安排照常，不提前執行真服務或正式 E2E。

2026-10-01：已核對 GitHub UI-P2-01–18，FE-W17 是本期最後一個未投影包；隔離前端程式、合成操作／響應式、共用 Android bundle 及交接已齊備。[覆蓋清單](HANDOFF.md#p2-coverage) 分開列介面與接線，現轉第 8／9 項的視覺及正式整合／實機關口。這不是使用者整套 Web 確認、P2／P3 完成或 PR 合併。

2026-09-29 使用者回報沒額度並要求暫時收尾；源碼及證據保存在 checkpoint `4739b9e`。2026-09-30 已恢復並補完建置、共用設計修訂及 FE-W07 本人渠道前端；使用者另要求建立持續目標。視覺比較及正式接線仍待使用者／主聊天；不把源碼／bundle 完成當作產品包或真機驗收完成。後續只按已交付契約開始獨立前端包；新合併只讀核對，不改主聊天 checkout。
