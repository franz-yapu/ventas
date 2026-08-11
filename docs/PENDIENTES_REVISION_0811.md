# Los nueve que quedaron de la revisión del 11 de agosto

> De los **58 hallazgos verificados** sobre los siete commits del 11, se arreglaron los seis
> bloqueantes (`af0a85f` y `eeb4ba1`). Estos nueve quedaron anotados: ninguno impide
> desplegar, pero todos son visibles para quien usa el sistema.
>
> Las líneas están comprobadas contra el árbol el 2026-08-11 por la noche, después de los
> arreglos de esa tarde. **Se puede empezar por cualquiera**: no dependen entre sí.

**La disciplina que se aplicó a los otros seis, y que vale para estos:** escribir primero el
test que falla, arreglar, y luego **romper el arreglo a propósito** para comprobar que el
test se entera. Tres veces esta semana un test pasó a la primera sin estar probando nada.

---

## 1 · El PDF afirma un alcance que no tiene

**`apps/web/src/components/Exportar.tsx:72`** · media jornada

Sólo se reenvían `from`, `to` y `locationId` a `/export/:seccion`. Pero las pantallas
filtran por más cosas:

| Pantalla       | Filtra en pantalla                   | Manda a exportar           |
| -------------- | ------------------------------------ | -------------------------- |
| `SalesPage`    | `status` (línea 30)                  | `from`, `to`, `locationId` |
| `AuditPage`    | `action`, `entity`, `userId` (44-46) | `from`, `to`               |
| `ProductsPage` | `search` (27), `locationId`          | nada                       |

Un admin filtra Ventas a «Anuladas» de agosto, ve 12 filas, pulsa PDF y se lleva un papel
titulado «Ventas · del 1 al 31 de agosto de 2026» **con todas las completadas dentro**. En
el Excel esto ya pasaba y era un incordio; en el PDF es peor, porque `lineaDeFiltros`
**afirma por escrito** lo que contiene y ese papel se firma y se archiva.

**Arreglo.** Las dos mitades, y la primera no es opcional:

1. `apps/api/src/modules/export.ts:235` acepta hoy sólo `from`/`to`/`locationId`. Añadir
   `status` (ventas), `search` (productos) y `action`/`entity`/`userId` (actividad), con el
   mismo cuidado de validación que las fechas.
2. Que las pantallas los pasen, y que `lineaDeFiltros` los escriba en el papel («Anuladas ·
   del 1 al 31 de agosto»).

Si por lo que sea no se hace lo primero, entonces **el PDF no puede callarlo**: tendría que
decir «todas las ventas del rango, sin el filtro de estado de la pantalla». Un papel firmado
no puede describirse a medias.

**Test.** En `apps/web/test/exportar.test.tsx` ya está montado el andamio: comprobar que un
filtro de la pantalla llega a la petición y sale impreso en la línea de filtros.

---

## 2 · El detalle del cliente dice «50 compras» cuando tiene 137

**`apps/web/src/features/customers/CustomersPage.tsx:357`** · 2 horas

El modal cuenta `data.compras.length`, y el API corta esa lista en 50
(`customers.ts`, `.limit(50)`). El `totalGastado` **no** está cortado: se suma sobre todas
las completadas, y lo dice su propio comentario.

O sea que la misma pantalla afirma dos cosas incompatibles —la tabla dice 137 y el detalle
50— y empareja «50 compras» con el gasto de 137: el ticket medio parece 2,7 veces el real.
Y el historial se trunca **sin decirlo**, así que un recibo más antiguo que el 50.º
simplemente no aparece — que es justo la pregunta para la que se hizo la pantalla.

**Arreglo.** Que el API devuelva también el total de compras (un `count` aparte, como el de
la lista) y que el modal use ese número. Y bajo la lista, cuando esté cortada, decirlo:
«mostrando las 50 más recientes de 137».

---

