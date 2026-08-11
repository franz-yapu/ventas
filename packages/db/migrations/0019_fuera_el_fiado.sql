-- Fuera el fiado: se va la tabla de abonos y el valor 'credit' de la forma de pago.
--
-- El POS nunca ofreció fiar —la pantalla de cobro filtraba el método—, así que en un
-- sistema que sólo se usó por su interfaz esto no toca ni una fila. Pero la ruta de
-- ventas SÍ aceptaba 'credit' (venía en el esquema compartido) y la de sincronización
-- offline también, así que un cliente antiguo o una llamada directa pudieron haber
-- dejado ventas a crédito. Por eso las dos guardas de abajo: si hay algo, esto se
-- planta en vez de convertirlo en un error de casteo de Postgres que no dice qué hacer.
--
-- Que se plante es lo correcto. Son cuentas por cobrar: plata que el negocio no ha
-- cobrado. Migrarlas a 'cash' en silencio diría que ya entraron.

DO $$
DECLARE
  ventas bigint;
  abonos bigint;
BEGIN
  -- El casteo a texto no es cosmética: en una base recién creada todas las migraciones
  -- corren dentro de UNA transacción, y Postgres prohíbe comparar contra un valor de
  -- enum nacido en esa misma transacción ("unsafe use of new value"). Contra texto no
  -- mira el enum y da igual cuándo se creó.
  SELECT count(*) INTO ventas FROM "sale" WHERE "payment_method"::text = 'credit';
  SELECT count(*) INTO abonos FROM "customer_payment";

  IF ventas > 0 OR abonos > 0 THEN
    RAISE EXCEPTION
      'No se puede quitar el fiado: hay % venta(s) a credito y % abono(s) en la base. Exportalos (Reportes > Exportar) y decide con el dueño que pasa con esas cuentas por cobrar ANTES de aplicar esta migracion.',
      ventas, abonos;
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE "customer_payment" CASCADE;--> statement-breakpoint
-- Postgres no deja quitar un valor de un enum: hay que pasar la columna a texto,
-- recrear el tipo sin 'credit' y devolverla. Con la guarda de arriba, el casteo de
-- vuelta no puede fallar.
ALTER TABLE "public"."sale" ALTER COLUMN "payment_method" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."payment_method";--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'qr', 'transfer');--> statement-breakpoint
ALTER TABLE "public"."sale" ALTER COLUMN "payment_method" SET DATA TYPE "public"."payment_method" USING "payment_method"::"public"."payment_method";
