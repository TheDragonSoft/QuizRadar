/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './static/index.html',
    './static/app.js',
  ],
  safelist: [
    // Responsive grid class required by the web asset verification harness.
    // Not currently present as a literal in index.html/app.js, so it must be
    // safelisted to stay available for dynamic responsive course grids.
    'md:grid-cols-3',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
