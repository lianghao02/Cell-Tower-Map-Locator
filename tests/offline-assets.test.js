'use strict';
// 離線與隱私底線：頁面不得載入外部 CDN；index.html 用到的本機資源都要在預快取清單內且檔案存在；
// Service Worker 不得把跨來源（地圖圖磚）請求寫進快取。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const precache = [...sw.match(/PRECACHE_ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);

test('index.html 不載入任何外部腳本、樣式或字型', () => {
    const external = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(external, []);
    assert.doesNotMatch(html, /cdn\.tailwindcss\.com|fonts\.googleapis|upload\.wikimedia/);
});

test('index.html 引用的本機腳本與樣式都在預快取清單內，且檔案存在', () => {
    const local = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^":]+)"/g)].map((m) => m[1])
        .filter((u) => !u.startsWith('data:') && !u.startsWith('#') && !u.endsWith('.webmanifest') && !u.endsWith('.png'));
    assert.ok(local.length >= 8, '應找到本機資源：' + local.join(','));
    for (const file of local) {
        assert.ok(precache.includes(file), file + ' 未列入 sw.js 預快取');
    }
    for (const file of precache.filter((f) => f && !f.endsWith('/'))) {
        assert.ok(fs.existsSync(path.join(root, file)), 'sw.js 預快取的檔案不存在：' + file);
    }
});

test('Service Worker 只處理本站 GET 請求，不快取跨來源圖磚', () => {
    assert.match(sw, /url\.origin !== self\.location\.origin/);
    assert.doesNotMatch(sw, /openstreetmap|arcgisonline|nlsc/);
});

test('預快取的 Font Awesome 樣式不引用不存在的字型檔', () => {
    const css = fs.readFileSync(path.join(root, 'vendor/fontawesome/css/all.min.css'), 'utf8');
    for (const m of css.matchAll(/url\(\.\.\/webfonts\/([^)]+)\)/g)) {
        assert.ok(fs.existsSync(path.join(root, 'vendor/fontawesome/webfonts', m[1])), '缺少字型 ' + m[1]);
    }
});
