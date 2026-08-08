# Informe — segunda revisión con agentes, 7 de agosto de 2026 (noche)

Sobre **todo lo construido hoy**: 24 commits, 123 archivos, +10.400 líneas. Tres agentes
en paralelo, como la ronda de la mañana. **Los hallazgos del peer review y del QA funcional están arreglados** (`ae068da`,
`2161bfc`), más un hueco que salió de las métricas (`8a7a922`). Los del **QA visual llegaron
al final y quedan pendientes** — están al final de este documento y en el plan de mañana.

---

## Lo primero, porque cambia cómo hay que leer el resto

**Seis de los hallazgos son fallos que yo introduje hoy mismo**, algunos hace dos horas.
No son deuda vieja: son código escrito esta tarde, con sus tests en verde, que no
funcionaba.

Vale la pena decirlo porque explica para qué sirvió la ronda: no para encontrar lo que
alguien dejó mal hace meses, sino para atrapar lo que se acababa de romper antes de que
llegara a una caja.

---

## El peor: quien pagaba cinco años dejaba de vender el día 15

`apps/api/src/modules/platform.ts`

Contratar un ciclo escribía `billedAmount` y `currentPeriodEnd`, pero **no tocaba `status`
ni `trialEndsAt`** — y `effectiveStatus` sólo mira esos dos; `currentPeriodEnd` no lo
consulta nadie.

Así que un negocio **en prueba** que pagaba 6.258 Bs por cinco años seguía con la
suscripción diciendo "en prueba, vence en quince días". Al día quince: `trial_expired` →
402 → la caja no vende. **Le tocaba justo al mejor cliente.**

Arreglado: contratar activa la suscripción y limpia la fecha de prueba. Test que va rojo
sin el arreglo.

Del mismo endpoint salieron dos más:

- **Reenviar el mismo ciclo** —un doble clic, un reintento tras un timeout— movía
  `cycleStartedAt` a hoy y el vencimiento cinco años más allá: años regalados y una
  devolución calculada sobre un tiempo que el cliente no ha esperado.
- **Cambiar de plan sin decir el ciclo** dejaba el `billedAmount` del plan anterior. Bajar
  de Ilimitado a Básico daba una devolución mayor que un año entero del plan nuevo. Ahora
  se borra: mejor no poder calcularla —y tener que preguntar— que calcularla mal y pagarla.

---

## Una sucursal desactivada seguía vendiendo

`apps/api/src/lib/sales-service.ts`

Al desactivar, el sistema responde _"deja de usarse y su historial se conserva"_. La
segunda mitad era cierta. La primera no.

El vendedor asignado seguía entrando y grabando ventas con normalidad en un local que el
dueño creía cerrado. Y peor: `POST /cash/open` **sí** rechazaba la sucursal inactiva, así
que ese efectivo **no tenía ningún turno al que colgarse**. Ventas reales, dinero real, y
ni arqueo ni descuadre que lo delatara.

Cerrado en `sales-service`, que cubre las dos puertas: la venta en línea y el sync de la
cola offline. Si sólo se cerrara una, bastaría con perder la conexión para saltársela.

Y al lado: **`PATCH /locations/:id {"isActive": false}` rodeaba las dos guardas del
`DELETE`** — dejaba desactivar la central, incluso siendo la única, con un 200. Después ni
su propio admin podía abrir caja. Ocho puertas cerradas y una abierta dan el mismo
resultado que ninguna cerrada.

---

## Dos regresiones mías, de hace dos horas

**El arreglo de zona horaria convirtió un fallo silencioso en un 500.** `2026-08-32` casa
el patrón `AAAA-MM-DD` pero da un `Invalid Date`, y `Intl` lanza con él. Y cada 500 escribe
"error no controlado" **y manda un aviso por correo**: bastaba un rastreador probando URLs
para llenar el buzón de operación con avisos de algo que no está roto.

Al mirarlo salió algo peor, y que venía de antes: **una fecha que no se entendía se
ignoraba y devolvía el informe COMPLETO**. Alguien pide una semana, recibe dos años, y no
tiene forma de notarlo — el archivo llega, sólo que con todo dentro.

JavaScript resultó demasiado amable para esto: `2026-02-30` no falla, la **rueda** al 2 de
marzo; y `01-08-2026` la lee como 8 de enero. Ahora se comprueba que los números vuelvan a
salir iguales.

**Y mi recuento de turnos decía "2" donde había uno**, por sumar `user_id` y `closed_by` sin
descontar a quien abrió y cerró el mismo. Ese mensaje es lo único que le explica a alguien
por qué no puede borrar; un número inflado hace dudar de todo el mensaje.

---

## La importación numeraba mal las filas

`ImportarProductos.tsx`

`desdeFila` se desincronizaba **en cuanto una fila venía mal**: los lotes se arman con las
filas buenas, pero el servidor numera denso. Si las buenas son las líneas 2, 3 y 5, un
error en la tercera se informaba como "fila 4" — una fila que en el archivo está bien,
mientras la que de verdad falló no aparecía. Quien corrige va a la 4, no ve nada raro, y
deja de fiarse del informe entero.

