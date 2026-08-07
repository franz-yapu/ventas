# API de VentaFácil

> **Generado** por `scripts/gen-api-docs.mjs` a partir de las rutas reales de la
> aplicación. No lo edites a mano: vuelve a generarlo.

## Cómo hablar con esta API

Todo cuelga de `/api/v1`. Toda respuesta —también los errores— tiene la misma forma:

```json
{ "data": {}, "error": null }
```

Cuando algo falla, `data` es `null` y `error` trae un mensaje **en español, escrito
para la persona que lo va a leer**, no para el programador.

### Autenticación

Cabecera `Authorization: Bearer <token>` en todo lo que no esté marcado como público.
Hay **dos mundos de tokens, firmados con secretos distintos**:

| | Token de negocio | Token de plataforma |
|---|---|---|
| Se obtiene en | `POST /auth/login` | `POST /platform/login` |
| Firma | `JWT_ACCESS_SECRET` | `JWT_PLATFORM_SECRET` |
| Dura | 15 min, renovable con el refresh | 8 h, sin renovación |
| Sirve para | el POS de un negocio | administrar todos los negocios |

Uno **no vale** en el mundo del otro, y no por comprobar un campo: son llaves distintas.

### Códigos que conviene distinguir

| Código | Qué significa | Qué hacer |
|---|---|---|
| `401` | Sesión caducada o revocada | Renovar con `/auth/refresh`; si falla, volver a entrar |
| `402` | La suscripción no deja | **No es un problema de sesión.** Ver `code` |
| `403` | El rol o la ubicación no alcanzan | Nada que reintentar |
| `429` | Demasiadas peticiones | Esperar lo que diga el mensaje |

En los `402` el campo `code` dice cuál de los tres casos es: `subscription_blocked`
(prueba vencida, suspendida o cancelada), `plan_limit` (se agotó el cupo de sucursales,
usuarios o productos) o `plan_feature` (la función no entra en el plan).

Confundir un `402` con un `401` es el error clásico: el cliente intenta renovar la
sesión, falla, y echa al usuario al login en vez de enseñarle por qué está bloqueado.

### Los cuerpos de las peticiones

Se validan con Zod en `packages/shared/src/schemas.ts`. Es una sola fuente, la comparten
el servidor y la web, y se lee mejor que cualquier copia que hiciéramos aquí.

---

## Endpoints (74)

### Actividad

| Método | Ruta | Sesión |
|---|---|---|
| `GET` | `/api/v1/audit` | requerida |

### Caja / arqueo

| Método | Ruta | Sesión |
|---|---|---|
| `POST` | `/api/v1/cash/close` | requerida |
| `GET` | `/api/v1/cash/current` | requerida |
| `POST` | `/api/v1/cash/movements` | requerida |
| `POST` | `/api/v1/cash/open` | requerida |
| `GET` | `/api/v1/cash/registers` | requerida |
| `GET` | `/api/v1/cash/registers/:id` | requerida |

### Catálogo

| Método | Ruta | Sesión |
|---|---|---|
| `GET` | `/api/v1/categories` | requerida |
| `POST` | `/api/v1/categories` | requerida |
| `DELETE` | `/api/v1/categories/:id` | requerida |
| `GET` | `/api/v1/products` | requerida |
| `POST` | `/api/v1/products` | requerida |
| `PATCH` | `/api/v1/products/:id` | requerida |
| `GET` | `/api/v1/products/:id/history` | requerida |
| `POST` | `/api/v1/products/import` | requerida |

### Clientes y fiado

| Método | Ruta | Sesión |
|---|---|---|
| `GET` | `/api/v1/customers` | requerida |
| `POST` | `/api/v1/customers` | requerida |
| `GET` | `/api/v1/customers/:id` | requerida |
| `POST` | `/api/v1/customers/:id/payments` | requerida |

### Inventario

| Método | Ruta | Sesión |
|---|---|---|
| `GET` | `/api/v1/inventory` | requerida |
| `PATCH` | `/api/v1/inventory/:id` | requerida |
| `POST` | `/api/v1/inventory/transfer` | requerida |

### Negocio y datos

