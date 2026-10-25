/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        page: "var(--page)",
        surface: "var(--surface)",
        "surface-border": "var(--surface-border)",
        "surface-hover": "var(--surface-hover)",
        "text-primary": "var(--text)",
        "text-muted": "var(--text-muted)",
        "custom-event": "var(--custom-event)",
        "dark-base": "#0b0f19",
      },
      boxShadow: {
        "exam-glow": "var(--exam-glow)",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
