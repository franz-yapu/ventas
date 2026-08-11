# Plan para mañana — 8 de agosto de 2026

Sale de tres sitios: lo que dejó el **QA visual** de anoche (sin arreglar), lo que queda
del **plan de observaciones** (`PLAN_OBSERVACIONES_0807.md`), y lo que sigue pendiente del
despliegue desde la revisión de la mañana.

Ordenado por lo que cuesta no hacerlo.

---

## Estado al 11 de agosto de 2026

Se retomó el 11 (el 8 no se trabajó). Hecho, en este orden:

| Punto                       | Estado                                                | Commit    |
| --------------------------- | ----------------------------------------------------- | --------- |
| 4 · ¿Fiado sí o no?         | **Decidido y ejecutado**: fuera del producto          | `28116b1` |
| 1 · Interfaz de eliminar    | **Hecho**, más «hacer principal», que tampoco existía | `6c3ead2` |
| 2 · Anillo de foco          | **Hecho**, medido en Chromium antes y después         | `e4bc418` |
| 3 · Seis bordes decorativos | **Hecho** (catorce, con guard que recorre el JSX)     | `8209c92` |

Correcciones a este documento, comprobadas contra el código:

- **`api.ts` sí tenía método de borrado**, y se llama `del`. Existía desde el commit del
  diseño y no lo llamaba nadie, que era el problema de verdad.
- **Playwright NO es dependencia del repo.** Lo que hay es el Chromium que dejaron en
  caché los agentes. El punto 8.1 pide un test de navegador y eso sigue sin decidirse:
  costaría meter `playwright` como devDependency más un `playwright install chromium` en
  el workflow.

Sigue pendiente todo el punto 5 (imágenes), el 6 (PDF, IA de notas, pantalla de Clientes)
y el 7 entero (VPS). Del 8, se cerraron 8.1 en parte y 8.2 en su caso concreto.

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

## 8 · De fondo — lo que esta ronda demostró que falta

El bloque 6 de la revisión de la mañana (tests de componentes, umbral de cobertura, fuera
`pnpm lint`, partir el chunk, formatear el repo) está **hecho**. Pero esta segunda ronda
enseñó dónde sigue habiendo agujero, y es distinto de lo que se arregló entonces.

### 8.1 · Los tests de estilo miran clases, no lo que se ve

Es la lección más cara de la noche. Escribí un test que comprobaba que
`focus-visible:ring` estuviera en el `className`… y el anillo no se veía, porque una regla
de otra capa ganaba por cascada. **El test pasaba y el usuario no veía el foco.**

Lo mismo puede estar pasando con los seis controles que se quedaron con el borde
decorativo: hay un test que comprueba que `Input` lleve `border-field`, y no dice nada de
los otros seis sitios que no pasan por `Input`.

**Lo que hace falta:** un test que **mida el estilo calculado** sobre elementos montados,
como hace `paleta.test.ts` con los tokens del CSS. jsdom no calcula cascada de verdad, así
que esto probablemente pide un test con navegador (Playwright ya está instalado y los
agentes lo usan). Sería el primer test de este tipo del proyecto.

**Sin esto, el arreglo de mañana del punto 2 se puede volver a romper igual y nadie lo
notará.**

### 8.2 · Una función sin pantalla no está hecha, y nada lo detecta

Los `DELETE` de sucursales y usuarios pasaron 14 tests, el typecheck, el CI entero y una
revisión con tres agentes — y son inalcanzables. Lo mismo la pantalla de Clientes: el API
está completo y no hay ruta en la web.

**Idea a evaluar:** un comprobante que cruce las rutas del API con lo que la web llama.
`docs/API.md` ya lista las 79 rutas; un `grep` sobre `apps/web/src` diría cuáles no se usan
desde ninguna parte. No todas tienen que usarse —hay rutas de plataforma y de sistema— pero
una lista de "el API ofrece esto y nadie lo pide" habría delatado las dos.

Es media hora de script y evita entregar tres días de backend inalcanzable.

### 8.3 · La cobertura de la web sigue en 7 %

Subió del 3,5 % al **7,3 %**, y el mérito es casi todo de la lógica extraída
(`importar.ts`, `confirmar.ts`) más que de montar componentes. Las 74 pantallas siguen sin
red: **8.013 líneas y 582 cubiertas.**

Los umbrales por carpeta que se pusieron protegen lo que ya está probado, que era el
objetivo. Lo que falta es subir la lista: cada pantalla que se toque mañana debería salir
con su test de componente, empezando por las dos del punto 1.

### 8.4 · El service worker precarga 2,8 MB

Partir el paquete de entrada funcionó (1.021 → 503 kB), pero el **total precargado subió a
2.804 KiB** porque el service worker guarda también el trozo de `exceljs` — casi un mega
para una función que el dueño usa una vez al mes, bajado en la primera visita de cada caja.

**Excluir `exceljs` del precache** y dejar que se descargue al pulsar. Es una línea en
`vite.config.ts` y devuelve el precache a ~1,9 MB.

### 8.5 · El CI no comprueba lo que esta ronda encontró

Hoy corre: auditoría de dependencias, formato, tipos, tests con umbral de cobertura, build,
migración pendiente y documentación al día. Es bastante. Lo que **no** mira:

- que las rutas del API tengan quien las llame (8.2),
- que los estilos se vean de verdad (8.1),
- el tamaño del paquete (una regresión de 1.021 kB pasó sin que nada chistara; la detecté
  mirando las métricas a mano).

Un tope de tamaño para el chunk de entrada son tres líneas y habría atrapado lo de
`exceljs` el mismo día.

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
