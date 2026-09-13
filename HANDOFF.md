# HANDOFF

## 目前狀態
可交付（Working Tree Clean，主功能完整驗證）

---

## 本輪目標
1. 修復本機 `file:///` 環境圖磚 403 問題（OSM 官方阻擋 Referer=null）
2. 新增三圖磚切換控制項（繁中 OSM / 國土測繪 / 衛星空照）
3. 提升 Google Maps 導航按鈕可讀性（對比度修復）
4. 整理專案並交接 Codex

---

## 已完成

### 圖磚修復（`js/app.js`）
- **根因**：`tile.openstreetmap.org` 對 `Referer: null`（本機 file:// 協定）回傳 403 Access Blocked
- **方案**：改用 `tile.openstreetmap.de`，實測本機顯示繁體中文地名，與 GitHub Pages 線上版一致
- **遷移保護**：`loadConfig()` 內 `isOutdatedTile` 判斷，自動升級舊版 URL（`.org`、`cartocdn`、`.fr`）
- **三圖層**：
  - 🗺️ OpenStreetMap（繁體中文）→ `openstreetmap.de`（預設）
  - 🇹🇼 臺灣通用電子地圖 → `wmts.nlsc.gov.tw`（NLSC 國土測繪）
  - 🛰️ 高解析衛星空照圖 → Esri ArcGIS World Imagery
- **雙層備援**：`osmLayer.on('tileerror')` 自動 fallback 至 NLSC

### Google Maps 導航按鈕（`css/style.css`）
- Leaflet popup 內 `.btn-nav-gmap` 強制純白字（`color: #ffffff !important`），解決按鈕可讀性問題

### 手機版 Bottom Sheet（`css/style.css`、`js/app.js`）
- `@media max-width: 768px` 底部抽屜收合/展開完整
- GPS FAB 按鈕（`locateMe()`）於手機端正常運作，藍光脈衝動畫正確

### 版本歷程（本輪相關）
| Commit | 說明 |
|--------|------|
| `f305e9e` | fix: 修復本機 file:/// 圖磚 403，改用 openstreetmap.de 繁中圖資並新增三圖磚切換控制項 |
| `87c35e5` | fix: 提升基地台分析透明度與分享隱私 |
| `60c372f` | fix: 發布 v3.2.1 定位與行動版修補 |

---

## 刻意未修改
- `README.md`：v3.2.1 說明仍正確，圖磚說明可於 v3.3.0 一併更新
- `CHANGELOG.md`：圖磚修復屬補丁性質，可在 v3.3.0 一起寫
- `index.html`：HTML 結構未動，所有修改限於 `js/app.js` 與 `css/style.css`

---

## 尚未完成

### v3.3.0 規劃（用戶確認方向：即時查詢分析優先）
用戶需求原話：「基地台可能會飄移，人沒動，但是基地台飄了」「我比較著重在當下的查詢分析」

**建議 v3.3.0 核心功能**：
1. **乒乓 / 飄移智慧研判模組**
   - 多筆同一地點查詢的基地台一致性分析
   - 偵測「座標沒變，但回傳基地台變了」的飄移事件
   - 在分析結果列標示「穩定」、「飄移」、「切換」狀態
2. **即時查詢分析強化**
   - 同一地點多次查詢，自動比對基地台 ID 差異
   - 飄移率統計（同位置 N 次查詢中幾次換台）
3. **查詢快照**
   - 保存本次查詢的精確時間戳與基地台快照
   - 支援查看「這個地點在不同時段連到哪個台」

---

## 驗證結果

### 已執行
- `git status` → Working Tree Clean（`f305e9e`，`main` 分支）
- `node --check js/app.js` → 語法無錯誤
- 圖磚 URL 格式目視確認（`.de` 替換 `.org`，`subdomains: 'abc'`）
- `loadConfig()` 遷移邏輯目視確認（三個舊 URL 模式對應升級）
- `L.control.layers` 三圖層初始化目視確認

### 尚未驗證
- 瀏覽器實測：本機 `file:///index.html` 開啟後三圖磚實際顯示效果
- 手機端圖層切換按鈕（右上角）是否被 FAB 遮擋

### 已知風險
- NLSC `wmts.nlsc.gov.tw` 為政府 API，可能有流量限制或維護期斷線
- `openstreetmap.de` 非官方但穩定，OSM 官方使用條款限制僅針對 `.org`

---

## Git 狀態
- Commit：`f305e9e`
- Push：**否**（尚未 push，待確認後再 push）
- Working Tree：**Clean**
- Branch：`main`

---

## 專案結構速查

```
D:\Development\GitHub\02_Cell-Tower-Map-Locator\
├── index.html          # 主頁 (588 行)
├── js/
│   └── app.js          # 主邏輯 (2359 行)，含所有業務邏輯
├── css/
│   └── style.css       # 樣式 (166 行)
├── 啟動工具.bat         # 一鍵啟動
├── scripts/
│   └── qa.ps1          # QA 腳本：node --check + git diff --check
├── CHANGELOG.md        # 版本紀錄（最新 v3.2.1）
├── README.md           # 專案說明
└── AGENTS.md           # 專案專屬規則邊界
```

### `js/app.js` 關鍵行號速查
| 功能 | 行號 |
|------|------|
| `DEFAULT_CONFIG`（含 `mapTileUrl`）| 66–79 |
| `isMobileLayout()` | 84 |
| `loadConfig()`（含圖磚遷移邏輯）| 201–218 |
| `updateMap()` 地圖初始化（三圖層 + control.layers）| 959–991 |
| `updateSheetSummary()` 手機摘要列 | 1528 |
| `toggleConsole()` | 1544 |
| `locateMe()` GPS 定位 | 1580 |
| `app.*` 對外暴露方法 | 2220+ |

### `css/style.css` 關鍵區段
| 功能 | 行號 |
|------|------|
| GPS 脈衝藍點動畫 | 1–45 |
| 手機版 Bottom Sheet（@media max-width: 768px）| 46–130 |
| Leaflet popup `.btn-nav-gmap` 高對比度 | 131–166 |

---

## 圖磚可用性備忘

| 圖磚來源 | 本地 file:// | 繁中顯示 | 備註 |
|----------|-------------|---------|------|
| `tile.openstreetmap.org` | ❌ 403 | ✅ | OSM 官方阻擋本地請求 |
| `basemaps.cartocdn.com` | ✅ | 混合 | 浮水印問題 |
| `tile.openstreetmap.fr` | ✅ | ❌ 拼音 | 羅馬化地名 |
| **`tile.openstreetmap.de`** | ✅ | ✅ | **目前選用** |
| `wmts.nlsc.gov.tw` | ✅ | ✅ | 次選圖磚 + 備援 |
| Esri World Imagery | ✅ | N/A 衛星 | 衛星空照 |

---

## 下一步

**Codex 接手建議執行順序**：

1. `git log --oneline -5` 確認目前分支狀態
2. `node --check js/app.js` 確認語法
3. 在瀏覽器開啟 `file:///D:/Development/GitHub/02_Cell-Tower-Map-Locator/index.html` 確認三圖磚切換正常顯示繁體中文
4. 若驗證通過，`git push origin main`
5. 開始 v3.3.0：乒乓 / 飄移智慧研判模組
