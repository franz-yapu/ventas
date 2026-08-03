const nodeEnv = process.env.NODE_ENV ?? 'development';

/**
 * Orígenes permitidos por CORS.
 *
 * En producción se exige la lista explícita: con `origin: true` (aceptar cualquier
 * origen) una web hostil puede hacer peticiones autenticadas contra el API desde el
 * navegador de un usuario logueado. Si falta la variable el API no arranca — es
 * preferible un fallo ruidoso al desplegar que un agujero silencioso en marcha.
 *
 * Fuera de producción se deja abierto para no estorbar en desarrollo y tests.
 */
function resolveCorsOrigins(): string[] | true {
  const list = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (nodeEnv === 'production') {
    if (list.length === 0) {
      throw new Error(
        'CORS_ORIGINS es obligatoria en produccion. Indica los origenes del frontend ' +
          'separados por coma. Ej: CORS_ORIGINS=https://vertexweb.lat,https://www.vertexweb.lat',
      );
    }
    return list;
  }
  return list.length > 0 ? list : true;
}

export const env = {
  port: Number(process.env.API_PORT ?? 3000),
  nodeEnv,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_cambiame',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret_cambiame',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  corsOrigins: resolveCorsOrigins(),

  /**
   * Tope general por IP. Generoso a propósito: en una tienda todas las cajas salen por
   * la misma IP y la PWA consulta catálogo y sincroniza en segundo plano. Es un freno
   * contra el abuso, no un control del tráfico normal.
   */
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 600),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW ?? '1 minute',

  /**
   * Límite del login, mucho más estricto: es el endpoint que se ataca por fuerza bruta.
   * 20 intentos cada 5 minutos por IP sobran para un equipo que teclea mal, y vuelven
   * inviable probar contraseñas a ciegas.
   */
  loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 20),
  loginRateLimitWindow: process.env.LOGIN_RATE_LIMIT_WINDOW ?? '5 minutes',
};
