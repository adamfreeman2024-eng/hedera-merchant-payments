/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0f14",
        panel: "#131a22",
        edge: "#1f2a35",
        acc: "#4ade80",
        warn: "#fbbf24",
      },
    },
  },
  plugins: [],
};
