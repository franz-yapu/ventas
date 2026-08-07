# Plan — observaciones y requerimientos del 7 de agosto de 2026

Trece puntos llegados desde el uso real. Cuatro eran fallos y **ya están arreglados**
(commit `e75ffda`); los otros nueve se planifican aquí.

El orden no es el de la lista original: va por **lo que cuesta si no se hace**.

---

## Ya hecho — los cuatro fallos (puntos 1, 2, 3, 13)

Los tres primeros resultaron ser **el mismo fallo**, y por eso conviene contarlo entero.

`Modal` llevaba `onClose` en las dependencias de su `useEffect`. Quien lo usa le pasa una
flecha en línea (`onClose={() => setX(null)}`), que es una función **nueva en cada
render**: cada tecla cambiaba el estado del padre → render → nueva identidad → el efecto
se limpiaba y volvía a montar. Su limpieza devuelve el foco a donde estaba antes de abrir;
su montaje lo lleva al primer campo. **El foco salía disparado en cada letra.**

Como anular una venta y registrar un movimiento de caja **exigen un motivo de tres
caracteres**, ninguna de las dos operaciones llegaba a completarse. De ahí que "no se
refleje en caja": no es que no se reflejara, es que nunca ocurrió.

| #   | Qué era                                           | Estado                                                                    |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| 2   | No se podía escribir el motivo de una anulación   | ✅ `Modal` usa una ref; test que va rojo sin el arreglo                   |
| 3   | Los retiros no aparecían en caja                  | ✅ Mismo origen. Verificado en el navegador: se registra y se ve          |
| 1   | Anular no se reflejaba en caja                    | ✅ Además: el desglose expone `cancelledCash` y la caja avisa (ver abajo) |
| 13  | No había dónde escribir el código para el escáner | ✅ Enter en el buscador agrega y limpia                                   |

**Sobre el punto 1, que tenía además un hueco real mío.** Se decidió que anular NO devuelva
el efectivo esperado —el billete entró al cajón; devolverlo es un retiro registrado—, pero
eso, sin decirlo en ninguna parte, se ve exactamente igual que si la anulación no se
hubiera guardado. Ahora la caja avisa: cuánto hay anulado, por qué sigue contando, y que si
se devolvió el dinero hay que registrarlo como retiro.

**Sobre el 13**: el buscador del POS ya buscaba por código de barras, pero no lo decía y no
hacía nada con Enter. Un lector USB se comporta como un teclado: escribe el código y pulsa
Enter. Había que soltar la pistola y tocar la tarjeta con el dedo — justo lo que se compró
el lector para no hacer.

---

## Bloque A — Alcance: lo que cada quien ve (puntos 6, 7, 8, 9)

Son cuatro caras del mismo asunto y **conviene hacerlas juntas**, porque tocan las mismas
funciones y separarlas obliga a razonar dos veces sobre lo mismo.

### A.1 · El vendedor no da de alta productos ✅ _ya hecho_

La pantalla condicionaba el botón a `isCentral` —dónde está la persona— en vez de al rol.
Salían las dos equivocaciones opuestas: un **vendedor de la central veía el botón** (y se
llevaba un 403 al guardar, porque el servidor sí miraba el rol), y un **encargado de
sucursal, que sí puede, no lo veía**. Era el último resto del `isCentral` usado como
permiso que ya se corrigió en el API hace dos rondas.

### A.2 · El inventario se ve de todas las sucursales; lo demás, no

**Lo que se pide (7 y 8):** que un vendedor pueda mirar el inventario de otros locales
—para decirle al cliente "en la central hay"— pero que ventas, caja y reportes sigan siendo
sólo de su sucursal. Y que el filtro **arranque siempre en su sucursal**.

Hoy `GET /inventory` aplica `filtroDeUbicacion()` y devuelve sólo la propia.

**Trabajo:**

- `inventory.ts`: quitar el filtro de alcance de la LECTURA y devolver todas las
  ubicaciones del negocio. El alcance de ESCRITURA (`canAdjustInventory`) no se toca: mirar
  no es ajustar.
