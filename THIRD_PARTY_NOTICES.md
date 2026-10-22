# 第三方元件聲明

本專案把下列元件放在 `vendor/`，由本機載入，不連外部 CDN。

| 元件 | 版本 | 授權 | 位置 |
|---|---|---|---|
| Leaflet | 1.9.4 | BSD 2-Clause | `vendor/leaflet/`（含 LICENSE） |
| Font Awesome Free（圖示字型與樣式） | 6.4.2 | 圖示 CC BY 4.0、字型 SIL OFL 1.1、程式碼 MIT | `vendor/fontawesome/`（含 LICENSE.txt） |

開發時使用 Tailwind CSS 3.4.17（MIT）預先編譯樣式為 `css/tailwind.css`；執行與發布不需要 Node.js 或 Tailwind。

地圖圖磚、衛星影像與地址搜尋由各自的服務提供（OpenStreetMap、內政部國土測繪中心、Esri、Nominatim），使用時依其條款，資料不由本專案保存。
