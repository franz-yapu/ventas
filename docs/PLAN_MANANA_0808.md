# Plan para mañana — 8 de agosto de 2026

Sale de tres sitios: lo que dejó el **QA visual** de anoche (sin arreglar), lo que queda
del **plan de observaciones** (`PLAN_OBSERVACIONES_0807.md`), y lo que sigue pendiente del
despliegue desde la revisión de la mañana.

Ordenado por lo que cuesta no hacerlo.

---

## 1 · ⛔ La interfaz de eliminar sucursales y usuarios — NO EXISTE

**Es lo primero, y es una entrega a medias mía.**

El API tiene `DELETE /locations/:id` y `DELETE /users/:id`, con sus guardas, su política de
borrar-o-desactivar y 14 tests. La interfaz **no existe**: `apps/web/src/lib/api.ts` ni
siquiera tiene un método `delete`, y ninguna de las dos pantallas importa un icono de
papelera.

O sea: el punto 4 de tus observaciones está hecho por dentro y es inalcanzable por fuera.
Ningún test lo notó porque todos entran por el API — la lección es que **una función sin
pantalla no está hecha**, y los tests de backend no lo pueden decir.

**Trabajo:**

- `api.ts`: método `delete` (media hora).
- `LocationsPage` y `UsersPage`: acción de eliminar con confirmación, y sobre todo **el
  mensaje de vuelta**. El API ya contesta _"No se eliminó porque la sucursal tiene 340
  ventas y 12 turnos de caja. Se desactivó en su lugar"_: eso hay que enseñarlo tal cual,
  porque es lo que evita que alguien pruebe a borrar otras cosas para destrabarlo.
- Los cuatro casos de 409 tienen mensaje propio y merecen verse: es la principal, es la
  única activa, es el último admin, es tu propia cuenta.
- Un test de componente por cada camino: eliminado / desactivado con motivo / bloqueado.

**Tamaño:** medio día. Es lo que convierte tres días de backend en una función usable.

---

## 2 · El anillo de foco no llega a lo que se pulsa

Mi arreglo de ayer está a medias y el test que escribí no lo vio: comprobaba que la clase
estuviera puesta, **no que el anillo se viera**.

La regla global vive en `@layer components` (`index.css:63`) y los componentes llevan
`focus-visible:outline-none`, que es una _utility_ y gana por cascada. El reparto es el
peor posible: cubre lo decorativo —los enlaces del menú miden 5.30:1— y deja fuera Cobrar,
Excel, Nuevo, Cerrar caja, el buscador y los selects, todos en **1.82:1 en claro y 1.48:1
en oscuro**.

Y el anillo usa `var(--color-primary)`: con el tema **Grafito** en oscuro cae a **1.53:1**,
invisible. Es el mismo problema que `--color-primary-ink` ya resolvió para el texto.

**Trabajo:**

- Quitar `focus-visible:outline-none` de `button.tsx`, `input.tsx` y `select.tsx`, o subir
  la regla global a una capa que gane.
- Cambiar el color del anillo a `--color-primary-ink`.
- **Y el test tiene que medir, no mirar clases.** Con `getComputedStyle` sobre el elemento
  enfocado, como hace `paleta.test.ts` con los tokens. Si no, el próximo arreglo a medias
  volverá a pasar.

**Tamaño:** dos horas, test incluido.

---

## 3 · Seis controles con el borde decorativo

Del mismo cambio de ayer, y de la misma clase: el `<input type="color">` de Configuración,
los presets de tema, los métodos de pago no marcados del POS, «Salir», las tarjetas de
producto y el `−/+` del carrito siguen con `--color-border` (1.19:1) en vez de
`--color-field` (3.32:1).

Dentro de los seis modales, cero fallos — así que el patrón se aplicó donde se miró.

**Tamaño:** una hora.

---

## 4 · ❓ ¿Se puede vender fiado desde el POS?

**Esto es una pregunta para ti, no una tarea.**

