/* 基地台調閱文字的解析輔助：方位角驗證、入口網站回覆辨識、文字與門號正規化、日期時間（含民國年）轉換。
 * 純函式：不讀寫 DOM、地圖、儲存，也不依賴 app.js 的任何變數。
 * 由 js/app.js 逐字拆出（內容未修改）。以傳統 <script> 載入（離線雙擊 index.html 也能運作），
 * 必須在 js/app.js 之前載入。回歸測試：tests/parser.test.js。 */

function isValidAzimuth(value) {
    const azimuth = Number(value);
    return Number.isFinite(azimuth) && azimuth >= 0 && azimuth <= 360;
}

// 將網頁表格複製出的 <br> 與不換行空白轉為一般文字格式
function normalizeInputText(text) {
    return String(text || "")
        .replace(/\r\n?/g, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/\u00a0/g, " ");
}

// 判斷是否為通訊調閱入口網站的完整定位回覆，避免一般座標文字誤入專用解析流程
function isPortalResponse(text) {
    const portalRecordPattern = /^\s*\|?\s*\d+\s*\|?\s*(?:\r?\n\s*)?(?:即時定位\s*(?:\||\r?\n)?\s*)?(?:定位完成|定位成功|無法定位)(?=\s|\||$)/m;
    const hasCompleteResponse = /回覆資訊[：:]/.test(text) &&
        /定位記錄[：:]/.test(text) &&
        /序號\s+定位類別\s+定位狀態/.test(text) &&
        portalRecordPattern.test(text);
    const hasPortalRecords = portalRecordPattern.test(text);
    const hasBaseStationSection = /基地[臺台](?:資訊|經緯度|座標|位置)|細胞(?:資訊|經緯度|座標|經度)|Base\s*Station\s*(?:Coordinates?|Location)/i.test(text);
    const hasLocatorMetadata = /(?:定位請求|註冊基地|最後註冊|定位基地[臺台]方向角|Positioning Request|Base Station Reg|detected\s+at)/i.test(text);
    const hasAzimuth = /(?:定位基地[臺台]方向角|基地[臺台](?:方向角|方位角)|天線方位角|Azimuth|Bearing|Dir)/i.test(text);
    // 單筆來源未必包含「定位完成」，但同時具備基地台段落與定位欄位時可安全視為同一筆。
    const hasSingleRecordFragment = hasBaseStationSection && (hasLocatorMetadata || hasAzimuth);

    return hasCompleteResponse || hasPortalRecords || hasSingleRecordFragment;
}

// 將國際格式門號轉為既有介面使用的 09 格式
function normalizePhone(phone) {
    if (!phone) return "";
    const digits = String(phone).replace(/\D/g, "");
    return digits.startsWith("8869") ? "0" + digits.substring(3) : digits;
}

// 日期時間解析器 (支援民國紀年轉西元與 ISO/標準日期，防止 Invalid Date 造成排序失控)
function parseDateTimeToMs(str) {
    if (!str) return 0;
    let normalized = String(str).trim();
    const rocMatch = normalized.match(/^(\d{2,3})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?))?/);
    if (rocMatch) {
        const yearNum = parseInt(rocMatch[1], 10);
        if (yearNum < 1900) {
            const adYear = yearNum + 1911;
            const timePart = rocMatch[4] || "00:00:00";
            normalized = `${adYear}/${rocMatch[2].padStart(2, '0')}/${rocMatch[3].padStart(2, '0')} ${timePart}`;
        }
    }
    const ms = Date.parse(normalized.replace(/-/g, "/"));
    return isNaN(ms) ? 0 : ms;
}
