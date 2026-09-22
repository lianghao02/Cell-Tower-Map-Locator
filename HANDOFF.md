# HANDOFF

## 核心元資料 (Metadata)
- **Repository**：02_Cell-Tower-Map-Locator
- **Branch**：main
- **Commit SHA**：f364f92
- **Skill Version**：v1.0.0
- **Task Type**：FIX
- **Local Path Hint**：`02_Cell-Tower-Map-Locator`

---

## 目前狀態
已發布（中華電信即時定位解析修復與高 DPI 地圖清晰度改善已驗證通過，並正式推送至 `origin/main` 部署）

---

## 本輪目標
1. 解決中華電信調閱回覆資料（含即時定位目標明細、單筆細胞經緯度）之解析相容性問題。
2. 根除「細胞緯度」將經緯度切斷導致單筆資料無法辨識座標之缺陷。
3. 支援中華電信「同實體基地台但不同 Cell / 不同天線方位角」多筆紀錄並存，不被去重邏輯吞掉。
4. 擴充資料模型以保留 `towerId`（基地臺編號）、`cellId`（細胞編號）、`address`（細胞地址）、`responseTime`（定位回應的時間），並於多點時間軸清單與地圖 Marker Popup 完整呈顯。
5. 改善 iPhone／高 DPI 手機上 Leaflet 地圖底圖文字偏模糊問題（三大圖層加入 `detectRetina: true` 並配置相容之 `maxNativeZoom`）。
6. 手機端控制台抽屜 transition 結束後自動觸發 `map.invalidateSize()`，防範破圖與缺角。
7. 頁尾版本字樣統一校正為 `v3.2.2`。
8. 執行 QA 驗證與全套 regression 測試（Case 1~4、台哥大、遠傳、DMS/DMM、民國時間）。

---

## 基準與已確認事實 (Baseline & Confirmed Facts)
1. **格式根因**：中華電信回傳資料之欄位排列為「細胞經度：... \n 細胞緯度：...」，原本 `rawBlocks = text.split(/(?=(?:行動電話號碼|定位請求|註冊基地|細胞經緯度|細胞緯度))/g)` 中包含 `細胞緯度`，導致經緯度被腰斬拆成兩個獨立 Block，使經緯度配對失效報錯。
2. **切段規則**：**絕對不能將 `細胞緯度` 放入切段正則**。
3. **同基地台多 Cell 判定**：中華電信 18 筆調閱回覆中，常出現同一基地臺編號（例如 315932）但在不同時間點使用不同細胞編號（如 Cell 13 方位角 40°，Cell 31 方位角 330°）。原 Generic Parser 去重邏輯僅依據經緯度與請求時間判斷，若同時間或同座標未比對方位角，將誤吞有效 Cell 資料。現已在去重判斷中加入 `item.azi === azi`。
4. **中華電信標頭相容**：中華電信調閱單序號常為 `1\n定位成功` 或直接為 `細胞經度：...`，已於 `isPortalResponse` 與 `parsePortalResponse` 全面納入支援。

---

## 已完成 (Completed)
- **高 DPI / iPhone 地圖底圖清晰度改善 (`js/app.js`)**：
  - 為 OpenStreetMap、臺灣通用電子地圖 (NLSC) 與高解析衛星空照圖 (Esri) 全面啟用 `detectRetina: true`。
  - 精確設定 `maxNativeZoom`（OSM: 19, NLSC: 19, Esri: 18），確保在 2x/3x Retina 螢幕上以 1:1 實體像素顯示銳利路名文字，且縮放至最高層級時絕不觸發不存在圖磚的 404 錯誤。
- **地圖最大 Zoom 上限對齊 (`js/app.js`)**：
  - 將 Leaflet `L.map("map", { maxZoom: 20 })` 統一最大縮放為 20（解決原設定 22 導致極限放大時底圖消失空白問題）。
  - 將 Esri 衛星底圖 `maxZoom` 設為 20（`maxNativeZoom: 18`），在 Zoom 19~20 藉由 overzoom 穩定渲染。
  - 確認 OSM、NLSC、Esri 三大圖層於 Zoom 20 均可穩定顯示，且桌機滾輪與手機雙指放大無法再突破至無圖磚的 Zoom 21/22。
  - 全文檢驗無任何 `setView` 或 `setZoom` 硬編碼超過 20。
- **手機端抽屜轉場地圖尺寸自適應 (`js/app.js`)**：
  - 監聽 `floating-console` 的 `transitionend` 事件並實施 50ms 防抖，在抽屜展開、收合或高度動畫結束時精確觸發 `map.invalidateSize()`，徹底消除地圖邊緣黑邊或白塊。
- **切段正則修復 (`js/app.js`)**：
  - 移除 `rawBlocks` 切段中的 `細胞緯度`，改為以 `基地[臺台]資訊|基地[臺台]編號` 作為區段開頭切分，徹底解決座標被拆半問題。
- **Portal Parser 辨識擴充 (`js/app.js`)**：
  - `isPortalResponse()` 與 `parsePortalResponse()` 支援 `定位成功` 關鍵字、換行序號格式（例如 `1\n定位成功`）與 `細胞資訊/細胞經度` 標頭；並支援無序號的多筆定位回覆。
  - `parsePortalCoordinateSection()` 同步支援關鍵字分欄（`細胞經度/細胞緯度`）與成對座標（`25.xxx, 121.yyy`）。