- La respuesta ya trae `canAdjust` por fila; la pantalla usa eso para saber qué puede tocar.
- `InventoryPage`: el selector de ubicación deja de ser `isCentral &&` y sale para todos,
  **con la propia preseleccionada**. Ahí está el matiz que pidió: primero la suya.
- Lo que NO se toca: `/sales`, `/cash/*`, `/reports/*` siguen con `filtroDeUbicacion()`.

**Riesgo de que se vaya de las manos:** ver el inventario ajeno enseña _cuánto_ tiene el
otro local, lo cual es información del negocio y no de un compañero — está bien. Lo que no
puede colarse es el **costo**: `sinCostos()` ya cubre `/inventory`, y hay que añadir un test
que lo fije para el caso nuevo (un vendedor mirando otra sucursal).

**Tamaño:** pequeño. Un día. Es el de mejor relación de toda la lista.

### A.3 · Cuál es la sucursal principal, editable desde Ubicaciones

**Lo que se pide (9):** un campo en Ubicaciones para saber cuál es la central.

`location.is_central` existe en la base desde el principio, **no se puede cambiar desde
ninguna pantalla** y decide muchísimo: quién administra el negocio, quién ve todas las
sucursales, quién exporta. Hoy sólo lo pone el alta.

**Trabajo:**

- `PATCH /locations/:id` acepta `isCentral`, con dos reglas que no son opcionales:
  **sólo un admin de la central** puede moverlo, y **siempre tiene que quedar exactamente
  una**. Marcar otra como principal desmarca la anterior, en la misma transacción.
- ⚠️ **Efecto colateral que hay que decir en voz alta**: cambiar la central cambia el
  alcance de todo el mundo en el acto. Quien estaba en la vieja central deja de ver el
  negocio entero. La pantalla tiene que advertirlo antes de guardar, y conviene **revocar
  las sesiones** de los usuarios afectados, porque `isCentral` viaja dentro del token
  (mismo razonamiento que degradar a un usuario, que ya lo hace).
- `LocationsPage`: una marca clara de cuál es la principal y la acción para cambiarla.

**Tamaño:** mediano, por el efecto sobre las sesiones. Dos días.

### A.4 · El modo oscuro es de la persona; lo demás, del negocio

**Lo que se pide (9):** el modo va por usuario; nombre, colores, etc. son del negocio y los
toca el admin principal.

**Ya está así, y conviene no revertirlo**: el modo se guarda en `localStorage` (es la única
preferencia por dispositivo — dos personas del mismo local pueden quererlo distinto) y el
selector vive tanto en Configuración como en **Mi perfil**, que es la que ve todo el mundo.

Lo que sí queda por hacer es **quitarlo de Configuración**: ahí está duplicado, y esa
pantalla es `adminOnly centralOnly`, lo que sugiere que el modo es una decisión del dueño
cuando no lo es. Cinco minutos, va con A.3.

**Tamaño:** trivial.

---

## Bloque B — Ubicaciones y usuarios: borrar de verdad o desactivar (punto 4)

**Lo que se pide:** poder editar y eliminar; borrado **físico** si no tiene ningún registro,
**desactivación** si los tiene (y entonces ya no entra al sistema).

Hoy **no existe ninguna ruta de borrado**, ni de ubicación ni de usuario: sólo `PATCH` con
`isActive`. Lo que se pide es exactamente la política correcta, y merece implementarse tal
cual.

**Trabajo:**

- `DELETE /locations/:id` y `DELETE /users/:id`, ambos de admin de la central.
- Cada uno cuenta primero lo que cuelga:
  - **ubicación** → ventas, inventario, turnos de caja, usuarios asignados;
  - **usuario** → ventas registradas, turnos abiertos o cerrados, entradas de bitácora.