`PosPage.tsx:316` filtra `credit` de los métodos de pago, así que **fiar no se puede
seleccionar al vender**. Pero el sistema tiene clientes, saldos, abonos, una pantalla de
detalle y hasta una excepción de alcance documentada a propósito para el fiado ("lo que se
fía se le fía al negocio, no a una sucursal").

O sea: hay media función construida y la puerta por la que se usaría está cerrada.

Y de rebote: la rama "vas a fiar…" de la confirmación de cobro **es código muerto**, y yo le
escribí un test que pasa. Un test verde sobre código que no se ejecuta nunca.

Las opciones son tres y ninguna la puedo decidir yo:

1. **Habilitar el fiado en el POS** — es lo que el resto del sistema da por hecho.
2. **Quitarlo del todo**: fuera la rama, fuera el test, y decidir qué pasa con clientes y
   saldos.
3. **Dejarlo como está** y anotar por qué, para que el siguiente que lo vea no lo "arregle".

---

## 5 · Terminar las imágenes de producto

Está escrita la base y **sin conectar**: el redimensionado en el navegador
(`lib/imagen.ts`, 800×800 WebP, ~60 kB desde una foto de 4 MB) y el almacén en disco del
VPS (`lib/almacen.ts`, ya al 96 % de cobertura con sus tests de seguridad).

Falta: el endpoint de subida, la pantalla, y enseñarlas en el POS y en Productos.

Decisiones ya tomadas: **disco del VPS** con volumen, **sin cupo propio por plan** (lo acota
el límite de productos), y **sin quitar el fondo** — recorte cuadrado y ya.

⚠️ **Para el VPS**: la carpeta tiene que ser un **volumen de Docker**. Si vive dentro del
contenedor, cada despliegue borra las fotos de todos los negocios. Falta añadirlo a
`DESPLIEGUE_TRAS_REVISION.md`, junto con `MEDIA_DIR` en `.env.example`.

**Tamaño:** dos días.

---

## 6 · Lo que queda del plan de observaciones

- **Exportar en PDF** (bloque C, segunda mitad). El Excel ya está y cubre el 90 % de lo que
  se pide. El PDF es para imprimir y firmar, que es el caso más raro. **Tres días.**
- **D.2 · Foto de notas a mano con IA.** Decidido que entra en el precio del plan. Falta lo
  que no es código: **el inventario del cliente saldría hacia un servicio externo, y eso
  tiene que estar en los términos antes de encenderlo.** Va por el skill `legal`. Aterriza
  en la misma vista previa de la importación, que ya está hecha. **Tres días + lo legal.**
- **No hay pantalla de Clientes.** El API tiene `/customers` completo —lista, detalle,
  saldo, abonos— y en la web no existe ninguna ruta que lo use. Lo descubrí conectando la
  exportación. No estaba en tus observaciones, pero es un hueco del mismo tipo que el #1 de
  arriba.

---

## 7 · Y lo que sigue esperando al VPS, desde la mañana

Nada de esto es código, y sigue siendo lo único que, si sale mal, no se recupera:

1. **Comprobar qué secreto JWT tiene el servidor.** El API ya **se niega a arrancar** con el
   literal de `.env.example`, así que desplegar sin mirar deja el servicio caído. Rotarlo
   echa a todo el mundo → con el negocio cerrado.
2. **`RESEND_API_KEY`**, ahora obligatoria en producción.
3. **El backup diario copiado fuera del servidor.** Los scripts están y probados; falta el
   cron.
4. Comprobar si quedaron filas de inventario huérfanas de la transferencia cruzada.
5. Activar RLS, y el monitor de uptime.

Todo en `docs/DESPLIEGUE_TRAS_REVISION.md`.

---

## Una cosa sobre cómo lanzar los agentes la próxima vez

Dos correcciones al método, que salieron de esta ronda:

1. **Congelar el árbol mientras corren, o lanzarlos en secuencia.** Estuve arreglando los
   hallazgos del peer review mientras los otros dos probaban; el de QA funcional lo detectó
   y fechó cada hallazgo contra el árbol de ese momento —por eso siguen siendo utilizables—
   pero obliga a cruzar cada cosa con la hora a la que se encontró.
2. **Darles un negocio de pruebas propio.** Es la segunda ronda seguida en que un agente
   cobra ventas reales sin querer (esta vez tres: #114, #118, #119, las tres canceladas con
   motivo). Entrar a `llanteria-central`, que es el negocio con historial y el que uso para
   mirar cosas, no es buena idea.
