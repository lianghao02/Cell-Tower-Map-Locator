/* 地圖圖磚備援（純函式）：不讀寫 DOM 與地圖，只負責「主圖磚失敗時改用哪個網址」。
 * 以傳統 <script> 載入（離線雙擊 index.html 也能運作），必須在 js/app.js 之前載入。回歸測試：tests/tiles.test.js。 */

// 內政部國土測繪中心電子地圖（繁體中文）：OSM 圖磚連線失敗時的備援來源。
const NLSC_TILE_URL = 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}';

function buildTileUrl(template, coords) {
    return String(template)
        .replace('{z}', coords.z)
        .replace('{y}', coords.y)
        .replace('{x}', coords.x);
}

// Leaflet 的 tileerror 事件只傳「一個」事件物件 { tile, coords, error }；
// 傳回要改用的備援網址，無法備援（資料不全，或這塊已經是備援來源）時傳回 null，避免無限重試。
function tileFallbackUrl(event) {
    if (!event || !event.tile || !event.coords) return null;
    const { x, y, z } = event.coords;
    if (![x, y, z].every(Number.isInteger) || z < 0 || x < 0 || y < 0) return null;
    const url = buildTileUrl(NLSC_TILE_URL, event.coords);
    if (event.tile.src === url) return null;
    return url;
}