- **Sin registros** → `DELETE` de verdad, y se responde diciendo que se borró.
- **Con registros** → NO se borra, se desactiva, y se responde **diciendo cuántos y de
  qué** ("tiene 340 ventas y 12 turnos; se desactivó"). Un "no se puede borrar" a secas
  obliga a adivinar.
- Guardas que no pueden faltar: no borrar la **última ubicación**, no borrar la **central**
  (primero hay que mover el cargo, ver A.3), y no borrar al **último admin** — esta última
  ya existe desde ayer y se reutiliza.
- Desactivar un usuario ya revoca sus sesiones; borrarlo también debe hacerlo.

**Riesgo:** un borrado físico no se deshace. Las ventas tienen `location_id` con
`on delete cascade` en algunas tablas — **hay que revisar cada FK antes de escribir esto**,
porque un cascade mal puesto convierte "borrar una sucursal vacía" en "borrar el historial".
Ese repaso es la mitad del trabajo.

**Tamaño:** mediano. Dos o tres días, la mayor parte en el repaso de claves foráneas y en
los tests de lo que NO se debe poder borrar.

---

## Bloque C — Exportar todo, en PDF y Excel (punto 12)

**Lo que se pide:** que en todas las secciones se puedan descargar los datos, sólo para el
admin principal, en PDF y Excel.

Hoy existe `GET /business/export`, que baja **todo el negocio en JSON** y es de admin de la
central. Sirve para migrar, no para "quiero el listado de ventas de marzo en Excel".

**Trabajo, y aquí hay una decisión de diseño que ahorra la mitad:**

En vez de escribir un exportador por pantalla, **una sola ruta genérica** que reciba la
misma consulta que la pantalla ya usa (`/sales?from=&to=&locationId=`) y un formato. Cada
listado ya sabe filtrar; lo único nuevo es el formateo.

- `GET /export/:seccion?formato=xlsx|pdf&<mismos filtros de la pantalla>`
- Secciones: ventas, productos, inventario, clientes, caja, actividad.
- **Excel**: `exceljs` o `xlsx`. Es el formato que de verdad se usa — se abre, se filtra,
  se suma.
- **PDF**: es el caro. Un PDF decente necesita plantilla, cabecera con la marca del
  negocio, paginación y totales. `pdfkit` en el servidor, o generarlo en el navegador con
  la vista de impresión que **ya existe para los recibos**.
- Alcance: `requireCentralAdmin`, y cada consulta pasa por `filtroDeUbicacion()` y
  `sinCostos()` igual que su pantalla — es exactamente la clase de ruta por la que se
  escapan los costos si se escribe con prisa.
- Tope de peticiones propio, como el que ya tiene la exportación completa.

**Recomendación: hacer Excel primero y PDF después.** Excel cubre el 90 % de lo que se pide
(guardar, migrar, revisar) con una fracción del trabajo. El PDF es para imprimir y firmar,
que es un caso más raro.

**Tamaño:** Excel, dos días. PDF, otros tres. Se pueden separar.

---

## Bloque D — Cargar el inventario inicial sin teclearlo (punto 10)

**Lo que se pide:** que al empezar, un cliente pueda subir su inventario desde Excel, o
**sacarle foto a sus notas de papel** y que una IA lo convierta. Con más de 5.000 registros,
teclear es inviable — y ese primer día es cuando se decide si el cliente se queda.

Es, con diferencia, **el requerimiento de mayor valor comercial de la lista**: es la barrera
de entrada del producto.

Hay que partirlo en dos, porque son dos cosas muy distintas.

### D.1 · Importar desde Excel / CSV — hacer primero

`POST /products/import` ya existe (y desde ayer respeta la cuota del plan). Falta la parte
difícil, que **no es leer el archivo**: es que el archivo de un cliente real nunca tiene las
columnas que uno espera.

**Trabajo:**

- Leer `.xlsx` además de CSV (`sheetjs` en el navegador; el archivo ni siquiera necesita
  llegar al servidor para la vista previa).
