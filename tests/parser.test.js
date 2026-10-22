'use strict';
// 基地台調閱文字解析與扇形交集回歸測試。全部使用虛構的門號、基地臺編號與座標，不含任何真實資料。
// 目的：鎖住已確認的解析行為（入口網站回覆、中華電信換行排版、DMS／DMM、民國日期、去重、方位角驗證），
// 以及扇形交集的幾何計算，防止日後修改時默默改壞。
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, runParse } = require('./harness');

const app = loadApp();
const { t } = app;
// 沙盒（vm）內建立的物件與測試檔屬於不同執行環境，嚴格比較前先轉成純 JSON。
const plain = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);
const near = (a, b, tolerance, m) => assert.ok(Math.abs(a - b) <= tolerance, `${m || ''} ${a} 與 ${b} 差距超過 ${tolerance}`);

// 入口網站完整回覆的合成範本（單筆）。
function portalRecord({ seq = 1, status = '定位完成', req = '2026/10/01 08:00:00', reg = '2026/10/01 07:59:00', tower = 'T001', cell = '12', az = 120, lat = 25.033, lng = 121.565, phone = '0912345678', gmlc = true } = {}) {
    return [
        `${seq} 即時定位 ${status}`,
        `定位請求的時間：${req}`,
        `定位回應的時間：${req.replace(/:\d\d$/, ':05')}`,
        `註冊基地臺時間：${reg}`,
        `基地臺編號：${tower}`,
        `細胞編號：${cell}`,
        `細胞地址：測試市測試區測試路${seq}號`,
        az === null ? '' : `定位基地臺方向角：${az}`,
        '基地臺經緯度：',
        `細胞經度：${lng}`,
        `細胞緯度：${lat}`,
        gmlc ? '三角定位(GMLC)經緯度：\n經度：121.5000\n緯度：25.0000' : '',
        `行動電話號碼：${phone}`,
        ''
    ].filter((line) => line !== '').join('\n');
}
function portalResponse(records, declared) {
    return ['回覆資訊：', '調閱目標資訊：0912345678', `定位紀錄筆數：${declared ?? records.length}筆`, '定位記錄：', '序號 定位類別 定位狀態', ...records].join('\n');
}

// ---------- 基礎函式 ----------
test('方位角必須是 0 到 360 的數字', () => {
    for (const v of [0, 120, 360, '45.5']) assert.equal(t.isValidAzimuth(v), true, String(v));
    for (const v of [-1, 361, NaN, 'abc', Infinity]) assert.equal(t.isValidAzimuth(v), false, String(v));
});

test('輸入文字正規化：換行、<br> 與不換行空白', () => {
    assert.equal(t.normalizeInputText('甲\r\n乙<br>丙<BR/>丁 戊'), '甲\n乙\n丙\n丁 戊');
    assert.equal(t.normalizeInputText(null), '');
});

test('門號正規化：國際格式轉 09 格式', () => {
    assert.equal(t.normalizePhone('886912345678'), '0912345678');
    assert.equal(t.normalizePhone('+886-912-345-678'), '0912345678');
    assert.equal(t.normalizePhone('0912345678'), '0912345678');
    assert.equal(t.normalizePhone(''), '');
});

test('日期解析支援民國年與西元，無效日期回傳 0', () => {
    const roc = t.parseDateTimeToMs('115/10/01 08:00:00');
    const ad = t.parseDateTimeToMs('2026/10/01 08:00:00');
    assert.equal(roc, ad, '民國 115 年等於西元 2026 年');
    assert.equal(t.parseDateTimeToMs('2026-10-01 08:00:00'), ad, '連字號格式');
    assert.equal(t.parseDateTimeToMs('不是日期'), 0);
    assert.equal(t.parseDateTimeToMs(''), 0);
});

