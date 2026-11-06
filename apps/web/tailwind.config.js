/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-fill": "var(--accent-fill)",
        "accent-fill-hover": "var(--accent-fill-hover)",
        "accent-ink": "var(--accent-ink)",
        page: "var(--page)",
        surface: "var(--surface)",
        "surface-elevated": "var(--surface-elevated)",
        "surface-border": "var(--surface-border)",
        "border-strong": "var(--border-strong)",
        "border-subtle": "var(--border-subtle)",
        border: "var(--border)",
        "surface-hover": "var(--surface-hover)",
        "text-primary": "var(--text)",
        "text-muted": "var(--text-muted)",
        "custom-event": "var(--custom-event)",
        "dark-base": "#070a12",
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