- **Mapeo de columnas asistido**: se leen las cabeceras del archivo, se proponen las
  correspondencias ("Descripción" → nombre, "Cant." → stock) y la persona corrige. Sin
  esto, la importación falla en el primer intento y no se vuelve a usar.
- **Vista previa antes de escribir nada**: las 20 primeras filas ya interpretadas, con los
  errores marcados. Nadie confía en un botón que se traga 5.000 filas a ciegas.
- Informe al terminar: cuántas entraron, cuántas se saltaron y **por qué**, con opción de
  bajar las rechazadas para corregirlas y reintentar sólo ésas.
- Por lotes de 200-500 filas con barra de progreso: 5.000 en una sola petición se pasa de
  cualquier tiempo de espera razonable.

**Tamaño:** cuatro o cinco días. La mayor parte es el mapeo y el informe de errores, no la
importación.

### D.2 · Foto de las notas a mano → productos — después, y como experimento

Técnicamente es viable hoy: un modelo con visión lee una tabla manuscrita razonablemente
bien. Lo que hay que decidir antes de escribir una línea:

1. **Quién paga.** Cada foto es una llamada a un modelo de pago. Con 5.000 productos en
   fotos de 30 filas son ~170 llamadas. Tiene que estar en el precio del plan, o ser un
   servicio de alta que se cobra aparte.
2. **Nunca escribe directo.** Lo que salga de la foto va a la **misma vista previa de
   D.1**, para revisar y corregir. Un precio mal leído es dinero mal cobrado durante meses.
3. **Datos de terceros a un servicio externo.** El inventario de un cliente sale de nuestro
   servidor. Eso **hay que decirlo en los términos** antes de encenderlo — es exactamente
   el caso que el skill de legal existe para vigilar.

**Recomendación:** D.1 primero y completo. D.2 después, reutilizando su vista previa, y
como función de pago o de alta asistida. Sin D.1, D.2 no tiene dónde aterrizar.

**Tamaño:** tres días sobre D.1 ya hecho, más la decisión comercial y la legal.

---

## Bloque E — Imágenes y descripción de producto (punto 11)

**Lo que se pide:** ver los productos con imagen en el POS y en Productos; poder subirla o
sacar la foto; que el sistema la comprima sin estropearla, la recorte y **le quite el
fondo**; y una descripción visible al vender.

La preocupación por el almacenamiento es correcta y tiene solución conocida.

**Trabajo, por partes:**

- **La descripción ya existe** en la base (`product.description`). Enseñarla en el POS son
  un par de horas. Hacerla primero: es gratis.
- **Subida con redimensionado en el NAVEGADOR, antes de subir.** Es la decisión que resuelve
  el problema del almacenamiento: `canvas` a 800×800, WebP con calidad 0.8, deja una foto de
  móvil de 4 MB en unos 60 kB. También ahorra el ancho de banda de subida, que en la
  conexión de una tienda importa más que el disco.
- **Dónde se guardan.** No en la base. Lo natural aquí es un bucket compatible con S3 —
  ya hay un MinIO corriendo en esta máquina— o el disco del VPS con un volumen. Decisión que
  hay que tomar antes de escribir el endpoint. Con 60 kB por producto, 5.000 productos son
  300 MB: cabe en disco sin drama.
- **Quitar el fondo.** Es lo más caro y lo menos necesario. Un servicio externo cuesta por
  imagen; hacerlo en el navegador con un modelo pequeño es posible pero pesa varios MB de
  descarga. **Recomendación: no hacerlo al principio.** Con recorte cuadrado y fondo neutro
  en la tarjeta, la rejilla se ve ordenada igual. Si después se pide, va como función de
  pago.
- **Cuota por plan**: las imágenes son el primer coste variable real del producto. Conviene
  que el número de productos con imagen entre en los límites del plan desde el día uno, no
  después.

**Tamaño:** descripción, medio día. Subida con redimensionado y almacenamiento, cuatro
días. Quitar el fondo, aparte y sólo si se pide.

---

