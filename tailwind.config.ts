import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        panel: "1.25rem"
      },
      fontFamily: {
        rounded: ["Avenir Next", "Nunito Sans", "Manrope", "Aptos", "Segoe UI", "sans-serif"]
      },
      boxShadow: {
        soft: "0 24px 80px rgba(0, 0, 0, 0.28)"
      }
    }
  },
  plugins: []
};

export default config;
