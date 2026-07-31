/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1020",
        panel: "#111a33",
        brand: "#38bdf8",
        gold: "#fbbf24",
      },
    },
  },
  plugins: [],
};
