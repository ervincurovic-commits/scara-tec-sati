// Every palette the UI uses is routed through CSS variables so the light
// theme can remap shades without touching a single class in the markup.
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const themed = (name) =>
  Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      colors: {
        white: 'rgb(var(--white) / <alpha-value>)',
        black: 'rgb(var(--black) / <alpha-value>)',
        slate: themed('slate'),
        indigo: themed('indigo'),
        emerald: themed('emerald'),
        amber: themed('amber'),
        red: themed('red'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
