/* 基地台調閱文字的解析輔助：方位角驗證、入口網站回覆辨識、文字與門號正規化、日期時間（含民國年）轉換。
 * 純函式：不讀寫 DOM、地圖、儲存，也不依賴 app.js 的任何變數。
 * 由 js/app.js 逐字拆出（內容未修改）。以傳統 <script> 載入（離線雙擊 index.html 也能運作），
 * 必須在 js/app.js 之前載入。回歸測試：tests/parser.test.js。 */

// 台灣經緯度的合理範圍：解析時用來判斷哪個數字是緯度、哪個是經度，並拒絕範圍外的座標。
// 這是邊界預設值的唯一定義處；app.js 的 DEFAULT_CONFIG 取用它，並在每次呼叫時把「當下的 config」傳入下列函式的選用參數 cfg
//（使用者儲存的設定可覆寫邊界，所以不能在此保存副本）。
const PARSER_DEFAULT_BOUNDS = { boundsLatMin: 21, boundsLatMax: 27, boundsLngMin: 118, boundsLngMax: 124 };

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

// DMS (度分秒) / DMM (度小數分) 轉十進位度數 (DD) 轉換器
function parseDMSToDD(text, cfg = PARSER_DEFAULT_BOUNDS) {
    const results = [];
    // 1. 度分秒 (DMS) 匹配模式 (如 23°04'15.2"N 120°23'40.8"E 或 23d04m15.2s N)
    const dmsRegex = /([NSEWnsew])?\s*(\d{1,3})[°度d\s]\s*(\d{1,2})['分m\s]\s*(\d{1,2}(?:\.\d+)?)[″"秒s]?\s*([NSEWnsew])?/g;
    const dmsMatches = [...text.matchAll(dmsRegex)];

    if (dmsMatches.length >= 2) {
        const coords = [];
        dmsMatches.forEach(m => {
            const dir = (m[1] || m[5] || '').toUpperCase();
            const deg = parseFloat(m[2]);
            const min = parseFloat(m[3]);
            const sec = parseFloat(m[4]);
            let dd = deg + (min / 60) + (sec / 3600);
            if (dir === 'S' || dir === 'W') dd = -dd;
            coords.push({ dd, dir });
        });

        let lat = null, lng = null;
        coords.forEach(c => {
            if (c.dir === 'N' || c.dir === 'S') lat = c.dd;
            else if (c.dir === 'E' || c.dir === 'W') lng = c.dd;
            else {
                if (c.dd >= cfg.boundsLatMin && c.dd <= cfg.boundsLatMax && !lat) lat = c.dd;
                else if (c.dd >= cfg.boundsLngMin && c.dd <= cfg.boundsLngMax && !lng) lng = c.dd;
            }
        });

        if (lat !== null && lng !== null) {
            results.push({ lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) });
        }
    }

    // 2. 度小數分 (DMM) 匹配模式 (如 23°04.2533'N 120°23.6800'E)
    if (results.length === 0) {
        const dmmRegex = /([NSEWnsew])?\s*(\d{1,3})[°度d\s]\s*(\d{1,2}(?:\.\d+)?)['分m]?\s*([NSEWnsew])?/g;
        const dmmMatches = [...text.matchAll(dmmRegex)];
        if (dmmMatches.length >= 2) {
            const coords = [];
            dmmMatches.forEach(m => {
                const dir = (m[1] || m[4] || '').toUpperCase();
                const deg = parseFloat(m[2]);
                const minDec = parseFloat(m[3]);
                let dd = deg + (minDec / 60);
                if (dir === 'S' || dir === 'W') dd = -dd;
                coords.push({ dd, dir });
            });

            let lat = null, lng = null;
            coords.forEach(c => {
                if (c.dir === 'N' || c.dir === 'S') lat = c.dd;
                else if (c.dir === 'E' || c.dir === 'W') lng = c.dd;
                else {
                    if (c.dd >= cfg.boundsLatMin && c.dd <= cfg.boundsLatMax && !lat) lat = c.dd;
                    else if (c.dd >= cfg.boundsLngMin && c.dd <= cfg.boundsLngMax && !lng) lng = c.dd;
                }
            });

            if (lat !== null && lng !== null) {
                results.push({ lat: parseFloat(lat.toFixed(6)), lng: parseFloat(lng.toFixed(6)) });
            }
        }
    }

    return results;
}

// 從指定標題區段擷取經緯度，避免基地臺與 GMLC 座標互相混用
function parsePortalCoordinateSection(block, sectionPattern, endPattern, cfg = PARSER_DEFAULT_BOUNDS) {
    const sectionMatch = block.match(new RegExp(
        `(?:${sectionPattern})[：:\\s]*([\\s\\S]*?)(?=${endPattern}|$)`,
        "i"
    ));
    if (!sectionMatch) return null;
    const targetText = sectionMatch[0];

    let lat = null, lng = null;

    // 模式 1: 關鍵字分別搜尋 (支援細胞經緯度/經緯度/Lat/Lng)
    const lngMatch = targetText.match(/(?:細胞經度|經度|Longitude|Lng)\s*[：:]?\s*(-?\d{1,3}(?:\.\d+)?)/i);
    const latMatch = targetText.match(/(?:細胞緯度|緯度|Latitude|Lat)\s*[：:]?\s*(-?\d{1,2}(?:\.\d+)?)/i);
    if (latMatch && lngMatch) {
        lat = parseFloat(latMatch[1]);
        lng = parseFloat(lngMatch[1]);
    } else {
        // 模式 2: 成對座標 (例如: 基地臺經緯度: 25.033, 121.565)
        const pairMatch = targetText.match(/(2[1-7]\.[0-9]+)[^0-9\.]+(1(?:1[8-9]|2[0-4])\.[0-9]+)/) ||
                          targetText.match(/(1(?:1[8-9]|2[0-4])\.[0-9]+)[^0-9\.]+(2[1-7]\.[0-9]+)/);
        if (pairMatch) {
            const v1 = parseFloat(pairMatch[1]);
            const v2 = parseFloat(pairMatch[2]);
            lat = v1 < 100 ? v1 : v2;
            lng = v1 < 100 ? v2 : v1;
        }
    }

    if (lat === null || lng === null) return null;
    if (lat < cfg.boundsLatMin || lat > cfg.boundsLatMax ||
        lng < cfg.boundsLngMin || lng > cfg.boundsLngMax) {
        return null;
    }
    return { lat, lng };
}

// 解析入口網站回覆；輸出沿用既有 towers 結構，降低對地圖與歷史功能的影響
function parsePortalResponse(text, fallbackPhone, cfg = PARSER_DEFAULT_BOUNDS) {
    let recordStarts = [...text.matchAll(
        /^\s*(?:\|?\s*(\d+)\s*\|?\s*(?:\r?\n\s*)?)?(?:即時定位\s*(?:\||\r?\n)?\s*)?(定位完成|定位成功|無法定位)(?=\s|\||$)/gm
    )];
    if (recordStarts.length === 0) {
        const statusMatch = text.match(/(?:即時定位\s+)?(定位完成|定位成功|無法定位)/);
        if (statusMatch) {
            recordStarts = [{ index: 0, 1: "1", 2: statusMatch[1] }];
        } else {
            const implicitStarts = [...text.matchAll(/(?:定位請求的時間|定位請求時間|請求定位時間|Positioning Request|detected\s+at)\s*[：:]?/gi)];
            if (implicitStarts.length === 1) {
                // 英文來源的 detected at 可能位在座標之後；單筆時從全文開始保留完整關聯。
                recordStarts = [{ index: 0, 1: "1", 2: "定位完成" }];
            } else if (implicitStarts.length > 1) {
                recordStarts = implicitStarts.map((match, index) => ({
                    index: match.index,
                    1: String(index + 1),
                    2: "定位完成"
                }));
            } else {
                const towerStarts = [...text.matchAll(/(?:基地[臺台]資訊|基地[臺台]編號|細胞經度)/g)];
                if (towerStarts.length > 1) {
                    recordStarts = towerStarts.map((match, index) => ({
                        index: match.index,
                        1: String(index + 1),
                        2: "定位完成"
                    }));
                } else if (/基地[臺台](?:資訊|經緯度|座標|位置)|細胞(?:資訊|經緯度|座標|經度)|Base\s*Station\s*(?:Coordinates?|Location)/i.test(text)) {
                    recordStarts = [{ index: 0, 1: "1", 2: "定位完成" }];
                }
            }
        }
    }
    const declaredMatch = text.match(/定位紀錄筆數\s*[：:]?\s*(\d+)\s*筆/);
    const targetMatch = text.match(/(?:調閱目標資訊|申請用戶帳號)\s*[：:]?\s*(8869\d{8}|09\d{8})/);
    const globalPhone = normalizePhone(targetMatch ? targetMatch[1] : fallbackPhone);
    const records = [];
    let completedCount = 0;
    let failedCount = 0;
    let missingTowerCount = 0;
    let missingAzimuthCount = 0;
    let invalidAzimuthCount = 0;

    recordStarts.forEach((start, index) => {
        const end = index + 1 < recordStarts.length ? recordStarts[index + 1].index : text.length;
        const block = text.slice(start.index, end);
        const statusText = start[2];
        const isSuccess = statusText === "定位完成" || statusText === "定位成功";
        if (isSuccess) completedCount += 1;
        else failedCount += 1;

        const reqMatch = block.match(/(?:定位請求的時間|定位請求時間|請求定位時間|Positioning Request|detected\s+at)\s*[：:]?\s*(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/i);
        const respMatch = block.match(/(?:定位回應的時間|定位回應時間|回應定位時間)\s*[：:]?\s*(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/);
        const regMatch = block.match(/(?:註冊基地[臺台]時間|最後註冊時間|基地[臺台]註冊時間)\s*[：:]?\s*(\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})/);
        const towerIdMatch = block.match(/(?:基地[臺台]編號|註冊基地[臺台]編號|Tower[- ]?ID)\s*[：:]?\s*([A-Za-z0-9_-]+)/i);
        const cellMatch = block.match(/(?:細胞編號|Cell[- ]?ID)\s*[：:]?\s*(\d+)/i);
        const addrMatch = block.match(/(?:細胞地址|基地[臺台]地址|門牌地址|地址)\s*[：:]?\s*([^\r\n]+)/);
        const azMatch = block.match(/(?:定位基地[臺台]方向角|基地[臺台](?:方向角|方位角)|天線方位角|Azimuth|Bearing|Dir)\s*[：:]?\s*(-?\d+(?:\.\d+)?)/i);
        const phoneMatch = block.match(/(?:行動電話號碼|行動電話|門號)\s*[：:]?\s*(8869\d{8}|09\d{8})/);
        const tower = parsePortalCoordinateSection(
            block,
            "基地[臺台](?:資訊|經緯度|座標|位置)|細胞(?:資訊|經緯度|座標|經度)|Base\\s*Station\\s*(?:Coordinates?|Location)",
            "三角定位\\s*[（(]?GMLC[）)]?經緯度|行動電話號碼",
            cfg
        );
        const gmlc = parsePortalCoordinateSection(
            block,
            "三角定位\\s*[（(]?GMLC[）)]?經緯度",
            "行動電話號碼|用戶在國內|尚未收到業者回覆",
            cfg
        );

        // 無法定位或缺少有效基地臺座標的紀錄保留於統計，但不送入既有地圖繪製
        if (!isSuccess) return;
        if (!tower) {
            missingTowerCount += 1;
            return;
        }

        const rawAzimuth = azMatch ? parseFloat(azMatch[1]) : null;
        if (rawAzimuth === null) missingAzimuthCount += 1;
        else if (!isValidAzimuth(rawAzimuth)) invalidAzimuthCount += 1;

        records.push({
            lat: tower.lat,
            lng: tower.lng,
            azi: isValidAzimuth(rawAzimuth) ? rawAzimuth : null,
            phone: normalizePhone(phoneMatch ? phoneMatch[1] : globalPhone),
            reqTime: reqMatch ? reqMatch[1].replace(/-/g, "/") : "",
            responseTime: respMatch ? respMatch[1].replace(/-/g, "/") : "",
            regTime: regMatch ? regMatch[1].replace(/-/g, "/") : "",
            sequence: (start[1] && !isNaN(parseInt(start[1], 10))) ? parseInt(start[1], 10) : (index + 1),
            towerId: towerIdMatch ? towerIdMatch[1] : "",
            cellId: cellMatch ? cellMatch[1] : "",
            address: addrMatch ? addrMatch[1].trim() : "",
            status: statusText,
            gmlcLat: gmlc ? gmlc.lat : null,
            gmlcLng: gmlc ? gmlc.lng : null
        });
    });

    // 去重保護：僅當座標、方位角、時間、基地台編號、細胞編號完全一致時才視為重複
    const uniqueRecords = [];
    records.forEach((r) => {
        const isDup = uniqueRecords.some(item =>
            Math.abs(item.lat - r.lat) < 0.00001 &&
            Math.abs(item.lng - r.lng) < 0.00001 &&
            item.azi === r.azi &&
            (item.reqTime || item.regTime) === (r.reqTime || r.regTime) &&
            ((!item.towerId && !r.towerId) || item.towerId === r.towerId) &&
            ((!item.cellId && !r.cellId) || item.cellId === r.cellId)
        );
        if (!isDup) uniqueRecords.push(r);
    });

    return {
        records: uniqueRecords,
        declaredCount: declaredMatch ? parseInt(declaredMatch[1], 10) : recordStarts.length,
        parsedCount: recordStarts.length,
        completedCount,
        failedCount,
        missingTowerCount,
        missingAzimuthCount,
        invalidAzimuthCount
    };
}
