import { db, schema } from '@ventafacil/db';
import { loginSchema } from '@ventafacil/shared';
import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import type { AuthUser } from '../types.js';

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login
  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ data: null, error: 'Datos invalidos' });
    }
    const { username, password } = parsed.data;

    const [user] = await db
      .select()
      .from(schema.appUser)
      .where(and(eq(schema.appUser.username, username), eq(schema.appUser.isActive, true)))
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
}
