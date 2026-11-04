/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        app: "#F7F8FC",
        surface: "#FFFFFF",
        heading: "#0F172A",
        body: "#334155",
        muted: "#64748B",
        border: "#E2E8F0",
        primary: {
          DEFAULT: "#4F46E5",
          hover: "#4338CA",
          light: "#EEF2FF",
        },
        accent: {
          DEFAULT: "#0D9488",
          hover: "#0F766E",
          light: "#F0FDFA",
        },
        warning: {
          DEFAULT: "#D97706",
          light: "#FFFBEB",
        },
        error: {
          DEFAULT: "#E11D48",
          light: "#FFF1F2",
        },
        brand: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#4F46E5",
          600: "#4338CA",
          700: "#3730A3",
          800: "#312E81",
          900: "#1E1B4B",
        },
      },
      borderRadius: {
        card: "12px",
        btn: "10px",
        pill: "9999px",
      },
      boxShadow: {
        soft: "0 1px 3px rgba(15, 23, 42, 0.08)",
        card: "0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
        "card-hover": "0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)",
        dropdown: "0 10px 30px -5px rgba(15, 23, 42, 0.12)",
        panel: "0 20px 40px -10px rgba(15, 23, 42, 0.15)",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        heading: ["Inter", "Plus Jakarta Sans", "Outfit", "sans-serif"],
      },
    },
  },
  plugins: [],
};
