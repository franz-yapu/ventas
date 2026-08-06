/**
 * La zona horaria en la que opera el negocio.
 *
 * Estaba escrita dentro de `analytics.ts`, y por eso el historial de caja no la usaba: allí
 * el "hasta" se comparaba contra `T23:59:59.999Z`, o sea las 19:59 locales. Filtrar "hasta
 * hoy" perdía todos los turnos abiertos después de las ocho de la tarde — justo los de la
 * noche, que son los que uno revisa a la mañana siguiente.
 *
 * Es una constante y no una columna del negocio porque hoy todos los clientes están en
 * Bolivia. El día que haya uno fuera, esto es el único sitio que hay que mirar.
 */
export const TZ = 'America/La_Paz';