| Método | Ruta | Sesión |
|---|---|---|
| `PATCH` | `/api/v1/business` | requerida |
| `GET` | `/api/v1/business/export` | requerida |
| `GET` | `/api/v1/business/me` | requerida |

### Otros

| Método | Ruta | Sesión |
|---|---|---|
| `OPTIONS` | `*` | requerida |
| `GET` | `/api/v1/dashboard-config` | requerida |
| `PUT` | `/api/v1/dashboard-config` | requerida |
| `GET` | `/api/v1/public/business/:slug` | requerida |
| `GET` | `/health` | — pública |

### Panel de plataforma

| Método | Ruta | Sesión |
|---|---|---|
| `GET` | `/api/v1/platform/admins` | requerida |
| `POST` | `/api/v1/platform/admins` | requerida |
| `PATCH` | `/api/v1/platform/admins/:id` | requerida |
| `GET` | `/api/v1/platform/audit` | requerida |
| `POST` | `/api/v1/platform/login` | — pública |
| `GET` | `/api/v1/platform/me` | requerida |
| `PATCH` | `/api/v1/platform/me` | requerida |
| `PATCH` | `/api/v1/platform/me/password` | requerida |
| `GET` | `/api/v1/platform/metrics` | requerida |
| `GET` | `/api/v1/platform/tenants` | requerida |
| `GET` | `/api/v1/platform/tenants/:id` | requerida |
| `PATCH` | `/api/v1/platform/tenants/:id` | requerida |
| `PATCH` | `/api/v1/platform/tenants/:id/subscription` | requerida |
| `GET` | `/api/v1/platform/tenants/:id/users` | requerida |
| `POST` | `/api/v1/platform/tenants/:id/users/:userId/password` | requerida |

### Registro de negocios

| Método | Ruta | Sesión |
|---|---|---|
| `POST` | `/api/v1/register` | — pública |
| `GET` | `/api/v1/register/slug` | — pública |

### Reportes

| Método | Ruta | Sesión |
|---|---|---|
| `GET` | `/api/v1/reports/cash-z` | requerida |
| `GET` | `/api/v1/reports/dashboard` | requerida |
| `GET` | `/api/v1/reports/summary` | requerida |

### Sesión y contraseña

| Método | Ruta | Sesión |
|---|---|---|
| `POST` | `/api/v1/auth/forgot-password` | — pública |
| `POST` | `/api/v1/auth/login` | — pública |
| `POST` | `/api/v1/auth/logout` | — pública |
| `GET` | `/api/v1/auth/me` | requerida |
| `PATCH` | `/api/v1/auth/me` | requerida |
| `POST` | `/api/v1/auth/refresh` | — pública |
| `POST` | `/api/v1/auth/resend-verification` | requerida |
| `POST` | `/api/v1/auth/reset-password` | — pública |
| `GET` | `/api/v1/auth/sessions` | requerida |
| `POST` | `/api/v1/auth/sessions/revoke-all` | requerida |
| `POST` | `/api/v1/auth/verify-email` | — pública |

### Sucursales

| Método | Ruta | Sesión |
|---|---|---|
| `GET` | `/api/v1/locations` | requerida |
| `POST` | `/api/v1/locations` | requerida |
| `PATCH` | `/api/v1/locations/:id` | requerida |

### Suscripción

| Método | Ruta | Sesión |
|---|---|---|
| `GET` | `/api/v1/plans` | — pública |
| `GET` | `/api/v1/subscription/me` | requerida |

### Usuarios

| Método | Ruta | Sesión |
|---|---|---|
| `GET` | `/api/v1/users` | requerida |
| `POST` | `/api/v1/users` | requerida |
| `PATCH` | `/api/v1/users/:id` | requerida |

### Ventas

| Método | Ruta | Sesión |
|---|---|---|
| `POST` | `/api/v1/sales` | requerida |
| `GET` | `/api/v1/sales` | requerida |
| `GET` | `/api/v1/sales/:id` | requerida |
| `POST` | `/api/v1/sales/:id/cancel` | requerida |
| `POST` | `/api/v1/sales/sync` | requerida |

