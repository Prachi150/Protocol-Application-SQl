import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        border: "var(--app-border)",
        input: "var(--app-border-mid)",
        ring: "var(--app-accent)",
        background: "var(--app-bg)",
        foreground: "var(--app-text-1)",
        primary: {
          DEFAULT: "var(--app-accent)",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "var(--app-elevated)",
          foreground: "var(--app-text-1)",
        },
        destructive: {
          DEFAULT: "var(--app-danger)",
          foreground: "#FFFFFF",
        },
        muted: {
          DEFAULT: "var(--app-neutral-sub)",
          foreground: "var(--app-text-3)",
        },
        accent: {
          DEFAULT: "var(--app-accent)",
          foreground: "var(--app-text-1)",
        },
        success: {
          DEFAULT: "var(--app-success)",
          foreground: "#FFFFFF",
        },
        warning: {
          DEFAULT: "var(--app-warning)",
          foreground: "#FFFFFF",
        },
        popover: {
          DEFAULT: "var(--app-surface)",
          foreground: "var(--app-text-1)",
        },
        card: {
          DEFAULT: "var(--app-surface)",
          foreground: "var(--app-text-1)",
        },
        app: {
          bg:           'var(--app-bg)',
          surface:      'var(--app-surface)',
          elevated:     'var(--app-elevated)',
          border:       'var(--app-border)',
          'border-mid': 'var(--app-border-mid)',
          accent:       'var(--app-accent)',
          'accent-text':'var(--app-accent-text)',
          'accent-sub': 'var(--app-accent-sub)',
          'accent-border': 'var(--app-accent-border)',
          success:      'var(--app-success)',
          'success-sub': 'var(--app-success-sub)',
          warning:      'var(--app-warning)',
          'warning-sub': 'var(--app-warning-sub)',
          danger:       'var(--app-danger)',
          'danger-sub': 'var(--app-danger-sub)',
          'neutral-sub': 'var(--app-neutral-sub)',
          text1:        'var(--app-text-1)',
          text2:        'var(--app-text-2)',
          text3:        'var(--app-text-3)',
        },
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