test('HTML 跳脫，防止資料被當成標籤', () => {
    assert.equal(t.esc('<img src=x onerror="a">&'), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;');
    assert.equal(t.esc(null), '');
});

// ---------- 座標格式 ----------
test('度分秒（DMS）座標轉十進位', () => {
    const r = t.parseDMSToDD('25°01\'58.8"N 121°33\'54.0"E');
    assert.equal(r.length, 1);
    near(r[0].lat, 25.033, 0.0001, '緯度');
    near(r[0].lng, 121.565, 0.0001, '經度');
});

test('度分（DMM）座標轉十進位', () => {
    const r = t.parseDMSToDD('N 25°01.98\' E 121°33.9\'');
    assert.equal(r.length, 1);
    near(r[0].lat, 25.033, 0.0001);
    near(r[0].lng, 121.565, 0.0001);
});

test('單一數字不會被誤判為座標', () => {
    eq(t.parseDMSToDD('只有一個 25.033 數字'), []);
});

// ---------- 入口網站回覆解析 ----------
test('單筆入口網站回覆：欄位完整擷取', () => {
    const text = portalResponse([portalRecord()]);
    assert.equal(t.isPortalResponse(text), true);
    const r = t.parsePortalResponse(text, '');
    assert.equal(r.records.length, 1);
    const rec = r.records[0];
    assert.equal(rec.lat, 25.033);
    assert.equal(rec.lng, 121.565);
    assert.equal(rec.azi, 120);
    assert.equal(rec.phone, '0912345678');
    assert.equal(rec.towerId, 'T001');
    assert.equal(rec.cellId, '12');
    assert.equal(rec.reqTime, '2026/10/01 08:00:00');
    assert.equal(rec.regTime, '2026/10/01 07:59:00');
    assert.match(rec.address, /測試路1號/);
    assert.equal(rec.gmlcLat, 25);
    assert.equal(rec.gmlcLng, 121.5);
    assert.equal(r.declaredCount, 1);
});

test('多筆回覆：成功與失敗分開統計，失敗紀錄不繪製', () => {
    const text = portalResponse([
        portalRecord({ seq: 1 }),
        portalRecord({ seq: 2, status: '無法定位', tower: 'T002', lat: 25.2, req: '2026/10/01 08:30:00' }),
        portalRecord({ seq: 3, tower: 'T003', lat: 25.04, req: '2026/10/01 09:00:00' })
    ]);
    const r = t.parsePortalResponse(text, '');
    assert.equal(r.parsedCount, 3);
    assert.equal(r.completedCount, 2);
    assert.equal(r.failedCount, 1);
    assert.equal(r.records.length, 2);
    eq(r.records.map((x) => x.sequence), [1, 3]);
});

test('缺少基地臺座標的成功紀錄只列入統計', () => {
    const noTower = portalRecord({ seq: 2 }).replace(/基地臺經緯度：[\s\S]*?(?=三角定位)/, '');
    const text = portalResponse([portalRecord({ seq: 1 }), noTower]);
    const r = t.parsePortalResponse(text, '');
    assert.equal(r.records.length, 1);
    assert.equal(r.missingTowerCount, 1);
});

test('方位角缺少或超出範圍：不採用並分別計數', () => {
    const text = portalResponse([
        portalRecord({ seq: 1, az: null }),
        portalRecord({ seq: 2, az: 999, tower: 'T002', lat: 25.05 })
    ]);
    const r = t.parsePortalResponse(text, '');
    assert.equal(r.records.length, 2);
    assert.equal(r.records[0].azi, null);
    assert.equal(r.records[1].azi, null);
    assert.equal(r.missingAzimuthCount, 1);
    assert.equal(r.invalidAzimuthCount, 1);
});

test('座標超出台灣範圍的紀錄不會被採用（緯度、經度各自檢查）', () => {
    for (const [lat, lng] of [[35.0, 121.5], [25.0, 139.0], [35.0, 139.0], [10.0, 121.5], [25.0, 100.0]]) {
        const r = t.parsePortalResponse(portalResponse([portalRecord({ lat, lng })]), '');
        assert.equal(r.records.length, 0, `${lat},${lng}`);
        assert.equal(r.missingTowerCount, 1, `${lat},${lng}`);
    }
});

// ---------- 座標界線（config 由 app.js 每次呼叫時傳入） ----------
test('app 的 DEFAULT_CONFIG 界線取自 parser.js 的唯一定義', () => {
    for (const key of ['boundsLatMin', 'boundsLatMax', 'boundsLngMin', 'boundsLngMax']) {
        assert.equal(t.getConfig()[key], t.PARSER_DEFAULT_BOUNDS[key], key);
    }
});

test('選用參數 cfg 可覆寫座標界線；省略時使用預設界線', () => {
    const narrow = { boundsLatMin: 30, boundsLatMax: 40, boundsLngMin: 118, boundsLngMax: 124 };
    // 界線只在「沒有 N／E 字母」時用來分辨緯度與經度，所以測試輸入不帶字母（DMS 與 DMM 兩個分支都檢查）。
    for (const [label, text] of [['DMS', `25°01'58.8" 121°33'54.0"`], ['DMM', `25°01.98' 121°33.9'`]]) {
        assert.equal(t.parseDMSToDD(text).length, 1, `${label} 預設界線`);
        assert.equal(t.parseDMSToDD(text, narrow).length, 0, `${label} 緯度落在自訂界線外`);
        assert.equal(t.parseDMSToDD(text, t.PARSER_DEFAULT_BOUNDS).length, 1, `${label} 明確傳入預設值`);
    }
    const text = portalResponse([portalRecord({ lat: 25.033, lng: 121.565 })]);
    assert.equal(t.parsePortalResponse(text, '').records.length, 1, '預設界線');
    const r = t.parsePortalResponse(text, '', narrow);
    assert.equal(r.records.length, 0, '自訂界線會一路傳到基地臺座標檢查');
    assert.equal(r.missingTowerCount, 1);
});

test('去重：完全相同的紀錄只留一筆，細胞編號或方位角不同則保留', () => {
    const same = portalResponse([portalRecord({ seq: 1 }), portalRecord({ seq: 2 })]);
    assert.equal(t.parsePortalResponse(same, '').records.length, 1, '完全相同');
    const otherCell = portalResponse([portalRecord({ seq: 1 }), portalRecord({ seq: 2, cell: '13' })]);
    assert.equal(t.parsePortalResponse(otherCell, '').records.length, 2, '同基地臺不同細胞');
    const otherAz = portalResponse([portalRecord({ seq: 1 }), portalRecord({ seq: 2, az: 240 })]);
    assert.equal(t.parsePortalResponse(otherAz, '').records.length, 2, '同基地臺不同方位角');
});

test('中華電信排版：序號與狀態分行、以直線分隔', () => {
    const block = [
        '| 1 |', '即時定位 | 定位完成',
        '定位請求的時間：2026/10/01 08:00:00',
        '基地臺編號：C100', '細胞編號：7',
        '天線方位角：45',
        '基地臺經緯度：', '細胞經度：121.5', '細胞緯度：25.02',
        '行動電話號碼：0912345678'
    ].join('\n');
    const text = ['回覆資訊：', '定位記錄：', '序號 定位類別 定位狀態', block].join('\n');
    assert.equal(t.isPortalResponse(text), true);
    const r = t.parsePortalResponse(text, '');
    assert.equal(r.records.length, 1);
    assert.equal(r.records[0].towerId, 'C100');
    assert.equal(r.records[0].azi, 45);
    assert.equal(r.records[0].lat, 25.02);
});

test('英文來源：Azimuth 與 detected at', () => {
    const text = [
        'Base Station Coordinates:', 'Latitude: 25.02', 'Longitude: 121.55',
        'Azimuth: 90', 'detected at 2026/10/01 08:00:00', 'Tower-ID: E9'
    ].join('\n');
    assert.equal(t.isPortalResponse(text), true);
    const r = t.parsePortalResponse(text, '0912345678');
    assert.equal(r.records.length, 1);
    assert.equal(r.records[0].azi, 90);
    assert.equal(r.records[0].towerId, 'E9');
    assert.equal(r.records[0].phone, '0912345678');
});

test('一般座標文字不會被當成入口網站回覆', () => {
    assert.equal(t.isPortalResponse('25.033, 121.565'), false);
    assert.equal(t.isPortalResponse('今天天氣很好'), false);
});

// ---------- 完整解析流程 parse() ----------
test('parse()：自由文字的十進位座標、門號與時間', () => {
    const r = runParse(loadApp(), '行動電話號碼：0912345678\n25.0330, 121.5650\n方位角：120');
    assert.equal(r.alerts.length, 0);
    assert.equal(r.data.towers.length, 1);
    assert.equal(r.data.lat, 25.033);
    assert.equal(r.data.lng, 121.565);
    assert.equal(r.data.phone, '0912345678');
});

test('parse()：沒有可用座標時提示使用者，不寫入資料', () => {
    const r = runParse(loadApp(), '完全沒有座標的文字');
    assert.equal(r.data.towers.length, 0);
    assert.ok(r.alerts.some((m) => m.includes('找不到有效的台灣座標')));
});

test('parse()：空白輸入提示先貼上內容', () => {
    const r = runParse(loadApp(), '');
    assert.ok(r.alerts.some((m) => m.includes('請先貼上內容')));
});

test('parse()：超過 5 筆只載入最新 5 筆，並依請求時間排序', () => {
    const records = [];
    for (let i = 1; i <= 7; i++) {
        records.push(portalRecord({ seq: i, tower: `T${i}`, lat: 25 + i / 100, req: `2026/10/0${i} 08:00:00` }));
    }
    // 故意打亂順序，驗證排序後再截取最新 5 筆
    const shuffled = [records[3], records[0], records[6], records[2], records[5], records[1], records[4]];
    const r = runParse(loadApp(), portalResponse(shuffled));
    assert.equal(r.data.towers.length, 5);
    eq(r.data.towers.map((x) => x.towerId), ['T3', 'T4', 'T5', 'T6', 'T7']);
});

test('parse()：民國年日期排序正確', () => {
    const a = portalRecord({ seq: 1, tower: 'A', req: '2026/10/02 08:00:00' });
    const b = portalRecord({ seq: 2, tower: 'B', lat: 25.05, req: '2026/10/01 08:00:00' });
    const r = runParse(loadApp(), portalResponse([a, b]));
    eq(r.data.towers.map((x) => x.towerId), ['B', 'A']);
});

// ---------- 方位與扇形幾何 ----------
test('方位角計算：正北、正東、正南、正西', () => {
    near(t.calculateBearing(25, 121, 26, 121), 0, 0.01, '北');
    near(t.calculateBearing(25, 121, 25, 122), 90, 0.5, '東');
    near(t.calculateBearing(25, 121, 24, 121), 180, 0.01, '南');
    near(t.calculateBearing(25, 121, 25, 120), 270, 0.5, '西');
    assert.equal(t.calculateBearing(25, 121, 25, 121), 0, '同一點不產生 NaN');
});

test('扇形夾角判斷：含跨 360 度', () => {
    assert.equal(t.isAngleWithinSector(100, 120, 60), true);
    assert.equal(t.isAngleWithinSector(160, 120, 60), false);
    assert.equal(t.isAngleWithinSector(350, 10, 60), true, '350 與 10 相差 20 度');
    assert.equal(t.isAngleWithinSector(180, 0, 60), false);
});

test('兩個重疊正方形的交集面積與重心', () => {
    const a = [[0, 0], [0, 2], [2, 2], [2, 0]];
    const b = [[1, 1], [1, 3], [3, 3], [3, 1]];
    const inter = t.intersectMultipleConvexPolygons([a, b]);
    assert.ok(inter && inter.length >= 3);
    const c = t.computePolygonCentroid(inter);
    near(c[0], 1.5, 1e-6);
    near(c[1], 1.5, 1e-6);
});

test('完全不相交的多邊形交集為 null；單一多邊形原樣回傳', () => {
    const a = [[0, 0], [0, 1], [1, 1], [1, 0]];
    const far = [[5, 5], [5, 6], [6, 6], [6, 5]];
    assert.equal(t.intersectMultipleConvexPolygons([a, far]), null);
    eq(t.intersectMultipleConvexPolygons([a]), a);
    assert.equal(t.intersectMultipleConvexPolygons([]), null);
});

test('三個多邊形的共同交集', () => {
    const a = [[0, 0], [0, 4], [4, 4], [4, 0]];
    const b = [[1, 1], [1, 5], [5, 5], [5, 1]];
    const c = [[2, 2], [2, 6], [6, 6], [6, 2]];
    const inter = t.intersectMultipleConvexPolygons([a, b, c]);
    const centroid = t.computePolygonCentroid(inter);
    near(centroid[0], 3, 1e-6);
    near(centroid[1], 3, 1e-6);
});

test('多邊形面積（公尺）：台北緯度 0.001 度見方約 111 × 101 公尺', () => {
    const lat = 25.0;
    const d = 0.001;
    const square = [[lat, 121.0], [lat + d, 121.0], [lat + d, 121.0 + d], [lat, 121.0 + d]];
    const area = t.computePolygonAreaM2(square);
    const expected = 111.32 * (111.32 * Math.cos((lat + d / 2) * Math.PI / 180));
    near(area, expected, expected * 0.01, '面積');
    assert.equal(t.computePolygonAreaM2([[0, 0], [1, 1]]), 0, '少於三點為 0');
});
