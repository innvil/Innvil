import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Innvil design tokens
        gold: {
          DEFAULT: "#C9A574",
          light: "#E9CE9A",
          dark: "#A88A4D",
          soft: "rgba(201,165,116,0.10)",
          "soft-border": "rgba(201,165,116,0.20)",
        },
        violet: {
          DEFAULT: "#8B7FFF",
          light: "#A89FFF",
          dark: "#6B5FDF",
          soft: "rgba(139,127,255,0.12)",
          "soft-border": "rgba(139,127,255,0.35)",
        },
        safe: {
          DEFAULT: "#6FCF97",
          soft: "rgba(111,207,151,0.10)",
          "soft-border": "rgba(111,207,151,0.35)",
        },
        // Surface colors
        void: {
          DEFAULT: "#0A0B0F",
          2: "#0D0F14",
        },
        panel: {
          DEFAULT: "#14161D",
          raised: "#1B1E27",
        },
        line: {
          DEFAULT: "#262A35",
          soft: "#1E212A",
        },
        text: {
          DEFAULT: "#EDEAE2",
          dim: "#9497A3",
          faint: "#5C5F6B",
        },
      },
      fontFamily: {
        display: ["Fraunces", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      backgroundImage: {
        "noise": "radial-gradient(circle at 20% 20%,rgba(139,127,255,0.10),transparent 40%),radial-gradient(circle at 80% 0%,rgba(201,165,116,0.08),transparent 35%)",
        "grid-bg": "linear-gradient(rgba(255,255,255,0.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.028) 1px,transparent 1px)",
        "gold-gradient": "linear-gradient(120deg,#E9CE9A,#C9A574)",
        "grad-text": "linear-gradient(120deg,#E9CE9A 0%,#C9A574 45%,#8B7FFF 100%)",
      },
      backgroundSize: {
        "grid": "42px 42px",
      },
    },
  },
  plugins: [],
};

export default config;