## Bloque F — Contratación anual con descuento (punto 5)

**Lo que se pide:** que el admin principal pueda cotizar más de un año (hasta 5) con
descuento por contratar más tiempo, como en el hosting.

Hoy los planes son mensuales (`priceMonthly`) y `subscription` guarda un
`current_period_end`. No hay ciclo anual ni descuento por permanencia.

**Trabajo:**

- `plans.ts`: añadir ciclos y su descuento. Un solo sitio, como ya está la disciplina de
  precios (`seed-plans`).
- `subscription`: guardar el ciclo contratado y calcular el vencimiento a partir de él.
- Panel de plataforma: al cambiar el plan, elegir ciclo y ver el total con el descuento
  aplicado antes de confirmar.
- Es del **operador principal**, no de cualquiera — la línea ya está trazada.

**Cuidado con dos cosas:**

1. **Un descuento por 5 años es dinero cobrado por adelantado con una obligación de 5 años
   detrás.** Eso es una decisión de negocio, no de código: qué pasa si el cliente se va al
   año dos, y si se devuelve algo. Conviene tenerlo escrito antes de ofrecerlo.
2. Esto **toca lo mismo que el cobro automático** (#11 del plan del SaaS), que está
   bloqueado por el alta como comercio en la pasarela. Hacer el descuento anual sin la
   pasarela significa cobrar por transferencia y marcar el pago a mano — que es lo que ya
   se hace, así que es viable, pero conviene saberlo.

**Tamaño:** dos días de código. La decisión comercial es lo que hay que resolver antes.

---

## Orden que recomiendo

| Orden | Qué                                             | Por qué antes                                                                               | Tamaño   |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| 1     | **A.2** inventario de todas las sucursales      | Lo pide el mostrador todos los días y es un día de trabajo                                  | 1 día    |
| 2     | **A.4** quitar el modo de Configuración         | Va de paso                                                                                  | trivial  |
| 3     | **E** descripción en el POS                     | Ya está en la base; horas                                                                   | 0,5 día  |
| 4     | **D.1** importar Excel con mapeo y vista previa | **Es la barrera de entrada del producto.** Sin esto no entra un cliente con 5.000 productos | 4-5 días |
| 5     | **C** exportar en Excel                         | Cierra el ciclo: entran y salen datos                                                       | 2 días   |
| 6     | **B** borrar/desactivar ubicaciones y usuarios  | Importante, pero se convive sin ello                                                        | 2-3 días |
| 7     | **A.3** cambiar la sucursal principal           | Poco frecuente y con efectos fuertes: hacerlo con calma                                     | 2 días   |
| 8     | **E** imágenes con redimensionado               | Vistoso y caro; cuando lo de arriba esté                                                    | 4 días   |
| 9     | **F** contratación anual                        | Necesita la decisión comercial primero                                                      | 2 días   |
| 10    | **C** exportar en PDF                           | El caso más raro de todos                                                                   | 3 días   |
| 11    | **D.2** foto de notas con IA                    | Depende de D.1 y de dos decisiones (coste y legal)                                          | 3 días   |

**Lo primero de todo, antes que cualquiera de estos**, sigue siendo lo del despliegue:
`docs/DESPLIEGUE_TRAS_REVISION.md` y el backup del VPS. Todo lo de esta lista es
crecimiento; aquello es lo único que, si sale mal, no se recupera.

---

## Lo que hace falta decidir antes de empezar

Cuatro cosas que no puedo resolver yo:

1. **Ciclos anuales (F)**: qué pasa si un cliente con 3 años pagados se va al segundo.
2. **La IA de las fotos (D.2)**: quién paga las llamadas, y ¿se acepta que el inventario de
   un cliente salga hacia un servicio externo? Eso hay que ponerlo en los términos.
3. **Dónde viven las imágenes (E)**: bucket estilo S3 o disco del VPS.
4. **Quitar el fondo (E)**: ¿se sostiene el coste, o basta con recorte cuadrado?
