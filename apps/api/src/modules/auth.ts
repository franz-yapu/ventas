import { db, schema, withTenant } from '@ventafacil/db';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@ventafacil/shared';
import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { env, ttlRefreshMs } from '../env.js';
import { buscarToken, emitirToken, marcarUsado } from '../lib/auth-tokens.js';
import { enviarCorreo, urlDelNegocio } from '../lib/mailer.js';
import {
  crearSesion,
  limpiarSesionesViejas,
  marcarUso,
  revocarSesion,
  revocarTodo,
  sesionesDe,
  sesionViva,
  tokenSigueValiendo,
  versionDeTokens,
  vigenciaDelUsuario,
} from '../lib/sessions.js';
import type { AuthUser } from '../types.js';

/**
 * Resuelve el negocio por su slug. `business` queda fuera de RLS justamente porque hay
 * que saber de qué negocio se trata ANTES de poder fijar el contexto de tenant.
 *
 * Sin slug sólo vale cuando hay un único negocio (instalación de un solo cliente).
 * Devuelve `null` si no se puede resolver sin ambigüedad.
 */
async function resolverNegocio(slug?: string): Promise<string | null> {
  if (slug) {
    const [biz] = await db
      .select({ id: schema.business.id })
      .from(schema.business)
      .where(eq(schema.business.slug, slug))
      .limit(1);
    return biz?.id ?? null;
  }
  const businesses = await db.select({ id: schema.business.id }).from(schema.business).limit(2);
  return businesses.length === 1 ? businesses[0]!.id : null;
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login
  // Límite propio, mucho más estricto que el global: es el endpoint que se ataca por
  // fuerza bruta. Se cuenta por IP; el tope deja margen de sobra a quien teclea mal.
  const loginRateLimit = {
    rateLimit: { max: app.loginRateLimitMax, timeWindow: env.loginRateLimitWindow },
  };

  app.post('/auth/login', { config: loginRateLimit }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: 'Datos invalidos' });
    }
    const { username, password, business } = parsed.data;

    // Resolver el NEGOCIO (tenant) antes de buscar el usuario: los usernames son
    // únicos por negocio, así que sin acotar el negocio el login sería ambiguo.
    if (!business) {
      const cuantos = await db.select({ id: schema.business.id }).from(schema.business).limit(2);
      if (cuantos.length > 1) {
        return reply.code(400).send({ data: null, error: 'Indica el negocio para iniciar sesión' });
      }
    }
    const businessId = await resolverNegocio(business);
    if (!businessId) {
      return reply.code(401).send({ data: null, error: 'Usuario o contraseña incorrectos' });
    }

    // A partir de aqui ya se conoce el negocio, asi que las tablas bajo RLS se
    // consultan con el contexto fijado. `business` queda fuera de RLS justamente
    // porque hay que resolverla antes de tener tenant.
    const [user] = await withTenant(businessId, (tx) =>
      tx
        .select()
        .from(schema.appUser)
        .where(
          and(
            eq(schema.appUser.businessId, businessId),
            eq(schema.appUser.username, username),
            eq(schema.appUser.isActive, true),
          ),
        )
        .limit(1),
    );

    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return reply.code(401).send({ data: null, error: 'Usuario o contraseña incorrectos' });
    }

    // ¿Su ubicación es la central? -> puede ver todas las ubicaciones.
    let isCentral = false;
    if (user.locationId) {
      const [loc] = await withTenant(businessId, (tx) =>
        tx
          .select({ isCentral: schema.location.isCentral })
          .from(schema.location)
          .where(eq(schema.location.id, user.locationId!))
          .limit(1),
      );
      isCentral = loc?.isCentral ?? false;
    }

    const claims: AuthUser = {
      sub: user.id,
      businessId: user.businessId,
      locationId: user.locationId,
      isCentral,
      role: user.role,
      name: user.name,
    };
    // El refresh deja de ser autosuficiente: lleva el id de una fila de
    // `refresh_session`, que es lo que permite cortarlo en el acto.
    const jti = await crearSesion(businessId, user.id, ttlRefreshMs(), req.headers['user-agent']);
    const tv = await versionDeTokens(businessId, user.id);
    const accessToken = app.jwt.sign({ ...claims, typ: 'access', tv });
    const refreshToken = app.jwt.sign(
      { ...claims, typ: 'refresh', jti, tv },
      { expiresIn: env.jwtRefreshTtl },
    );
    limpiarSesionesViejas(businessId).catch((e) =>
      app.log.warn({ err: e }, 'limpieza de sesiones'),
    );

    await app.audit({ authUser: claims } as never, {
      action: 'login',
      entity: 'app_user',
      entityId: user.id,
    });

    return reply.send({
      data: { accessToken, refreshToken, user: claims },
      error: null,
    });
  });

  // POST /auth/refresh
  app.post('/auth/refresh', async (req, reply) => {
    const body = req.body as { refreshToken?: string } | undefined;
    if (!body?.refreshToken) {
      return reply.code(400).send({ data: null, error: 'Falta refreshToken' });
    }
    try {
      const payload = app.jwt.verify<AuthUser & { typ?: string; jti?: string; tv?: number }>(
        body.refreshToken,
      );
      if (payload.typ !== 'refresh') throw new Error('token no es refresh');

      // La firma ya no basta. Tienen que cumplirse las tres cosas:
      //   1. La sesión existe y no está revocada ni caducada.
      //   2. El usuario sigue activo (dar de baja a un empleado lo echa de verdad).
      //   3. El token lleva la versión vigente (no lo revocó un cambio de contraseña).
      if (!payload.jti) throw new Error('refresh sin sesión');
      const sesion = await sesionViva(payload.businessId, payload.jti);
      if (!sesion || sesion.userId !== payload.sub) throw new Error('sesión cerrada');

      const vigencia = await vigenciaDelUsuario(payload.businessId, payload.sub);
      if (!tokenSigueValiendo(vigencia, payload.tv)) throw new Error('usuario no vigente');

      const claims: AuthUser = {
        sub: payload.sub,
        businessId: payload.businessId,
        locationId: payload.locationId,
        isCentral: payload.isCentral ?? false,
        role: payload.role,
        name: payload.name,
      };
      const accessToken = app.jwt.sign({ ...claims, typ: 'access', tv: vigencia.tokenVersion });
      marcarUso(payload.businessId, payload.jti).catch(() => undefined);
      return reply.send({ data: { accessToken }, error: null });
    } catch {
      return reply.code(401).send({ data: null, error: 'Refresh token invalido' });
    }
  });

  /**
   * POST /auth/logout — cierra ESTA sesión de verdad, en el servidor.
   *
   * Antes, "cerrar sesión" sólo borraba los tokens del navegador: quien tuviera una
   * copia del refresh seguía entrando. No requiere estar autenticado: si el access ya
   * caducó, la persona igual quiere cerrar.
   */
  app.post('/auth/logout', async (req, reply) => {
    const body = req.body as { refreshToken?: string } | undefined;
    if (body?.refreshToken) {
      try {
        const payload = app.jwt.verify<AuthUser & { typ?: string; jti?: string }>(
          body.refreshToken,
        );
        // El `typ` se comprueba aquí igual que en `/auth/refresh` y en `requireAuth`: es
        // lo único que separa los dos tokens, porque comparten llave. Un access token no
        // trae `jti` y no habría revocado nada, pero dejar el hueco abierto invita a que
        // el día que algo cambie sí revoque lo que no debe.
        if (payload.typ !== 'refresh') return reply.send({ data: { ok: true }, error: null });
        if (payload.jti) await revocarSesion(payload.businessId, payload.jti);
      } catch {
        // Un token ilegible ya no sirve para nada: no hay nada que revocar.
      }
    }
    return reply.send({ data: { ok: true }, error: null });
  });

  /** GET /auth/sessions — dispositivos con sesión abierta. */
  app.get('/auth/sessions', { preHandler: app.requireAuth }, async (req, reply) => {
    const filas = await sesionesDe(req.authUser!.businessId, req.authUser!.sub);
    return reply.send({ data: filas, error: null });
  });

  /**
   * POST /auth/sessions/revoke-all — cerrar sesión en todos los dispositivos.
   *
   * Es lo que se hace cuando sospechas que alguien más entró con tu cuenta, así que
   * echa también a quien esté usando un access token en este momento.
   */
  app.post('/auth/sessions/revoke-all', { preHandler: app.requireAuth }, async (req, reply) => {
    await revocarTodo(req.authUser!.businessId, req.authUser!.sub);
    await app.audit(req, {
      action: 'revoke_sessions',
      entity: 'app_user',
      entityId: req.authUser!.sub,
      after: { self: true },
    });
    return reply.send({ data: { ok: true }, error: null });
  });

  // GET /auth/me
  // Al identidad del token se le añade lo que NO cabe en él porque cambia sin volver a
  // firmar: el correo y si está verificado. Es lo que decide si la app muestra el aviso.
  app.get('/auth/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const [row] = await withTenant(req.authUser!.businessId, (tx) =>
      tx
        .select({
          email: schema.appUser.email,
          emailVerifiedAt: schema.appUser.emailVerifiedAt,
        })
        .from(schema.appUser)
        .where(eq(schema.appUser.id, req.authUser!.sub))
        .limit(1),
    );
    return reply.send({
      data: {
        ...req.authUser,
        email: row?.email ?? null,
        emailVerified: !!row?.emailVerifiedAt,
      },
      error: null,
    });
  });

  // PATCH /auth/me — el usuario edita SU propio nombre y/o contraseña.
  // Para cambiar la contraseña debe confirmar la actual. No toca rol/ubicación.
  app.patch('/auth/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }
    const userId = req.authUser!.sub;

    const [current] = await withTenant(req.authUser!.businessId, (tx) =>
      tx
        .select({ passwordHash: schema.appUser.passwordHash })
        .from(schema.appUser)
        .where(eq(schema.appUser.id, userId))
        .limit(1),
    );
    if (!current) return reply.code(404).send({ data: null, error: 'Usuario no encontrado' });

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.email !== undefined) {
      const nuevo = parsed.data.email?.toLowerCase().trim() || null;
      patch.email = nuevo;
      // Cambiar de correo lo deja SIN verificar: si no, bastaría con poner el correo
      // de otra persona para heredar una verificación que nadie hizo.
      patch.emailVerifiedAt = null;
    }
    if (parsed.data.newPassword) {
      const ok = await argon2.verify(current.passwordHash, parsed.data.currentPassword!);
      if (!ok)
        return reply.code(400).send({ data: null, error: 'La contraseña actual es incorrecta' });
      patch.passwordHash = await argon2.hash(parsed.data.newPassword);
    }

    const [row] = await withTenant(req.authUser!.businessId, (tx) =>
      tx.update(schema.appUser).set(patch).where(eq(schema.appUser.id, userId)).returning({
        id: schema.appUser.id,
        name: schema.appUser.name,
        username: schema.appUser.username,
        role: schema.appUser.role,
        locationId: schema.appUser.locationId,
      }),
    );
    await app.audit(req, {
      action: 'update',
      entity: 'app_user',
      entityId: userId,
      after: {
        self: true,
        name: parsed.data.name,
        emailChanged: parsed.data.email !== undefined,
        passwordChanged: !!parsed.data.newPassword,
      },
    });

    /*
      Cambiarse uno la contraseña echa a todos los demás dispositivos.

      Faltaba, y quedaba justo al revés de lo que espera cualquiera: cuando un admin te
      cambiaba la clave (`users.ts`), o cuando la restablecías por correo (más abajo), sí
      se echaba a los intrusos; pero cuando te la cambiabas TÚ —que es lo que se hace
      precisamente al sospechar que alguien entró— su refresh seguía renovando 30 días.

      El detalle que lo hace utilizable: `revocarTodo` sube `token_version`, así que
      también mataría la sesión de quien está haciendo el cambio. Por eso se emite una
      pareja nueva y se devuelve: se va todo el mundo menos tú, que es lo que pediste.
    */
    let sesion: { accessToken: string; refreshToken: string } | undefined;
    if (parsed.data.newPassword) {
      await revocarTodo(req.authUser!.businessId, userId);

      const claims: AuthUser = {
        sub: userId,
        businessId: req.authUser!.businessId,
        locationId: row!.locationId,
        isCentral: req.authUser!.isCentral,
        role: row!.role,
        name: row!.name,
      };
      const jti = await crearSesion(
        req.authUser!.businessId,
        userId,
        ttlRefreshMs(),
        req.headers['user-agent'],
      );
      const tv = await versionDeTokens(req.authUser!.businessId, userId);
      sesion = {
        accessToken: app.jwt.sign({ ...claims, typ: 'access', tv }),
        refreshToken: app.jwt.sign(
          { ...claims, typ: 'refresh', jti, tv },
          { expiresIn: env.jwtRefreshTtl },
        ),
      };
    }

    return reply.send({ data: { ...row, ...sesion }, error: null });
  });

  // ── Recuperación de contraseña ───────────────────────────────

  // Tope estricto y propio: lo que se frena aquí no es adivinar contraseñas, es usar
  // el endpoint como máquina gratuita para inundar el buzón de cualquiera.
  const correoRateLimit = {
    rateLimit: {
      max: env.registerRateLimitMax,
      timeWindow: env.registerRateLimitWindow,
    },
  };

  /**
   * POST /auth/forgot-password
   *
   * Responde SIEMPRE lo mismo, exista el correo o no. Un mensaje distinto para "ese
   * correo no está registrado" convertiría este endpoint en una forma de averiguar
   * quién tiene cuenta en cada negocio.
   */
  app.post('/auth/forgot-password', { config: correoRateLimit }, async (req, reply) => {
    const respuesta = {
      data: { mensaje: 'Si el correo está registrado, te enviamos un enlace para continuar.' },
      error: null,
    };

    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return reply.send(respuesta);

    const email = parsed.data.email.toLowerCase().trim();
    const businessId = await resolverNegocio(parsed.data.business);
    if (!businessId) return reply.send(respuesta);

    const [biz] = await db
      .select({ slug: schema.business.slug, name: schema.business.name })
      .from(schema.business)
      .where(eq(schema.business.id, businessId))
      .limit(1);

    const [user] = await withTenant(businessId, (tx) =>
      tx
        .select({ id: schema.appUser.id, name: schema.appUser.name })
        .from(schema.appUser)
        .where(
          and(
            eq(schema.appUser.businessId, businessId),
            eq(schema.appUser.email, email),
            eq(schema.appUser.isActive, true),
          ),
        )
        .limit(1),
    );

    if (user && biz?.slug) {
      const { token } = await emitirToken(
        user.id,
        businessId,
        'password_reset',
        env.resetTokenTtlMin * 60_000,
      );
      const enlace = urlDelNegocio(biz.slug, `/restablecer?token=${token}`);
      await enviarCorreo(
        {
          to: email,
          subject: `Restablecer tu contraseña de ${biz.name}`,
          text:
            `Hola ${user.name}:\n\n` +
            `Pediste restablecer la contraseña de tu cuenta en ${biz.name}.\n\n` +
            `${enlace}\n\n` +
            `El enlace vale ${env.resetTokenTtlMin} minutos y sirve una sola vez.\n\n` +
            `Si no fuiste tú, no hagas nada: tu contraseña sigue como estaba.`,
        },
        app.log,
      );
    }

    return reply.send(respuesta);
  });

  /** POST /auth/reset-password — consume el enlace y cambia la contraseña. */
  app.post('/auth/reset-password', { config: correoRateLimit }, async (req, reply) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }

    const fila = await buscarToken(parsed.data.token, 'password_reset');
    if (!fila) {
      return reply.code(400).send({
        data: null,
        error: 'Este enlace ya no sirve. Pide uno nuevo.',
        code: 'token_invalido',
      });
    }

    const passwordHash = await argon2.hash(parsed.data.password);
    await withTenant(fila.businessId, (tx) =>
      tx.update(schema.appUser).set({ passwordHash }).where(eq(schema.appUser.id, fila.userId)),
    );
    await marcarUsado(fila.id);

    // Cambiar la contraseña echa de TODAS partes. Si alguien entró con la contraseña
    // vieja, dejar sus sesiones vivas haría inútil el restablecimiento.
    await revocarTodo(fila.businessId, fila.userId);
    app.log.info({ userId: fila.userId }, 'contraseña restablecida por correo');

    return reply.send({
      data: { mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' },
      error: null,
    });
  });

  // ── Verificación del correo ──────────────────────────────────

  /** POST /auth/verify-email — sin sesión: el enlace llega al correo, no a la app. */
  app.post('/auth/verify-email', { config: correoRateLimit }, async (req, reply) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: 'Enlace inválido' });
    }

    const fila = await buscarToken(parsed.data.token, 'email_verify');
    if (!fila) {
      return reply.code(400).send({
        data: null,
        error: 'Este enlace ya no sirve. Pide uno nuevo desde tu perfil.',
        code: 'token_invalido',
      });
    }

    await withTenant(fila.businessId, (tx) =>
      tx
        .update(schema.appUser)
        .set({ emailVerifiedAt: new Date() })
        .where(eq(schema.appUser.id, fila.userId)),
    );
    await marcarUsado(fila.id);

    return reply.send({ data: { mensaje: 'Correo confirmado.' }, error: null });
  });

  /** POST /auth/resend-verification — con sesión: lo pide quien ve el aviso. */
  app.post(
    '/auth/resend-verification',
    { preHandler: app.requireAuth, config: correoRateLimit },
    async (req, reply) => {
      const businessId = req.authUser!.businessId;
      const [user] = await withTenant(businessId, (tx) =>
        tx
          .select({
            id: schema.appUser.id,
            name: schema.appUser.name,
            email: schema.appUser.email,
            emailVerifiedAt: schema.appUser.emailVerifiedAt,
          })
          .from(schema.appUser)
          .where(eq(schema.appUser.id, req.authUser!.sub))
          .limit(1),
      );

      if (!user?.email) {
        return reply
          .code(400)
          .send({ data: null, error: 'Añade un correo en tu perfil antes de confirmarlo.' });
      }
      if (user.emailVerifiedAt) {
        return reply.send({ data: { mensaje: 'Tu correo ya está confirmado.' }, error: null });
      }

      const [biz] = await db
        .select({ slug: schema.business.slug, name: schema.business.name })
        .from(schema.business)
        .where(eq(schema.business.id, businessId))
        .limit(1);
      if (!biz?.slug) {
        return reply.code(400).send({ data: null, error: 'Este negocio no tiene subdominio.' });
      }

      const { token } = await emitirToken(
        user.id,
        businessId,
        'email_verify',
        env.verifyTokenTtlHours * 3_600_000,
      );
      await enviarCorreo(
        {
          to: user.email,
          subject: `Confirma tu correo de ${biz.name}`,
          text:
            `Hola ${user.name}:\n\n` +
            `Confirma tu correo para poder recuperar la contraseña si algún día la olvidas:\n` +
            `${urlDelNegocio(biz.slug, `/verificar?token=${token}`)}\n\n` +
            `El enlace vale ${env.verifyTokenTtlHours} horas.`,
        },
        app.log,
      );

      return reply.send({ data: { mensaje: 'Te enviamos el enlace.' }, error: null });
    },
  );
}