La traducción pasa al cliente, que es el único que sabe qué filas se saltó.

Y **un lote que se caía descartaba en silencio las restantes** mostrando el visto verde
igual. Ahora entran al informe y salen en el CSV de rechazadas.

Además, **`"1.234"` entraba como Bs 1,23**: un separador solo es ambiguo y ganaba `Number`.
Ahora desempata contando dígitos — tres detrás es de miles, porque nadie escribe tres
decimales en un precio.

---

## El escáner leía una lista obsoleta

`PosPage.tsx` + `offline/catalog.ts`

`useLiveQuery` devuelve el resultado de la consulta **anterior** mientras la nueva corre, y
un lector USB teclea el código y pulsa Enter en el mismo instante: **el primer escaneo de
cada producto no agregaba nada**.

Mi prueba de ayer pasó sólo porque escribí y esperé 700 ms antes de Enter. Ahora consulta
la base (`findByCode`).

---

## Dos cosas más, pequeñas pero con el mismo patrón

- **`sinCostosLista` en el export era un no-op**: busca las claves `cost`, y ahí las
  columnas se llaman `Costo` en español. El comentario prometía una red que no existía —
  peor que no tener ninguna, porque el siguiente que pase lo lee y se queda tranquilo.
- **`borrado.ts` no contaba `cash_register.closed_by` ni `sale.cancelled_by`** (ambas en
  SET NULL): un borrado dejaba turnos cerrados sin saber quién los cerró y ventas anuladas
  sin saber quién las anuló. Precisamente las dos acciones sobre las que un dueño
  preguntaría.

---

## Lo más útil del informe: tres tests míos que no comprobaban nada

- El de la **confirmación de cobro** probaba una **copia de la regla escrita en el propio
  test**: cero líneas del código real. La regla se extrajo a `features/pos/confirmar.ts` y
  ahora se importa la de verdad — comprobado cambiando el umbral: se pone rojo.
- El de **accesibilidad** verificaba el `disabled` nativo del navegador, no la clase que
  decía vigilar.
- El de **ciclos** era una tautología: `total + ahorro === sinDescuento` es cierto por
  construcción. Ahora contrasta el total por otro camino.

**Los tres pasaron a la primera, y eso debería haber sido la señal.** Es exactamente contra
lo que existe la regla de "verlo rojo primero", y no la apliqué.

---

## Una guarda que no pidió nadie, y salió escribiendo un test

Al aislar el test de concurrencia de la sucursal principal apareció esto: **mover la
central a una sucursal sin ningún admin deja al negocio sin nadie que pueda
administrarlo** — ni crear usuarios, ni abrir sucursales, ni **deshacer ese mismo cambio**.
Callejón sin salida que sólo se abre llamando a soporte.

Es de la misma familia que la guarda del "último administrador". Añadida.

---

## Lo que los agentes confirmaron que SÍ funciona

Conviene decirlo, porque cubre justo lo que más preocupaba:

- **Ninguna fuga de costo** en las seis secciones del export: vendedor, vendedor de
  sucursal y encargado reciben 403 en todas, y también en `/business/export`.
- **Aislamiento cross-tenant intacto** en las cinco rutas nuevas, y los dos mundos de
  tokens no se cruzan en ninguna dirección.
- El **`CASCADE` de `cash_register` no se llevó nada**: el turno y el movimiento siguen en
  la base tras intentar borrar la sucursal. Era el riesgo principal del bloque de borrado.
- `PATCH /principal` sube `token_version` **sólo en los cinco afectados**, y el alcance
  cambia de verdad: el ex-central pasa a ver 100 ventas en vez de todas y 403 al exportar.
- La **cuota de importación es todo-o-nada**: 402 con "sólo caben 494" y cero filas
  insertadas.
- El arqueo con `cancelledCash` separado, verificado contra la base.
- `modal.tsx` no introduce stale closure; el sello de dueño de la cola offline aguanta.

---

## Números

|                                | Mañana                   | Ahora                       |
| ------------------------------ | ------------------------ | --------------------------- |
| Tests                          | 405                      | **612** (454 API + 158 web) |
| Cobertura API — sentencias     | 84 %                     | **89,5 %**                  |
| Vulnerabilidades en producción | 15 (3 críticas, 7 altas) | **3 moderadas**             |
| `almacen.ts`                   | no existía               | 96 %                        |
| Paquete de entrada de la web   | 1.021 kB                 | 503 kB                      |

Y una nota sobre el paso de `pnpm audit` que se añadió esta mañana: **falló esa misma
tarde por culpa de una librería que yo había elegido**. `xlsx` 0.18.5 arrastra _prototype
pollution_ y _ReDoS_, ambas altas, sin parche en npm — y parsea justo el archivo que sube
un cliente desconocido. Sustituida por `exceljs`. Sin ese paso, habría entrado a producción
sin que nadie la viera.

