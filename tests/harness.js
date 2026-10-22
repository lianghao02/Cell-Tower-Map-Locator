'use strict';
// 測試用載入器：在 Node 的 vm 沙盒中載入 js/app.js（瀏覽器程式），並以萬用替身取代 DOM 與 Leaflet。
// 不修改正式程式碼；只在載入時於「公開介面」前插入一行，把內部函式匯出給測試使用。
// 若 app.js 的結構改變，載入會明確失敗而不是默默通過。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const EXPORTS = [
    'parseDMSToDD', 'normalizeInputText', 'isPortalResponse', 'normalizePhone', 'parseDateTimeToMs',
    'parsePortalCoordinateSection', 'parsePortalResponse', 'parse', 'calculateBearing', 'isAngleWithinSector',
    'isValidAzimuth', 'esc', 'ensureCCW', 'clipPolygon', 'intersectMultipleConvexPolygons',
    'computePolygonAreaM2', 'computePolygonCentroid', 'PARSER_DEFAULT_BOUNDS'
];

// 萬用替身：任何屬性、呼叫都回傳替身自己，可安全當作 DOM 或 Leaflet 物件。
function anything(overrides = {}) {
    const store = { ...overrides };
    const handler = {
        get(target, prop) {
            if (prop in store) return store[prop];
            if (prop === Symbol.toPrimitive) return () => 0;
            if (prop === 'then') return undefined;
            if (prop === 'length') return 0;
            if (prop === Symbol.iterator) return function* () {};
            return proxy;
        },
        set(target, prop, value) { store[prop] = value; return true; },
        apply() { return proxy; },
        construct() { return proxy; },
        has() { return true; }
    };
    const proxy = new Proxy(function () {}, handler);
    return proxy;
}

// 從 app.js 拆出的純函式模組（傳統 script，需在 app.js 之前載入）；檔案存在才載入，順序與 index.html 一致。
const MODULES = ['geometry.js', 'parser.js'];

function loadApp() {
    let src = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
    const marker = '// 公開介面 (Public API)';
    const at = src.indexOf(marker);
    if (at < 0) throw new Error('找不到公開介面標記，app.js 結構已改變');
    const hook = `globalThis.__t = { ${EXPORTS.join(', ')}, getData: () => data, getConfig: () => config };\n            `;
    src = src.slice(0, at) + hook + src.slice(at);

    const elements = {};
    const document = anything({
        getElementById: (id) => (elements[id] ||= anything({ value: '', innerText: '', innerHTML: '', classList: anything() })),
        querySelector: () => anything(),
        querySelectorAll: () => [],
        createElement: () => anything(),
        addEventListener: () => {},
        body: anything()
    });
    const store = {};
    const sandbox = {
        console: { log() {}, error() {}, warn() {}, info() {} },
        document,
        L: anything(),
        navigator: anything({ clipboard: anything(), geolocation: anything() }),
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        alert: (message) => { sandbox.__alerts.push(String(message)); },
        __alerts: [],
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
        matchMedia: () => anything({ matches: false }),
        innerWidth: 1200, innerHeight: 800,
        Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, Error, parseFloat, parseInt, isNaN, Promise
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    for (const name of MODULES) {
        const file = path.join(ROOT, 'js', name);
        if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: name });
    }
    vm.runInContext(src, sandbox, { filename: 'app.js' });
    if (!sandbox.__t) throw new Error('測試匯出失敗');
    return { t: sandbox.__t, elements, alerts: sandbox.__alerts };
}

// 以貼上文字執行完整 parse()。parse() 後半段會呼叫地圖與介面更新（已用替身取代）。
function runParse(app, text) {
    app.alerts.length = 0;
    app.elements.rawInput = anything({ value: text });
    try {
        app.t.parse();
    } catch (error) {
        // 地圖與介面更新使用替身，若在資料寫入後才失敗，不影響本測試要驗證的解析結果。
        app.lastError = error;
    }
    return { data: app.t.getData(), alerts: app.alerts.slice() };
}

module.exports = { loadApp, runParse };
