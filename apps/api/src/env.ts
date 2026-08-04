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
/**
 * ¿Está permitido este origen?
 *
 * Acepta comodín en el subdominio (`https://*.ventafacil.com`), que es imprescindible
 * cuando cada cliente entra por el suyo: listar los orígenes uno a uno obligaría a
 * redeplegar el API cada vez que se da de alta un negocio.
 *
 * El comodín cubre UN nivel (`[^.]+`), así que `https://*.ventafacil.com` deja pasar a
 * `llantas.ventafacil.com` pero no a `a.b.ventafacil.com` ni a `ventafacil.com.malo.io`.
 */
export function originPermitido(origin: string, patrones: string[]): boolean {
  return patrones.some((patron) => {
    if (!patron.includes('*')) return patron === origin;
    const re = new RegExp(
      '^' +
        patron
          .split('*')
          .map((parte) => parte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^.]+') +
        '$',
    );
    return re.test(origin);
  });
}

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

/**
 * Secreto con el que se firman los tokens del panel de plataforma.
 *
 * Es DISTINTO del de los negocios a propósito: un token de tenant firmado con el
 * secreto de siempre no puede verificarse como token de plataforma, pase lo que pase
 * con sus claims. Son dos llaves para dos puertas.
 *
 * En producción es obligatorio y el API no arranca sin él. Un valor por defecto aquí
 * no sería "inseguro por descuido" como en otros sitios: sería una llave maestra
 * pública para ver y suspender los datos de TODOS los clientes.
 */
function resolvePlatformSecret(): string {
  const secret = process.env.JWT_PLATFORM_SECRET;
  if (nodeEnv === 'production') {
    if (!secret) {
      throw new Error(
        'JWT_PLATFORM_SECRET es obligatoria en produccion: firma los tokens del panel ' +
          'de plataforma, que ve y administra TODOS los negocios. Genera uno largo y ' +
          'aleatorio (openssl rand -base64 48) y no lo reutilices de JWT_ACCESS_SECRET.',
      );
    }
    if (secret === process.env.JWT_ACCESS_SECRET) {
      throw new Error(
        'JWT_PLATFORM_SECRET no puede ser igual a JWT_ACCESS_SECRET: si comparten llave, ' +
          'la separacion entre el token de un negocio y el de la plataforma desaparece.',
      );
    }
    return secret;
  }
  return secret ?? 'dev_platform_secret_cambiame';
}

export const env = {
  port: Number(process.env.API_PORT ?? 3000),
  nodeEnv,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_cambiame',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev_refresh_secret_cambiame',
  jwtPlatformSecret: resolvePlatformSecret(),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  /** Sesión del panel más corta: es la cuenta con más alcance de todo el sistema. */
  jwtPlatformTtl: process.env.JWT_PLATFORM_TTL ?? '8h',
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