## 3 · «Cancelar» durante un borrado deja la lista mintiendo

**`apps/web/src/components/EliminarModal.tsx:66` y `:110`** · 2 horas

`Cancelar` sigue habilitado mientras el DELETE está en vuelo, y `cerrar()` sólo llama a
`onCambio()` si `cambio` es `true` — que se pone **después** de que resuelva la promesa.

Un admin confirma el borrado de «Marta Quispe», la petición va lenta, pulsa Cancelar (o Esc,
que es el mismo `cerrar`): la lista no se invalida y —con `refetchOnWindowFocus: false`—
sigue mostrando a Marta como si nada. Pero el DELETE termina igual: en el servidor ya no
está. Vuelve a pulsar la papelera y recibe «no encontrado». Afecta también a
`LocationsPage` y `UsersPage`, donde además se pierde el mensaje de «se desactivó en su
lugar», que es el que evita que alguien intente borrar otras cosas para destrabarlo.

**Arreglo.** Deshabilitar `Cancelar` mientras `enviando` (y que Esc no cierre), o invalidar
igualmente al terminar aunque el modal ya no esté. Lo primero es más honesto: la operación
ya no se puede cancelar, así que el botón no debería decir que sí.

---

## 4 · La miniatura se queda en el hueco para siempre

**`apps/web/src/features/products/FotoDeProducto.tsx:169`** · 1 hora

`falló` se pone a `true` en el primer `onError` (línea 182) y **no se reinicia nunca**: ni
cuando cambia la prop `url` ni cuando vuelve la red.

Es exactamente el caso que describe el docstring del componente. Un vendedor pierde señal en
el POS, todas las miniaturas caen al marcador (correcto), vuelve la señal — y como las filas
mantienen el mismo `key={p.id}`, siguen montadas las mismas instancias y **el catálogo se
queda sin fotos el resto de la sesión**, hasta recargar. Lo mismo al reemplazar una foto
cuya URL anterior había fallado: la nueva sale como marcador y la subida parece no haber
hecho nada.

**Arreglo.** Reiniciar `falló` cuando cambie `url` (un `useEffect`, o `key={url}` en el
`<img>`). Ojo con el test: comprobar que tras un `fireEvent.error` y un cambio de `url`
vuelve a haber `<img>`.

---

## 5 · La rejilla del POS se mueve bajo el dedo del cajero

**`apps/web/src/features/pos/PosPage.tsx:93`** · 2 horas

`hayFotos` se calcula sobre `products`, que es la ventana de **24 filas** que devuelve
`searchCatalog`, no sobre el catálogo. El comentario de ahí al lado dice que la banda de
imagen tiene que ser todo-o-nada «para TODA la rejilla», que es justo lo que rompe
derivarla de un subconjunto.

Dos desenlaces, y el segundo es el malo:

- Una tienda con 500 productos y fotos en unos pocos: si ninguno de los 24 primeros por
  orden alfabético tiene foto, el POS **no enseña ninguna** y el dueño que acaba de subirlas
  cree que la función está rota.
- El cajero teclea «fil», un resultado sí tiene foto, `hayFotos` cambia y **todas** las
  tarjetas ganan 80 px de golpe: la rejilla se recoloca a mitad de pulsación y **se añade el
  producto equivocado a la venta**.

**Arreglo.** Que la decisión salga del catálogo entero (una consulta de «¿hay alguna foto en
este negocio?», o un dato del negocio), no de la página visible. Con eso la banda deja de
depender de lo que se teclea.

---

## 6 · Un nombre de sólo espacios se guarda vacío

**`apps/api/src/modules/customers.ts:208`** · 1 hora

`cambios.name = d.name.trim()` corre **después** de que zod haya validado: `patchCustomerSchema`
acepta `{ name: " " }` porque cumple `.min(1)`, y lo que se guarda es `""`.

