/**
 * Reglas del subdominio de cada negocio.
 *
 * Viven aquí y no en el frontend porque las usan los dos lados: la web para deducir el
 * negocio del hostname y para avisar mientras se teclea en el alta, y el API para
 * rechazar un slug prohibido. Si cada uno tuviera su lista, tarde o temprano
 * dejarían pasar cosas distintas.
 */

/**
 * Subdominios que son de la plataforma, no de un negocio. Un cliente que se llamara
 * `admin` se quedaría con la dirección del panel; uno llamado `api`, con la del API.
 */
export const SUBDOMINIOS_RESERVADOS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'staging',
  'mail',
  'correo',
  'blog',
  'ayuda',
  'soporte',
  'status',
  'cdn',
  'assets',
  'static',
  'dev',
  'test',
  'demo',
  'registro',
  'plataforma',
]);

export const SLUG_MIN = 3;
export const SLUG_MAX = 30;

/**
 * Minúsculas, números y guiones interiores. Sin guion al principio ni al final (un
 * hostname no lo admite) y sin dos guiones seguidos al inicio (`xn--` es el prefijo
 * de los dominios internacionalizados).
 */
const FORMATO = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type SlugError =
  | 'corto'
  | 'largo'
  | 'formato'
  | 'reservado'
  | 'guiones';

/** `null` si el slug es válido; si no, el motivo. */
export function validarSlug(slug: string): SlugError | null {
  if (slug.length < SLUG_MIN) return 'corto';
  if (slug.length > SLUG_MAX) return 'largo';
  if (!FORMATO.test(slug)) return 'formato';
  if (slug.includes('--')) return 'guiones';
  if (SUBDOMINIOS_RESERVADOS.has(slug)) return 'reservado';
  return null;
}

export const MENSAJE_SLUG: Record<SlugError, string> = {
  corto: `La dirección debe tener al menos ${SLUG_MIN} caracteres.`,
  largo: `La dirección no puede pasar de ${SLUG_MAX} caracteres.`,
  formato: 'Usa sólo letras minúsculas, números y guiones.',
  guiones: 'No uses dos guiones seguidos.',
  reservado: 'Esa dirección está reservada. Elige otra.',
};

/** Convierte un nombre de negocio en un slug propuesto: "Llantas El Rápido" -> "llantas-el-rapido". */
export function slugDesdeNombre(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}
