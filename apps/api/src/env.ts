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
 * Los valores que trae `.env.example`. Están escritos en el repositorio, así que como
 * secreto valen exactamente lo mismo que no tener ninguno: cualquiera que vea el código
 * puede firmar un token de administrador de cualquier negocio.
 *
 * Se listan aquí para poder RECHAZARLOS explícitamente. Comprobar sólo que la variable
 * "está definida" no basta: copiar el `.env.example` entero y arrancar es justo lo que
 * hace todo el mundo el primer día.
 */
const SECRETOS_DE_EJEMPLO = new Set([
  'dev_access_secret_cambiame',
  'dev_refresh_secret_cambiame',
  'dev_platform_secret_cambiame',
  'cambia_esto_en_produccion',
]);

/** Lo mínimo que se acepta en producción. Descarta las claves tecleadas a mano. */
const LARGO_MINIMO_SECRETO = 32;

/**
 * Resuelve un secreto de firma, exigiéndolo de verdad en producción.
 *
 * Antes `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` caían a un valor por defecto también
 * en producción, y ese valor es el literal que está en `.env.example`. Un despliegue que
 * olvidara definirlos firmaba los tokens de TODOS los negocios con una llave pública y
 * arrancaba en silencio, como si nada. El criterio es el mismo que ya se aplicaba a
 * `CORS_ORIGINS` y a `JWT_PLATFORM_SECRET`: **un fallo ruidoso al desplegar es preferible
 * a un agujero callado en marcha**, porque el primero se arregla en un minuto y el
 * segundo no se descubre hasta que alguien lo usa.
 *
 * Fuera de producción se cae al valor de desarrollo para no estorbar.
 */
export function resolverSecreto(
  nombre: string,
  valor: string | undefined,
  porDefecto: string,
  entorno: string = nodeEnv,
): string {
  if (entorno !== 'production') return valor || porDefecto;

  if (!valor) {
    throw new Error(
      `${nombre} es obligatoria en produccion: con ella se firman los tokens de sesion. ` +
        'Genera una larga y aleatoria (openssl rand -base64 48).',
    );
  }
  if (SECRETOS_DE_EJEMPLO.has(valor)) {
    throw new Error(
      `${nombre} tiene el valor de ejemplo del repositorio, que es publico: con el, ` +
        'cualquiera puede firmarse un token de administrador de cualquier negocio. ' +
        'Genera uno propio (openssl rand -base64 48).',
    );
  }
  if (valor.length < LARGO_MINIMO_SECRETO) {
    throw new Error(
      `${nombre} es demasiado corta (${valor.length} caracteres, minimo ${LARGO_MINIMO_SECRETO}). ` +
        'Genera una larga y aleatoria (openssl rand -base64 48).',
    );
  }
  return valor;
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
export function resolvePlatformSecret(entorno: string = nodeEnv): string {
  const secret = resolverSecreto(
    'JWT_PLATFORM_SECRET',
    process.env.JWT_PLATFORM_SECRET,
    'dev_platform_secret_cambiame',
    entorno,
  );
  if (entorno === 'production' && secret === process.env.JWT_ACCESS_SECRET) {
    throw new Error(
      'JWT_PLATFORM_SECRET no puede ser igual a JWT_ACCESS_SECRET: si comparten llave, ' +
        'la separacion entre el token de un negocio y el de la plataforma desaparece.',
    );
  }
  return secret;
}

export const env = {
  port: Number(process.env.API_PORT ?? 3000),
  nodeEnv,
  jwtAccessSecret: resolverSecreto(
    'JWT_ACCESS_SECRET',
    process.env.JWT_ACCESS_SECRET,
    'dev_access_secret_cambiame',
  ),
  jwtRefreshSecret: resolverSecreto(
    'JWT_REFRESH_SECRET',
    process.env.JWT_REFRESH_SECRET,
    'dev_refresh_secret_cambiame',
  ),
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

  /**
   * Registro y recuperación de contraseña: mucho más estrictos que el login.
   *
   * No es fuerza bruta lo que se frena aquí, sino el abuso del CORREO: sin tope, el
   * endpoint de "olvidé mi contraseña" es una máquina gratis para inundar el buzón de
   * cualquiera, y el de registro, para llenar la base de negocios basura.
   */
  registerRateLimitMax: Number(process.env.REGISTER_RATE_LIMIT_MAX ?? 5),
  registerRateLimitWindow: process.env.REGISTER_RATE_LIMIT_WINDOW ?? '1 hour',

  /**
   * Exportación completa del negocio: es una consulta pesada. Se topa para que no se
   * pueda usar como forma barata de castigar al servidor; un negocio no necesita
   * llevarse una copia entera cada minuto.
   */
  exportRateLimitMax: Number(process.env.EXPORT_RATE_LIMIT_MAX ?? 5),
  exportRateLimitWindow: process.env.EXPORT_RATE_LIMIT_WINDOW ?? '1 hour',

  // ── Correo transaccional ─────────────────────────────────────
  /** Sin clave, los correos se escriben en el log en vez de enviarse. Ver mailer.ts. */
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'VentaFácil <no-responder@localhost>',
  /**
   * URL de la app de un negocio. `{slug}` se sustituye por su subdominio.
   *
   * El puerto por defecto es el 5173, que es donde escucha Vite (`vite.config.ts`).
   * Cualquier otro deja los enlaces de los correos —verificar la cuenta, restablecer
   * la contraseña— apuntando a un puerto donde no hay nada.
   */
  appUrlTemplate: process.env.APP_URL_TEMPLATE ?? 'http://{slug}.localhost:5173',

  // ── Avisos de operación ──────────────────────────────────────
  /**
   * A dónde avisar cuando el servidor lanza errores. Vacío = no se avisa (sólo log).
   * Reutiliza el mismo mailer que los correos de los clientes: sin cuenta nueva.
   */
  alertEmail: process.env.ALERT_EMAIL ?? '',
  /** Ventana de agrupación: un correo por ventana, con la cuenta de lo que pasó. */
  alertWindowMin: Number(process.env.ALERT_WINDOW_MIN ?? 10),

  /** Cuánto valen los enlaces que van por correo. */
  resetTokenTtlMin: Number(process.env.RESET_TOKEN_TTL_MIN ?? 60),
  verifyTokenTtlHours: Number(process.env.VERIFY_TOKEN_TTL_HOURS ?? 72),
};

/**
 * Convierte la duración del refresh ('30d', '12h', '90m') a milisegundos, para que la
 * fila de la sesión caduque a la vez que el token que apunta a ella. Si divergieran, o
 * bien el token seguiría valiendo sin fila, o bien la fila quedaría viva de adorno.
 */
export function ttlRefreshMs(): number {
  const m = /^(\d+)\s*([smhd])$/.exec(env.jwtRefreshTtl.trim());
  if (!m) return 30 * 86_400_000; // el valor por defecto: 30 días
  const n = Number(m[1]);
  const unidad = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * unidad;
}
