-- Deja un operador PRINCIPAL en las instalaciones que ya existían.
--
-- La 0014 añadió `is_owner` con `DEFAULT false` y no rellenó nada. En local no se notó
-- porque el operador se creó después de la columna, ya con la marca puesta; pero en una
-- instalación anterior TODOS los operadores quedan en `false`, y entonces `soloPrincipal`
-- responde 403 a todo el mundo: la sección de Operadores queda cerrada para siempre y sólo
-- se abre entrando por SSH a correr el CLI. Una migración que deja la aplicación sin
-- manera de administrarse a sí misma no está terminada.
--
-- Se asciende al operador activo más antiguo, que es quien montó la instalación.
--
-- Las dos guardas importan:
--   · `NOT EXISTS` la hace idempotente y respeta lo ya decidido — si alguien ya es
--     principal (el caso de local, y el de cualquiera que haya usado `--owner`), esto no
--     toca nada.
--   · `is_active` evita ascender a alguien a quien se dio de baja a propósito, que
--     equivaldría a devolverle la llave del panel.
UPDATE "platform_admin"
SET "is_owner" = true
WHERE "id" = (
    SELECT "id"
    FROM "platform_admin"
    WHERE "is_active" = true
    ORDER BY "created_at" ASC
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1 FROM "platform_admin" WHERE "is_owner" = true AND "is_active" = true
  );
