import type { Config } from 'tailwindcss'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: 'var(--surface)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        rise: 'var(--rise)',
        fall: 'var(--fall)',
        signal: 'var(--signal)',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['Inter', 'monospace'], // using inter tabular-nums where needed
      }
    },
  },
  plugins: [],
} satisfies Config
