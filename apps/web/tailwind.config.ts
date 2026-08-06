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
          // Tinte y línea del primario, mezclados contra la superficie: en oscuro salen
          // oscuros solos, cosa que un `primary/10` fijo no hace.
          soft: 'var(--color-primary-soft)',
          line: 'var(--color-primary-line)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          fg: 'var(--color-secondary-fg)',
          soft: 'var(--color-secondary-soft)',
        },
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
        muted: 'var(--color-muted)',
        fg: 'var(--color-fg)',
        success: { DEFAULT: 'var(--color-success)', bg: 'var(--color-success-bg)' },
        danger: { DEFAULT: 'var(--color-danger)', bg: 'var(--color-danger-bg)' },
        warning: { DEFAULT: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
        info: { DEFAULT: 'var(--color-info)', bg: 'var(--color-info-bg)' },
        // Superficies de apoyo. Existen como token para que el modo oscuro las cambie
        // en un sitio, en vez de repartir hexadecimales por las pantallas.
        'table-head': 'var(--color-table-head)',
        track: 'var(--color-track)',
        'icon-dim': 'var(--color-icon-dim)',
      },
      fontFamily: {
        sans: ['Onest', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        theme: 'var(--radius)',
        // Derivados del radio que elige el negocio: subirlo no descuadra las
        // proporciones entre una hoja, una tarjeta y un chip.
        'theme-sm': 'var(--radius-sm)',
        'theme-lg': 'var(--radius-lg)',
      },
      boxShadow: {
        // Sombra sutil para elevar las tarjetas del fondo (conserva el borde gris).
        // Es un token porque en oscuro tiene que ser MÁS negra: una sombra al 6% sobre
        // un fondo casi negro no se ve, y las tarjetas se aplanan contra el fondo.
        card: 'var(--shadow-card)',
        'card-hover': '0 4px 14px -4px rgba(0, 0, 0, 0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
