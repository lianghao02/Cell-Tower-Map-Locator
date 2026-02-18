# 專案特定細則：基地台地圖定位器 (Cell-Tower Locator Rules)

> [!NOTE]
> 本專案受全域「開發憲法」規範。以下為針對偵查業務需求的補充。

## 1. 業務邏輯與功能需求

- **座標系統**：預設輸入格式為 WGS84。需支援批次轉換並在 Leaflet 或 Google Maps 上標註。
- **偵查標記**：標記點需能區分「受話地」、「發話地」及「移動路徑」。

## 2. 動態配置 UI (根據憲法實作)

必須在網頁介面提供以下可調整的「設定面板」：

- `MAP_PROVIDER`: 地圖供應商 (Select: Leaflet-OSM, GoogleMaps, Taiwan-NLSC)。
- `SEARCH_RADIUS`: 基地台訊號涵蓋半徑 (Slider: 100m - 5000m)。
- `THEME_COLOR`: 介面警用主題色 (Color Picker: 預設 #001A33)。

## 3. 安全與隱私

- **無外部傳輸**：基地台座標檔僅限於瀏覽器端解析，禁止上傳至任何雲端資料庫。
- **純單檔化**：所有 Leaflet CSS/JS 必須經由 CDN 載入。