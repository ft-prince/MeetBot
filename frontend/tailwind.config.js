/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'app-bg': '#F6F8FB',
        accent: {
          DEFAULT: '#2F55D4',
          hover: '#2444B0',
          light: '#EEF2FD',
        },
        ink: '#0F172A',
        muted: '#64748B',
        success: '#047857',
        warning: '#B45309',
        danger: '#B91C1C',
      },
      // Global radius scale override — squares off every existing `rounded-*`
      // class at once so the app reads corporate rather than consumer. `full`
      // is untouched so pills and avatars stay circular.
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '3px',
        md: '4px',
        lg: '5px',
        xl: '6px',
        '2xl': '8px',
        '3xl': '10px',
        full: '9999px',
        // Marketing site only — three steps, nothing between them.
        btn: '8px',
        card: '12px',
        frame: '16px',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
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