A partir de ahí el cliente sale con la celda Nombre en blanco en la tabla, la confirmación
de borrado dice «¿Eliminar a ?», y la columna «Cliente» del recibo y de la exportación de
ventas salen vacías en todas sus ventas — sin forma de saber desde la lista de quién se
trata.

**Arreglo.** Recortar **en el esquema** (`packages/shared/src/schemas.ts`: `z.string().trim().min(1)`),
que además arregla de una vez todos los sitios que usan ese esquema. `compradores.test.ts`
cubre `{ name: '' }` pero no `{ name: '   ' }`.

---

## 7 · «compras» cuenta las anuladas; el total gastado no

**`apps/api/src/modules/customers.ts:67`** · 1 hora

El `count(schema.sale.id)` de la lista no filtra por estado, y el `totalGastado` del detalle
sí (`status = 'completed'`). Un cliente cuyas dos únicas compras se anularon aparece con
«2 compras» y «Bs. 0.00» gastados — y `ultimaCompra` apunta a una venta que ya no cuenta.

**Arreglo.** Decidir qué pregunta responde la columna y que las dos cifras respondan la
misma: o el count filtra por completadas, o la columna se llama «ventas registradas».
Es una decisión de producto pequeña, pero es una decisión.

---

## 8 · La fecha del nombre del archivo va en UTC

**`apps/web/src/components/Exportar.tsx:85`** · media hora

`descargar` arma el nombre con `new Date().toISOString().slice(0, 10)` —UTC— mientras que
todo lo que se imprime dentro del PDF va en `America/La_Paz` (UTC−4). Un informe generado a
las 21:00 del 11 de agosto se guarda como `ventas-2026-08-12.pdf` y la hoja dice «Generado
… 11/8/26, 9:00 p. m.». Como estos papeles se archivan, la carpeta y el papel discrepan
sobre qué día se hizo.

**Arreglo.** Sacar la fecha del nombre de la misma zona que el resto. Cuidado con reusar
`dateTime()`, que devuelve `11/8/26` y no sirve para ordenar archivos: hace falta
`AAAA-MM-DD` en la zona del negocio.

---

## 9 · Borrar un comprador son dos transacciones

**`apps/api/src/modules/customers.ts:251`** · 2 horas · _verificado como PLAUSIBLE, no confirmado_

`colgandoDeComprador()` cuenta las dependencias en su propia transacción y el `delete` corre
en otra. La ruta de abonos que se borró con el fiado llevaba escrito por qué esto importa:
«comprobar el cliente y registrar el abono en la misma transacción, para que no pueda
colarse un abono si el cliente desaparece entre una consulta y la otra».

Un admin borra a «Recién llegado» (0 compras) justo cuando un cajero cierra su primera
venta: la cuenta ya devolvió 0, el comprador se borra en duro y `sale.customer_id` cae a
NULL. El recibo recién emitido pierde para siempre a quién iba dirigido — la pérdida exacta
que la política de borrar-o-desactivar existe para evitar — y el API responde «se eliminó»
sin decir que algo quedó huérfano.

**Arreglo.** Contar y borrar dentro del mismo `withTenant`. La ventana es estrecha, por eso
quedó como plausible y no confirmado; el arreglo es barato de todas formas.

---

## Y lo que no es de esta lista pero espera al lado

De `docs/DESPLIEGUE_TRAS_REVISION.md`, para no perderlo de vista:

- **`react-router-dom` 6.27 → 6.30.5**: tres avisos moderados (open redirect → XSS) que el
  CI no ve porque corta en `high`. Con la suite delante, no de camino al despliegue: en esta
  rama una subida de versión ya rompió seis caminos sin test.
- **`TERMS_VERSION` no se compara con nada.** Se guarda al registrarse y ahí muere, así que
  un negocio que ya opera nunca se entera de que cambiaron los términos — y hoy cambiaron
  dos veces.
- **El VPS entero**, que es lo único irrecuperable.
