/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{html,js}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Noto Sans TC', 'sans-serif'],
      },
      colors: {
        primary: '#2c3e50',
        accent: '#d35400',
        bg: '#f4f6f7',
        line: '#06c755',
        tg: '#2481cc',
        copy: '#8e44ad',
        del: '#c0392b',
        gray: '#e0e0e0',
      }
    },
  },
  plugins: [],
}