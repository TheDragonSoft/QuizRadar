/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "#1a73e8",
        "accent-hover": "#1557b0",
        "custom-event": "#db2777",
        "dark-base": "#0b0f19",
      },
      boxShadow: {
        "exam-glow": "0 3px 10px rgba(220, 38, 38, 0.14)",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
