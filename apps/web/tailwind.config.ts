import type { Config } from 'tailwindcss';

/**
 * Un token de color que ADEMÁS acepta el modificador de opacidad (`ring-primary/40`).
 *
 * Escribir `'var(--color-primary)'` a secas parece funcionar, pero Tailwind no sabe
 * meterle un alfa a un valor que no entiende, así que ante `/40` **descartaba la utilidad
 * entera y en silencio**: ni error, ni regla en el CSS. Eran 29 clases muertas repartidas
 * por la app — entre ellas el anillo de foco, que caía al azul por defecto de Tailwind y
 * dejaba a todos los negocios con el foco de teclado de otra marca.
 *
 * Como función, Tailwind nos pasa el alfa cuando lo hay, y así sólo la variante con
 * opacidad mezcla: en un WebView viejo sin `color-mix` se pierde un tinte de hover, no el
 * color de la aplicación.
 *
 * El detalle que hay que respetar: sin modificador Tailwind NO pasa `undefined`, pasa su
 * propia variable (`var(--tw-bg-opacity, 1)`). Si se toma eso por un alfa de verdad, el
 * caso normal —que son casi todas las clases de la app— también acaba envuelto en
 * `color-mix`, y entonces el navegador que no lo entienda se queda sin colores en vez de
 * sin un hover. Un alfa real siempre llega como número literal, así que el `var(` de
 * Tailwind es la señal de "aquí no hay modificador".
 *
 * (La otra salida sería guardar los tokens como canales sueltos, `47 104 216`, pero eso
 * obliga a que todo lo que hoy escribe un hexadecimal en `--color-primary` —el tema del
 * negocio, en caliente— aprenda otro formato. Más superficie rota por el mismo resultado.)
 */
const token =
  (nombre: string) =>
  ({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined || opacityValue.includes('var(')
      ? `var(${nombre})`
      : `color-mix(in srgb, var(${nombre}) calc(${opacityValue} * 100%), transparent)`;

// Colores mapeados a variables CSS que ThemeProvider llena desde theme_json (white-label).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: token('--color-primary'),
          fg: token('--color-primary-fg'),
          // Tinte y línea del primario, mezclados contra la superficie: en oscuro salen
          // oscuros solos, cosa que un `primary/10` fijo no hace.
          soft: token('--color-primary-soft'),
          line: token('--color-primary-line'),
        },
        secondary: {
          DEFAULT: token('--color-secondary'),
          fg: token('--color-secondary-fg'),
          soft: token('--color-secondary-soft'),
        },
        bg: token('--color-bg'),
        surface: token('--color-surface'),
        border: token('--color-border'),
        // El contorno de los controles (campos, selects, botón secundario). Ver el
        // comentario de `--color-field` en index.css: separador decorativo y contorno
        // de algo que se toca no son el mismo trabajo ni el mismo contraste.
        field: token('--color-field'),
        muted: token('--color-muted'),
        fg: token('--color-fg'),
        // `inv` = sobre una superficie invertida (fondo `--color-fg`), donde el
        // semántico normal se confunde con el fondo en uno de los dos modos.
        success: {
          DEFAULT: token('--color-success'),
          bg: token('--color-success-bg'),
          inv: token('--color-success-inv'),
        },
        danger: { DEFAULT: token('--color-danger'), bg: token('--color-danger-bg') },
        warning: {
          DEFAULT: token('--color-warning'),
          bg: token('--color-warning-bg'),
          inv: token('--color-warning-inv'),
        },
        info: { DEFAULT: token('--color-info'), bg: token('--color-info-bg') },
        // Superficies de apoyo. Existen como token para que el modo oscuro las cambie
        // en un sitio, en vez de repartir hexadecimales por las pantallas.
        'table-head': token('--color-table-head'),
        track: token('--color-track'),
        'icon-dim': token('--color-icon-dim'),
      },
      /**
       * El color de marca COMO TEXTO se separa del color de marca como relleno.
       *
       * `bg-primary` y `border-primary` siguen dando el color exacto que eligió el
       * negocio —ahí es el protagonista, y el texto encima ya se calcula—. `text-primary`
       * pasa a dar la variante ajustada para que se lea sobre la superficie, que en modo
       * claro es idéntica y en oscuro se aclara lo justo.
       *
       * Se hace aquí, y no renombrando la clase en las 19 pantallas que la usan, porque
       * las 19 quieren exactamente esto: enlaces, el ítem activo del menú, importes
       * marcados. Ninguna quiere un `text-primary` ilegible.
       */
      textColor: {
        primary: {
          DEFAULT: token('--color-primary-ink'),
          fg: token('--color-primary-fg'),
          soft: token('--color-primary-soft'),
          line: token('--color-primary-line'),
        },
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
        'card-hover': 'var(--shadow-card-hover)',
      },
    },
  },
  plugins: [],
} satisfies Config;