- **資料模型擴充與保留 (`js/app.js`)**：
  - 完整擷取並保留 `towerId`（基地臺編號）、`cellId`（細胞編號）、`address`（細胞地址）、`responseTime`（定位回應時間）。
  - Generic Parser 與 Portal Parser 統一資料模型；歷史紀錄儲存與還原 (`restoreFromHistory`) 完整帶入新欄位。
- **去重邏輯保護 (`js/app.js`)**：
  - 嚴密比對 `lat, lng, azi, reqTime/regTime, towerId, cellId`，確保同實體基地台但不同 Cell（如 Cell 13 vs Cell 31 vs Cell 33）與不同時間之時序紀錄全部完整保留。
- **UI 與地圖呈現強化 (`js/app.js`)**：
  - 地圖 Marker Popup 與多點時間軸列表加入基地台編號、細胞編號與門牌地址顯示。
- **版本號同步 (`index.html`)**：
  - 標題版本由 `v3.2.1` 校正為 `v3.2.2`；頁尾版權標示由 `System Version 3.0` 更新為 `System Version 3.2.2`，全站版本完全對齊。
- **QA 與回歸測試 (`scripts/qa.ps1`)**：
  - `node --check js/app.js` 通過。
  - `git diff --check` 通過。
  - Case 1（單筆中華電信）、Case 2（同基地台多 Cell）、Case 3（三大基地台）、Case 4（完整 18 筆排版與 maxBatchLimit）、台哥大、遠傳、DMS/DMM、民國時間全部 100% 通過。

---

## 異動檔案 (Changed Files)
- `index.html`: 頂部與頁尾版本號標示同步 (v3.2.2)
- `js/app.js`: 中華電信切段與無序號相容、嚴格去重保護、三大底圖 detectRetina、抽屜 transitionend 重繪
- `CHANGELOG.md`: 記錄 v3.2.2 中華電信相容性修復與高 DPI 地圖清晰度改善
- `HANDOFF.md`: 本交接文件

---

## 刻意未修改 (Do Not Do / Deliberately Omitted)
- **未放寬 `maxBatchLimit = 5`**：維持目前最多選取 5 筆地圖繪製與交集上限，避免行動裝置效能過載；完整 18 筆紀錄能被 parser 完全解析。
- **未順便啟動 v3.3.0 飄移演算法**：保留給後續專注設計，避免一次改動過大。
- **不重寫框架**：維持標準原生 Vanilla JS + Leaflet DOM 操作，不引進外部相依性套件。

---

## 尚未完成 (Remaining Work)
- **P1 (阻斷/必須)**：無阻斷問題，核心功能已修復完成。
- **P2 (重要/當次)**：無。
- **P3 (改善建議/暫緩 - v3.3.0 規劃)**：
  - **乒乓 / 飄移智慧研判模組**：
    - 多筆同一地點查詢的基地台一致性分析。
    - 偵測「座標沒變，但回傳基地台變了」或「短時間內頻繁在不同基地台／細胞間切換」的飄移跳訊事件。
    - 在分析結果列標示「穩定」、「飄移」、「切換」狀態。
  - **即時查詢分析強化**：
    - 飄移率統計（同位置 N 次查詢中幾次換台）。
    - 查詢快照：保存時間戳與基地台快照。

---

## 驗證結果 (Validation)
### 已執行測試與結果
- `node --check js/app.js` → PASS
- `scripts/qa.ps1` → PASS
- `git diff --check` → PASS
- Node VM 回歸測試（Level 2 & Level 3）：
  1. Case 1（單筆中華電信真實格式）：lat, lng, azi, towerId, cellId, reqTime, responseTime, regTime, address 全部通過。
  2. Case 2（同基地臺不同 Cell）：315932 / Cell 13 / 40°、315932 / Cell 31 / 330°、315932 / Cell 33 / 330° 全部保留，未被誤吞。
  3. Case 3（不同基地臺）：315932, 319010, 319372 全部正確辨識。
  4. Case 4（完整 18 筆真實排版）：內部完整解析 18 筆，按時間正向排序，UI 依 maxBatchLimit 載入最新 5 筆。
  5. 遠傳電信調閱回覆（含 GMLC）：解析通過。
  6. 台灣大哥大調閱回覆：解析通過。
  7. DMS / DMM / DD 座標轉換：度分秒換算通過。
  8. 民國紀年時間解析：民國 115 年換算通過。
  9. 三大底圖（OSM、NLSC、Esri）在 zoom 16~19 HTTP 請求驗證：全部 HTTP 200 正常載入。

### 尚未驗證項目
- 真實 iPhone 實機開啟線上版進行手動點擊實測（已透過 DevTools 高 DPI 模擬驗證）。

### 已知風險 (Known Risks)
- NLSC 為政府開放圖資服務，若遇伺服器維護時會由 OSM 雙層備援機制處理。

---

## Git 狀態
- Commit：`f364f92`（`fix: support Chunghwa location records and improve mobile map clarity`）
- Push：是（已成功推送至 `origin/main`）
- Working Tree：Clean
- Branch：`main`

---

## 下一步建議動作 (Next Recommended Action)
1. 在 iPhone / 手機實機開啟線上正式版（https://lianghao02.github.io/Cell-Tower-Map-Locator/）確認底圖文字清晰度與操作手感。
2. 規劃並啟動 v3.3.0 基地台飄移與跳訊智慧研判機制。

---

## 發布狀態 (Release Status)
可交付
