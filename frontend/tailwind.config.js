/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'app-bg': '#F4F6F9',
        accent: {
          DEFAULT: '#F06428',
          hover: '#D94E1C',
          light: '#FEF3EE',
        },
        ink: '#111827',
        muted: '#6B7280',
        success: '#059669',
        warning: '#D97706',
        danger: '#DC2626',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,.04)',
        'card-hover': '0 2px 8px rgba(0,0,0,.08)',
      },
      animation: {
        'pulse-slow': 'pulse 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
