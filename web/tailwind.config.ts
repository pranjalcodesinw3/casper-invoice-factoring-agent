import type { Config } from "tailwindcss";

/* The underwriting desk.
 *
 * This palette is deliberately NOT the dark-violet-glass look every other
 * agent dashboard reaches for. An underwriting desk is a credit terminal: paper
 * and ink, ledger rules, one accent reserved for money at risk. The surface is
 * a warm near-black rather than blue-black, so the amber accent reads as brass
 * and ledger ink instead of neon.
 *
 * One accent (amber) plus two semantics (approve/decline) and nothing else.
 * Colour never carries meaning alone anywhere in this UI; every state is also
 * a word.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Warm near-black. Not #000: pure black kills the paper feel. */
        desk: {
          950: "#fffaf2",
          900: "#ffffff",
          800: "#fff3df",
          700: "#eadbc5",
          600: "#d7c4a9",
        },
        ink: {
          DEFAULT: "#24180d",
          muted: "#735f4c",
          faint: "#927b63",
        },
        /* The single accent. Used for money at risk and primary actions. */
        brass: {
          DEFAULT: "#ff9f1c",
          bright: "#ffb84d",
          dim: "#c06d00",
        },
        approve: "#11845b",
        decline: "#c73b32",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        /* Ledger figures want a tighter scale than a marketing page. */
        "fig-sm": ["0.8125rem", { lineHeight: "1.15rem" }],
        "fig": ["1.0625rem", { lineHeight: "1.35rem" }],
        "fig-lg": ["1.75rem", { lineHeight: "2rem", letterSpacing: "-0.02em" }],
        "fig-xl": ["2.5rem", { lineHeight: "2.6rem", letterSpacing: "-0.03em" }],
      },
      borderRadius: {
        /* Squarer than the usual rounded-2xl. Terminals are not pills. */
        desk: "4px",
      },
      boxShadow: {
        raise: "0 1px 0 rgba(255,255,255,0.8) inset, 0 18px 50px -28px rgba(70,44,15,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
