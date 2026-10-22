/* 樣式以 Tailwind CLI 預先編譯成 css/tailwind.css（執行與發布不需要 Node.js）。
 * 改了版面類別或色票後執行 npm run build:css，並一併提交 css/tailwind.css。 */
module.exports = {
    content: ['./index.html', './js/*.js'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'Noto Sans TC', 'sans-serif'],
            },
            colors: {
                primary: '#2B364B',
                accent: '#526F94',
                bg: '#F3F5F8',
                line: '#52745F',
                tg: '#2AABEE',
                copy: '#9A90A8',
                del: '#B96E72',
                gray: '#DCE5EF',
            },
        },
    },
};