---

## Sobre el método, que también dejó una lección

El agente de QA funcional avisó de que **el código cambiaba bajo sus pies** mientras
probaba —yo estaba arreglando los hallazgos del peer review— y fechó cada hallazgo contra
el árbol de ese momento. Eso es lo que hace que sus resultados sigan siendo utilizables.

La próxima vez conviene una de dos: o congelar el árbol mientras los agentes corren, o
lanzarlos en secuencia. Arreglar y medir a la vez funciona, pero obliga a cruzar cada
hallazgo con la hora a la que se encontró.

---

# QA visual — lo que encontró, y está SIN ARREGLAR

Llegó cuando los otros dos ya estaban cerrados. 99 capturas, 13 rutas × 2 modos × 2
viewports. Sus tres hallazgos altos están verificados por mí leyendo el código.

## 1. Construí los `DELETE` y nunca hice la interfaz

**La función entera está inalcanzable.** El commit `ee182e2` tocó cinco archivos y ninguno
es del front: hay `DELETE /locations/:id` y `DELETE /users/:id` en el API, con sus guardas y
sus 14 tests… y `apps/web/src/lib/api.ts` **ni siquiera tiene un método `delete`**.

Verificado: el cliente HTTP expone `get`, `post` y `patch`. Nada más.

Es el punto 4 de tus observaciones —"las ubicaciones se pueden eliminar y editar, lo mismo
para usuario"— y está hecho a medias sin que ningún test lo notara, porque todos los tests
entran por el API. **Es lo primero de mañana.**

## 2. El anillo de foco no llega a los botones ni a los campos

Confirmado leyendo el CSS: la regla global vive en `@layer components` (`index.css:63`),
y `button.tsx`, `input.tsx` y `select.tsx` llevan `focus-visible:outline-none`, que es una
_utility_ y **gana por cascada**.

El reparto es el peor posible: la regla cubre lo decorativo —los enlaces del menú miden
5.30:1— y deja fuera justo lo que se pulsa. Medido por el agente: **1.82:1 en claro y
1.48:1 en oscuro** en Cobrar, Excel, Nuevo, Cerrar caja, el buscador y los selects.

Mi arreglo de ayer estaba a medias y el test que escribí no lo vio: comprobaba que la
clase `focus-visible:ring` estuviera puesta, no que el anillo se viera.

## 3. El anillo usa el color de marca crudo

`index.css:67` usa `var(--color-primary)`. Con el tema **Grafito** en oscuro cae a
**1.53:1** — invisible. Esmeralda y el rojo actual quedan en 3.22 y 3.25, rozando el
límite.

Es exactamente el problema que `--color-primary-ink` ya resolvió para el texto, y se
arregla en esa misma línea. Un negocio que elija un tema oscuro se queda sin foco visible
en toda la aplicación.

## 4. Seis controles se quedaron con el borde decorativo

Medio, y del mismo cambio de ayer: el `<input type="color">` de Configuración, los presets
de tema, los métodos de pago no marcados del POS, «Salir», las tarjetas de producto y el
`−/+` del carrito siguen con `--color-border` (1.19:1) en vez de `--color-field` (3.32:1).

Dentro de los seis modales, en cambio, cero fallos.

## 5. Y una rama de código muerto que yo probé con un test

`PosPage.tsx:316` filtra `credit` de los métodos de pago, así que **fiar no se puede
seleccionar en el POS**. La rama "vas a fiar…" de la confirmación de cobro no se ejecuta
nunca — y yo le escribí un test que pasa.

Esto abre una pregunta de producto que no es mía: **¿se puede vender fiado desde el POS o
no?** El sistema tiene clientes, saldos, abonos y una excepción de alcance documentada para
el fiado… y la pantalla de vender no lo ofrece.

## Lo que el visual confirmó que está bien

- Cero desbordes horizontales y cero errores de consola en las 13 rutas × 2 modos × 2
  viewports.
- El aviso de ventas anuladas de Caja: **4.63:1** en claro, **7.36:1** en oscuro.
- Los chips de "entran / no entran" del importador: 4.59–6.92.
- El inventario con `vendedor.norte`: "la tuya" marcada, borde correcto, y el botón de
  Excel oculto para quien no puede exportar.
- Los seis modales, sin un solo fallo de borde.
- El importador entero y la confirmación de cobro con descuento y con monto alto.

## Dos avisos suyos que conviene repetir

- **Corrigió un falso positivo propio**: dijo que el botón de Excel no mostraba
  "Preparando…" y luego verificó con un `MutationObserver` que sí. Lo dejó escrito.
- **Probando el POS se cobraron tres ventas reales** (#114, #118, #119) que no llegaban al
  umbral de confirmación. Las dejó canceladas con motivo. Es la segunda ronda seguida en
  que un agente crea ventas sin querer: conviene darles un negocio de pruebas propio en vez
  de dejarlos entrar a `llanteria-central`.
