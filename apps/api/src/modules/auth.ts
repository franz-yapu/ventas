import { db, schema } from '@ventafacil/db';
import { loginSchema, updateProfileSchema } from '@ventafacil/shared';
import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import type { AuthUser } from '../types.js';

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login
  // Límite propio, mucho más estricto que el global: es el endpoint que se ataca por
  // fuerza bruta. Se cuenta por IP; el tope deja margen de sobra a quien teclea mal.
  const loginRateLimit = {
    rateLimit: { max: env.loginRateLimitMax, timeWindow: env.loginRateLimitWindow },
  };

  app.post('/auth/login', { config: loginRateLimit }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: 'Datos invalidos' });
    }
    const { username, password, business } = parsed.data;

    // Resolver el NEGOCIO (tenant) antes de buscar el usuario: los usernames son
    // únicos por negocio, así que sin acotar el negocio el login sería ambiguo.
    let businessId: string;
    if (business) {
      const [biz] = await db
        .select({ id: schema.business.id })
        .from(schema.business)
        .where(eq(schema.business.slug, business))
        .limit(1);
      if (!biz) return reply.code(401).send({ data: null, error: 'Usuario o contraseña incorrectos' });
      businessId = biz.id;
    } else {
      // Sin slug: sólo válido cuando hay UN único negocio (instalación de un cliente).
      const businesses = await db.select({ id: schema.business.id }).from(schema.business).limit(2);
      if (businesses.length === 0) {
        return reply.code(401).send({ data: null, error: 'Usuario o contraseña incorrectos' });
      }
      if (businesses.length > 1) {
        return reply.code(400).send({ data: null, error: 'Indica el negocio para iniciar sesión' });
      }
      businessId = businesses[0]!.id;
    }

    const [user] = await db
      .select()
      .from(schema.appUser)
      .where(
        and(
          eq(schema.appUser.businessId, businessId),
          eq(schema.appUser.username, username),
          eq(schema.appUser.isActive, true),
        ),
      )
      .limit(1);

    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return reply.code(401).send({ data: null, error: 'Usuario o contraseña incorrectos' });
    }

    // ¿Su ubicación es la central? -> puede ver todas las ubicaciones.
    let isCentral = false;
    if (user.locationId) {
      const [loc] = await db
        .select({ isCentral: schema.location.isCentral })
        .from(schema.location)
        .where(eq(schema.location.id, user.locationId))
        .limit(1);
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
    const accessToken = app.jwt.sign({ ...claims, typ: 'access' });
    const refreshToken = app.jwt.sign({ ...claims, typ: 'refresh' }, { expiresIn: env.jwtRefreshTtl });

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
      const payload = app.jwt.verify<AuthUser & { typ?: string }>(body.refreshToken);
      if (payload.typ !== 'refresh') throw new Error('token no es refresh');
      const claims: AuthUser = {
        sub: payload.sub,
        businessId: payload.businessId,
        locationId: payload.locationId,
        isCentral: payload.isCentral ?? false,
        role: payload.role,
        name: payload.name,
      };
      const accessToken = app.jwt.sign({ ...claims, typ: 'access' });
      return reply.send({ data: { accessToken }, error: null });
    } catch {
      return reply.code(401).send({ data: null, error: 'Refresh token invalido' });
    }
  });

  // GET /auth/me
  app.get('/auth/me', { preHandler: app.requireAuth }, async (req, reply) => {
    return reply.send({ data: req.authUser, error: null });
  });

  // PATCH /auth/me — el usuario edita SU propio nombre y/o contraseña.
  // Para cambiar la contraseña debe confirmar la actual. No toca rol/ubicación.
  app.patch('/auth/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }
    const userId = req.authUser!.sub;

    const [current] = await db
      .select({ passwordHash: schema.appUser.passwordHash })
      .from(schema.appUser)
      .where(eq(schema.appUser.id, userId))
      .limit(1);
    if (!current) return reply.code(404).send({ data: null, error: 'Usuario no encontrado' });

    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.newPassword) {
      const ok = await argon2.verify(current.passwordHash, parsed.data.currentPassword!);
      if (!ok) return reply.code(400).send({ data: null, error: 'La contraseña actual es incorrecta' });
      patch.passwordHash = await argon2.hash(parsed.data.newPassword);
    }

    const [row] = await db
      .update(schema.appUser)
      .set(patch)
      .where(eq(schema.appUser.id, userId))
      .returning({
        id: schema.appUser.id,
        name: schema.appUser.name,
        username: schema.appUser.username,
        role: schema.appUser.role,
        locationId: schema.appUser.locationId,
      });
    await app.audit(req, {
      action: 'update',
      entity: 'app_user',
      entityId: userId,
      after: { self: true, name: parsed.data.name, passwordChanged: !!parsed.data.newPassword },
    });
    return reply.send({ data: row, error: null });
  });
}
