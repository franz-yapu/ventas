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
  'dev_platform_secret_cambiame',
  'cambia_esto_en_produccion',
  // Sigue en la lista aunque `JWT_REFRESH_SECRET` ya no exista: es un literal público que
  // anda escrito en los `.env` viejos, y nada impide pegarlo en la variable de al lado.
  'dev_refresh_secret_cambiame',
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

/**
 * Credenciales de Gmail (OAuth2) para el driver de correo alternativo a Resend.
 *
 * Son las cuatro o ninguna: con tres de las cuatro no se envía nada, y el motivo
 * —«falta el refresh token»— sólo se descubriría al primer registro fallido. Se
 * comprueba al arrancar, en cualquier entorno, porque una configuración a medias es
 * casi siempre un olvido, no una decisión.
 */
const gmail = {
  clientId: process.env.GMAIL_CLIENT_ID ?? '',
  clientSecret: process.env.GMAIL_CLIENT_SECRET ?? '',
  refreshToken: process.env.GMAIL_REFRESH_TOKEN ?? '',
  user: process.env.GMAIL_USER ?? '',
};
const partesGmail = Object.entries(gmail);
const gmailCompleto = partesGmail.every(([, v]) => v !== '');
if (!gmailCompleto && partesGmail.some(([, v]) => v !== '')) {
  const faltan = partesGmail
    .filter(([, v]) => v === '')
    .map(([k]) => 'GMAIL_' + k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase())
    .join(', ');
  throw new Error(
    `Configuracion de Gmail incompleta: falta ${faltan}. Con las cuatro variables el ` +
      'correo sale por Gmail; sin ninguna, por Resend o por el log. A medias no sale, y ' +
      'no se nota hasta que alguien se registra.',
  );
}

const resendApiKey = process.env.RESEND_API_KEY ?? '';

/**
 * Qué driver de correo va a usarse. Resend manda si está configurado; Gmail es el
 * suplente para pruebas. Se decide aquí, una vez, en vez de en cada envío, para poder
 * anunciarlo al arrancar: si no, saber por dónde salen los correos exige leer código.
 */
export const correoDriver: 'resend' | 'gmail' | 'consola' = resendApiKey
  ? 'resend'
  : gmailCompleto
    ? 'gmail'
    : 'consola';

/**
 * Sin driver de correo, los mensajes se escriben en el log en vez de enviarse.
 *
 * En producción eso no es un modo de desarrollo, es una avería silenciosa: quien se
 * registra nunca recibe el enlace de verificación, quien olvida su contraseña nunca
 * recibe el de restablecimiento, y ninguno de los dos sabe por qué. Se comprueba al
 * arrancar, igual que CORS_ORIGINS y los secretos.
 */
if (nodeEnv === 'production' && correoDriver === 'consola') {
  throw new Error(
    'Falta configurar el correo: define RESEND_API_KEY, o las cuatro GMAIL_* ' +
      '(CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, USER). Sin ninguna de las dos los ' +
      'correos NO se envian, se escriben en el log del servidor, y quien se registre o ' +
      'pida restablecer su contrasena esperara un correo que nunca sale.',
  );
}

/*
  `||` y no `??`: en Docker, una variable declarada y sin valor llega como cadena VACÍA,
  no como ausente. Con `??` esa cadena ganaría al valor por defecto y el remitente sería
  la nada — que con Gmail ni siquiera arranca, y con Resend manda un `from` vacío.
*/
const emailFrom =
  process.env.EMAIL_FROM ||
  (correoDriver === 'gmail' ? `VentaFácil <${gmail.user}>` : 'VentaFácil <no-responder@localhost>');

/*
  Gmail no deja mentir en el remitente: manda SIEMPRE como la cuenta autenticada, y si
  el `From:` dice otra cosa lo reescribe sin avisar. Un EMAIL_FROM que no coincida con
  GMAIL_USER, entonces, no es una preferencia que se ignora: es un valor que parece
  aplicarse y no se aplica. Mejor no arrancar que descubrirlo mirando la cabecera de un
  correo que ya recibió un cliente.
*/
if (correoDriver === 'gmail') {
  const direccion = (/<([^>]+)>/.exec(emailFrom)?.[1] ?? emailFrom).trim().toLowerCase();
  if (direccion !== gmail.user.trim().toLowerCase()) {
    throw new Error(
      `EMAIL_FROM (${direccion}) no coincide con GMAIL_USER (${gmail.user}). Gmail envia ` +
        'siempre como la cuenta autenticada y reescribiria el remitente en silencio. Usa ' +
        `EMAIL_FROM="Nombre <${gmail.user}>" o una direccion de "enviar como" de esa cuenta.`,
    );
  }
}

