import type { Config } from 'tailwindcss';

// Colores mapeados a variables CSS que ThemeProvider llena desde theme_json (white-label).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary)',
          fg: 'var(--color-primary-fg)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          fg: 'var(--color-secondary-fg)',
        },
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
        muted: 'var(--color-muted)',
        fg: 'var(--color-fg)',
        success: { DEFAULT: 'var(--color-success)', bg: 'var(--color-success-bg)' },
        danger: { DEFAULT: 'var(--color-danger)', bg: 'var(--color-danger-bg)' },
        warning: { DEFAULT: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
      },
      fontFamily: {
        sans: ['Onest', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        theme: 'var(--radius)',
      },
      boxShadow: {
        // Sombra sutil para elevar las tarjetas del fondo (conserva el borde gris).
        card: '0 1px 3px 0 rgba(0, 0, 0, 0.06)',
        'card-hover': '0 4px 14px -4px rgba(0, 0, 0, 0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
