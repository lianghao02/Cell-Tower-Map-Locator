'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, anything } = require('./harness');

// 使用只有真實可用 API 的 MediaQueryList 替身，避免萬用替身掩蓋相容性問題。
for (const legacy of [false, true]) {
    for (const sharedLink of [false, true]) {
        test(`${legacy ? '舊式' : '現代'} MediaQueryList：${sharedLink ? '分享連結' : '空白'}啟動與尺寸切換`, () => {
            const calls = [];
            let handler;
            const layout = { matches: true };
            if (legacy) {
                layout.addListener = (callback) => { calls.push('legacy'); handler = callback; };
            } else {
                layout.addEventListener = (event, callback) => {
                    assert.equal(event, 'change'); calls.push('modern'); handler = callback;
                };
                layout.addListener = () => assert.fail('現代 API 可用時不應重複註冊舊 API');
            }
            const errors = [];
            const app = loadApp({
                matchMedia: () => layout,
                location: { search: '', hash: sharedLink ? '#lat=25.033&lng=121.565' : '' },
                URLSearchParams,
                addEventListener: () => {},
                console: { error: (...args) => errors.push(args), log() {}, warn() {}, info() {} },
                L: anything({ map: () => { calls.push('map'); return anything(); } }),
                NLSC_TILE_URL: 'https://example.invalid/{z}/{x}/{y}.png'
            });
            app.elements['tabMenu'] = anything({
                before: (anchor) => { anchor.after = () => calls.push('desktop'); }
            });
            app.elements['tab-btn-parse'] = anything({ classList: anything({ add: () => calls.push('parse') }) });
            app.elements['tab-btn-base'] = anything({ classList: anything({ add: () => calls.push('base') }) });
            app.document.body.append = (menu) => {
                assert.equal(menu, app.elements.tabMenu);
                calls.push('mobile');
            };
            app.t.init();
            assert.deepEqual(errors, [], '初始化不得提早跳入錯誤處理');
            assert.equal(calls[0], legacy ? 'legacy' : 'modern');
            assert.equal(typeof handler, 'function');
            assert.equal(calls.filter(call => call === 'mobile').length, 1, '啟動即將導航移至手機底部');
            assert.ok(calls.includes('map'), '事件註冊後必須繼續初始化地圖');
            assert.ok(calls.includes(sharedLink ? 'base' : 'parse'), '必須選取正確初始分頁');
            assert.equal(app.t.getData().lat, sharedLink ? 25.033 : null);
            layout.matches = false;
            handler();
            assert.ok(calls.includes('desktop'), '切回桌面時導航必須回到錨點');
            layout.matches = true;
            handler();
            assert.equal(calls.filter(call => call === 'mobile').length, 2, '切回手機時再次移動導航');
        });
    }
}