export const env = {
  port: Number(process.env.API_PORT ?? 3000),
  nodeEnv,
  /**
   * La llave que firma los tokens de un negocio: el de acceso Y el de refresco.
   *
   * Hubo un `JWT_REFRESH_SECRET` que no firmaba nada. Estaba en `.env.example`, estaba en
   * `env`, y ni una sola línea lo usaba: los dos tokens se firman con esta y lo que los
   * distingue es el claim `typ`, que se comprueba en las dos direcciones —`requireAuth`
   * rechaza un refresh, y `/auth/refresh` rechaza un access—. Se quitó en vez de
   * implementarlo: una variable que promete separar dos llaves y no separa nada es peor
   * que no tenerla, porque quien la rota cree haber rotado algo.
   *
   * La separación que SÍ importa —negocio contra plataforma— es real y tiene su propia
   * llave: ver `resolvePlatformSecret`.
   */
  jwtAccessSecret: resolverSecreto(
    'JWT_ACCESS_SECRET',
    process.env.JWT_ACCESS_SECRET,
    'dev_access_secret_cambiame',
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

  /**
   * Dónde se guardan las imágenes que suben los clientes.
   *
   * En Docker es un VOLUMEN, no una carpeta dentro del contenedor: si vive dentro, cada
   * despliegue se lleva por delante las fotos de todos los negocios. Es de las cosas que
   * sólo se descubren la segunda vez que se despliega.
   */
  mediaDir: process.env.MEDIA_DIR ?? './media',

  // ── Correo transaccional ─────────────────────────────────────
  /**
   * Cuál de los tres drivers de `mailer.ts` está activo, y con qué credenciales. La
   * elección y las comprobaciones están arriba, junto a las variables: aquí sólo se
   * exponen ya resueltas.
   */
  correoDriver,
  resendApiKey,
  gmail,
  emailFrom,
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

  /**
   * Cuántos proxies hay delante del API (`TRUST_PROXY`). En el servidor el API está
   * detrás de Traefik y del nginx de la web; sin esto, Fastify ve la IP del proxy en
   * todas las peticiones y los límites por IP pasan a ser de TODA la plataforma: cinco
   * altas por hora en total, veinte intentos de login cada cinco minutos para todos
   * los negocios juntos. En el servidor: `TRUST_PROXY=loopback,uniquelocal`. Ver
   * `leerTrustProxy`.
   */
  trustProxy: leerTrustProxy(process.env.TRUST_PROXY),

  /** Cuánto valen los enlaces que van por correo. */
  resetTokenTtlMin: Number(process.env.RESET_TOKEN_TTL_MIN ?? 60),
  verifyTokenTtlHours: Number(process.env.VERIFY_TOKEN_TTL_HOURS ?? 72),
};

/**
 * `TRUST_PROXY` → la opción `trustProxy` de Fastify: de qué direcciones vienen los
 * proxies en los que se confía para leer X-Forwarded-For.
 *
 * - vacía o `false`: no se confía en nadie (desarrollo, o el API expuesto directo).
 * - lista de IPs, rangos o nombres de `proxy-addr`, separados por coma. En el servidor
 *   Traefik y el nginx de la web llegan por la red interna de Docker, así que
 *   **`loopback,uniquelocal`** (127/8, 10/8, 172.16/12, 192.168/16…). Un cliente de
 *   Internet nunca llega desde una dirección privada, así que no puede colarse por ahí:
 *   Fastify recorre la cabecera de derecha a izquierda y se queda con la primera IP que
 *   no es de un proxy de confianza, que es la que puso Traefik.
 * - `true`: se confía en cualquier X-Forwarded-For. **No usar en producción**: el
 *   cliente podría inventarse la IP en la cabecera y saltarse los límites.
 *
 * Un número (saltos de proxy) se rechaza al arrancar: desde Fastify 5.12 la cuenta de
 * saltos "falla cerrada" y no confía en nadie, así que parecería configurado sin estarlo.
 */
export function leerTrustProxy(valor: string | undefined): boolean | string {
  const v = (valor ?? '').trim();
  if (v === '' || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) {
    throw new Error(
      `TRUST_PROXY=${v}: Fastify ya no acepta un número de saltos (no confiaría en nadie). ` +
        'Usa la lista de redes de los proxies, p. ej. TRUST_PROXY=loopback,uniquelocal',
    );
  }
  return v;
}

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
