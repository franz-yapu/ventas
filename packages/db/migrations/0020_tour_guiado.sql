-- El tour guiado: dos columnas en `app_user` para saber a quién ofrecérselo.
--
-- `login_count` cuenta las entradas de esa persona, porque el tour se ofrece solo en las
-- dos primeras y después sólo si lo piden desde Ayuda. `tour_dismissed_at` guarda cuándo
-- dijo «no mostrar más» o lo terminó; con fecha, no vuelve a salir por su cuenta.
--
-- Van en el USUARIO y no en el navegador. Guardado en el navegador, el tour reaparecería
-- al cambiar de equipo o al limpiar la caché, y «no me lo vuelvas a mostrar» dejaría de
-- ser verdad justo con quien ya lo despachó una vez.
--
-- Aditiva y sin riesgo: dos columnas con valor por defecto, ninguna fila se reescribe.
-- Los usuarios que ya existen empiezan en `login_count = 0`, así que verán el tour en sus
-- dos próximas entradas. Es lo buscado: nunca se les ofreció.

ALTER TABLE "app_user" ADD COLUMN "login_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "tour_dismissed_at" timestamp with time zone;
