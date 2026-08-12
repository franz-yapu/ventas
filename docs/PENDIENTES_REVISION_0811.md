# Los nueve de la revisión del 11 — cerrados el 12 de agosto

> **Los nueve están hechos.** Este documento se queda como registro de qué se arregló y de
> lo que apareció por el camino. Lo que sigue abierto está al final, en «Lo que no era de
> esta lista».
>
> 783 tests en verde (502 API + 281 web), frente a los 730 con los que se cerró el día 11.
> Cada arreglo se escribió con su test fallando primero y, cuando el test se escribió
> después del arreglo, se rompió el arreglo a propósito para comprobar que se enteraba.

---

## 1 · El PDF afirmaba un alcance que no tenía ✅

`/export/:seccion` aceptaba `from`, `to` y `locationId` y nada más, mientras las pantallas
filtraban por bastante más. Ahora acepta también `status` (ventas), `search` (productos) y
`action`/`entity`/`userId` (actividad), con el mismo criterio que las fechas: **lo que no se
entiende se rechaza**, porque ignorarlo devuelve el listado completo con un 200.

Las pantallas los pasan y `describirFiltros` los escribe en el papel en castellano, con los
mismos rótulos de `@ventafacil/shared` que usa el servidor — no una segunda lista.
`AuditPage` pasa además el NOMBRE de la persona, como ya hacía con la sucursal: el papel
dice «por Ana Pérez», no un uuid.

**`locationId` en Productos se deja fuera a propósito**: ahí la ubicación decide de qué
sucursal es el stock que se enseña, no qué productos salen, y la exportación no lleva
columna de stock. Aplicarlo recortaría un listado que en pantalla no estaba recortado.

**Lo que destapó mirar el PDF, que no vio ningún test.** Con los filtros nuevos, la línea de
filtros creció hasta meterse debajo de «Generado por …» —comparten renglón— y las dos
quedaban ilegibles: se leía `…de 2026 · SucGenersaldoNporteAna Pérez`. Se vio con
`pdftoppm -png`. Ahora `partirFiltros` la reparte en las líneas que hagan falta y la
cabecera crece con ellas. **Nunca se recorta**: ese texto dice qué recorte de los datos es
el papel, y un papel que se firma no puede describirse a medias.

## 2 · «50 compras» cuando tenía 137 ✅

El detalle devuelve ahora `comprasCompletadas` y `comprasRegistradas`, las dos en la misma
consulta que el gasto (con `FILTER`), para que no puedan calcularse sobre conjuntos
distintos. Son dos cifras porque responden dos preguntas que ya estaban las dos en pantalla:
la de arriba va al lado del dinero, así que cuenta lo mismo que el dinero; la otra es el
largo del historial, donde las anuladas sí salen. Y bajo la lista, cuando viene cortada, se
dice: «Mostrando las 50 más recientes de 139».

## 3 · «Cancelar» durante un borrado dejaba la lista mintiendo ✅

Con el DELETE en vuelo ya no se cierra por ninguna de las cuatro puertas —Cancelar, Escape,
el aspa y el clic fuera—, y el botón Cancelar sale apagado. Se cierra la puerta en vez de
invalidar por detrás porque es lo honesto: la operación ya salió.

## 4 · La miniatura se quedaba en el hueco para siempre ✅

Se guarda **qué url** falló en vez de un booleano, así que cambiar la foto ya es reintentar,
sin ningún efecto de por medio. Y se olvida el fallo al volver la conexión, que era el caso
del docstring: en el POS las filas conservan su `key`, así que sin eso la única salida era
recargar la página con una venta a medias.

## 5 · La rejilla del POS se movía bajo el dedo ✅

`hayFotosEnCatalogo()` le pregunta al catálogo entero, no a las 24 filas visibles. La
respuesta ya no cambia según lo que se teclee, que era lo que recolocaba la rejilla a mitad
de pulsación.

## 6 · Un nombre de sólo espacios se guardaba vacío ✅

Recortado **en el esquema** (`z.string().trim().min(1)`), antes de validar, así que queda
arreglado de una vez en las dos puertas que lo usan. Y se quitó el `.trim()` de la ruta, que
ya no protege nada y prometía hacerlo. De paso apareció que el ALTA ni siquiera recortaba:
guardaba `"  Doña Rosa  "` tal cual.

## 7 · «compras» contaba las anuladas; el total no ✅

**Decisión de producto (franz, 12 de agosto):** la columna responde «cuánto me ha comprado»,
no «cuántas veces pasó por caja». Cuenta sólo completadas, igual que el gasto, y
`ultimaCompra` también. El historial del detalle las sigue enseñando, marcadas, porque ahí la
pregunta es otra.

## 8 · La fecha del nombre del archivo iba en UTC ✅

`fechaDeArchivo()` da `AAAA-MM-DD` en la zona del negocio. El test congela el reloj en la
franja de cuatro horas en la que las dos zonas dan días distintos: sin fijarlo, pasaría 20 de
cada 24 horas sin probar nada.

## 9 · Borrar un comprador eran dos transacciones ✅ — y era peor de lo anotado

Estaba marcado como _plausible_. **Es reproducible**, y juntar las transacciones NO bastaba:
en READ COMMITTED un `SELECT count(*)` no bloquea nada, así que la venta se confirma justo
después de contar y el `DELETE` sigue adelante igual. Lo que cierra la ventana es tomar la
fila del comprador con `FOR UPDATE` antes de contar: insertar una venta toma `FOR KEY SHARE`
sobre la fila que referencia, así que los dos caminos se serializan.

El test lo fuerza en vez de esperar a tener suerte — deja una venta insertada sin confirmar,
lanza el borrado y la confirma después— y **fallaba de forma determinista** antes del
arreglo. La bitácora se escribe fuera de la transacción a propósito: dentro, la fila se
quedaría tomada mientras se escribe, y es justo la fila que el cajero necesita.

---

## Lo que no era de esta lista y sigue esperando

- **`react-router-dom` 6.27 → 6.30.5**: tres avisos moderados (open redirect → XSS) que el
  CI no ve porque corta en `high`. Con la suite delante: en esta rama una subida de versión
  ya rompió seis caminos sin test.
- **`TERMS_VERSION` no se compara con nada.** Se guarda al registrarse y ahí muere.
- **El VPS entero**, que es lo único irrecuperable. Leer antes
  `docs/DESPLIEGUE_TRAS_REVISION.md`: los secretos de ejemplo, la migración 0019 y el volumen
  de las fotos.

## Lo que apareció el 12 y no se tocó

- **«Cancelada» y «Anulada» son la misma cosa con dos nombres.** La badge de `SalesPage`
  dice «Cancelada» (texto suelto en el JSX) y `SALE_STATUS_LABELS.cancelled` —que es lo que
  sale en el Excel, en el PDF y ahora en la línea de filtros— dice «Anulada». Nadie lo nota
  hasta que compara la pantalla con el papel. Es un rótulo, pero es exactamente la forma en
  la que ya se separaron las acciones de la bitácora: 21 en el servidor, 8 en la pantalla.
- **Que `PosPage` llame a `hayFotosEnCatalogo` no lo cubre ningún test**, porque esa pantalla
  no se monta en la suite (arrastra Dexie, el escáner y el proveedor de tema, y está
  documentado por qué). La decisión sí está probada; la llamada se comprobó leyendo el
  cambio. Es la clase de hueco que en este proyecto ya costó tres veces.
