# VentaFácil — Brief de diseño

Documento para pegar en Claude Design. Todo lo que hay aquí está sacado del código real
de la aplicación, no es una descripción aproximada: los colores, las medidas y los
nombres de pantalla son los que están en producción.

---

## 1. Qué es

Punto de venta (POS) multi-sucursal, white-label, para negocios medianos de Bolivia:
llanterías, repuestos, ferreterías. Cada negocio entra por su propio subdominio
(`su-negocio.dominio.com`) y **nunca ve que la plataforma es compartida**.

- **Offline-first.** La caja tiene que poder cobrar sin internet y sincronizar después.
  Es un requisito real: la conexión se cae y la venta no puede esperar.
- **PWA**, se instala en el celular.
- Moneda **Bs.** (boliviano), formato `es-BO`, fechas `dd/mm/aaaa`.

## 2. Quién la usa y dónde

| Quién | Dónde | Qué hace |
|---|---|---|
| **Vendedor** | Celular, de pie, detrás del mostrador, con una mano | Cobrar. Nada más. No ve costos ni ganancias. |
| **Administrador** | PC, sentado, y celular para revisar | Todo: productos, inventario, reportes, caja, usuarios. |
| **Dueño** | Celular, a cualquier hora | Mirar cómo va el día. |

**El celular es el uso principal**, no una adaptación. La pantalla que más se toca es la
de cobrar, y se toca con el pulgar, a veces con las manos ocupadas y con prisa. La PC es
para administrar, no para vender.

Dos alcances que cambian lo que se ve: un usuario es de la **central** (ve todas las
sucursales) o de **una sucursal** (ve sólo la suya).

## 3. Lo que hay que mejorar

Éste es el encargo. En orden de importancia:

1. **Que el celular se sienta hecho para el celular**, no una tabla encogida. Objetivos
   táctiles grandes, lo importante al alcance del pulgar, nada crítico en la esquina
   superior.
2. **Que la PC aproveche el ancho.** Hoy el contenido se estira sin jerarquía en
   pantallas grandes.
3. **Acabado profesional y consistente**: jerarquía tipográfica, densidad, espaciado,
   estados (vacío, cargando, error), foco visible para teclado.
4. **Que el color de marca mande de verdad** (ver §5): el negocio elige primario y
   secundario en Configuración, y todo debe responder a eso.

## 4. Sistema visual actual

Es un sistema que ya funciona y del que conviene partir, no tirarlo.

### Tipografía
- **Onest** (sans) para todo.
- **IBM Plex Mono** para SKU, códigos de recibo y contraseñas temporales.
- Cuerpo con `letter-spacing: -0.01em`; los títulos aprietan más: `-0.02em`.

### Color — neutros cálidos (fijos, no los toca el negocio)

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#f6f5f3` | Fondo de la aplicación. Cálido, no gris azulado. |
| `--color-surface` | `#ffffff` | Tarjetas, barras, modales. |
| `--color-border` | `#ecebe6` | Bordes y separadores. |
| `--color-fg` | `#17171a` | Texto principal. |
| `--color-muted` | `#8c8a83` | Texto secundario. |

### Color — semánticos (fijos, **no son de marca y no se pueden tematizar**)

| Token | Valor | Significado |
|---|---|---|
| `--color-success` / `-bg` | `#2f8f5b` / `#eef6f1` | Venta completada, stock sano, activo. |
| `--color-danger` / `-bg` | `#b8402f` / `#fbeeec` | Cancelar, eliminar, stock agotado. |
| `--color-warning` / `-bg` | `#8a6d18` / `#fbf4e6` | Sin conexión, stock bajo, prueba por vencer. |

> Un verde que no significa "bien" o un rojo que no significa "peligro" rompe la lectura
> de un cajero apurado. Estos tres no entran en el tema del negocio, pase lo que pase.

### Color — de marca (los elige el negocio)

| Token | Por defecto | Uso |
|---|---|---|
| `--color-primary` | `#2f68d8` | Acción principal, navegación activa, serie principal de gráficas. |
| `--color-secondary` | `#f59e0b` | Acento: acción complementaria, segunda serie, filete del recibo. |

- `--radius` va de 0 a ~20px, lo elige el negocio con un deslizador. Por defecto `12px`.
- El texto sobre cada color de marca **se calcula** (blanco o `#17171a`, el que más
  contraste dé). Cualquier propuesta debe seguir funcionando con un primario amarillo
  claro y con uno azul marino.
- Sombra de tarjeta: `0 1px 3px rgba(0,0,0,.06)`.

## 5. La prueba de fuego del tema

**Toda propuesta tiene que sobrevivir a esto**, porque es lo que el cliente hace el
primer día: entra a Configuración y pone los colores de su negocio.

Combinaciones que hay que aguantar sin que nada se vuelva ilegible ni feo:

| Primario | Secundario |
|---|---|
| `#2f68d8` azul | `#f59e0b` ámbar |
| `#27794c` verde | `#d98324` naranja |
| `#6d5ae0` violeta | `#e0a03a` dorado |
| `#e0662f` naranja | `#2a7194` azul petróleo |
| `#c23b2f` rojo | `#377483` azul verdoso |
| `#3a3a42` grafito | `#c9992e` mostaza |

Reglas que salen de ahí:
- Nada de degradados o sombras de color que asuman un tono concreto.
- Nada de texto de color de marca sobre fondo de color de marca.
- Si un elemento necesita "azul", es que necesita el primario, no un azul.

## 6. Componentes existentes

En `components/ui/`: `button`, `card`, `input`, `select`, `badge`, `modal`, `page`.

- **Botón**: variantes `primary`, `secondary`, `outline`, `ghost`, `danger`. Alturas
  44/48/64px (la de 64 es el botón COBRAR del POS). Peso 600–700, se hunde al pulsar
  (`active:scale-[.98]`).
- **Badge**: píldora, cinco tonos (los tres semánticos + `info` + `neutral`).
- **Tabla** (`.ds-table`): sólo en escritorio. En móvil, **las mismas filas son
  tarjetas** — es un patrón ya establecido y conviene mantenerlo.
- **Modal**: hoja pegada abajo en móvil (con radio sólo arriba), centrada en escritorio,
  fondo translúcido con desenfoque. Cierra con Escape.
- **Page / PageHeader / EmptyState / Skeleton**: título de página, estado vacío con
  motivo y acción, y esqueletos de carga que no mueven el layout.

## 7. Navegación

- **Escritorio**: barra lateral fija de **230px**, con tres grupos — operativo
  (Vender · Ventas · Productos · Inventario · Caja), *Análisis* (Panel · Reportes ·
  Lectura Z) y *Administración* (Ubicaciones · Usuarios · Actividad · Config · Mi plan).
  Al pie, bloque de usuario y "Salir".
- **Móvil**: barra inferior fija con 5 destinos como máximo, respetando
  `env(safe-area-inset-bottom)`. Arriba, una barra de 56px con la marca y el estado de
  sincronización.
- Los grupos *Análisis* y *Administración* sólo los ve un administrador, y algunas
  entradas dependen del plan contratado.

## 8. Pantallas

Ordenadas por cuánto se usan.

### POS / Vender — la pantalla crítica
En escritorio: rejilla de productos a la izquierda y carrito fijo de **360px** a la
derecha. En móvil: sólo la rejilla, y el carrito es una hoja que sube desde abajo con un
botón flotante que lleva la cuenta de artículos.

Contiene: buscador con lector de código de barras (cámara), rejilla de productos (2
columnas en móvil, 3–4 en escritorio), carrito con cantidades, descuento (con tope para
vendedores), selector de comprador, **cuatro métodos de pago** (Efectivo, Tarjeta, QR,
Transferencia — el fiado no se cobra aquí) y el botón **COBRAR** de 64px con el total.

Estados propios: banner de "sin conexión" (ámbar), producto sin stock, venta guardada
localmente pendiente de sincronizar.

### Ventas
Historial de recibos con filtros de fecha, sucursal y método. Tabla en escritorio con
fila de totales; tarjetas en móvil. Acciones: ver/imprimir recibo y cancelar (sólo
admin, con motivo obligatorio).

### Recibo
Térmico de **80mm**, monoespaciado, blanco y negro salvo un filete del color de acento
bajo el nombre. Se imprime aislado del resto de la página.

### Productos
Buscador, filtro por sucursal, tabla/tarjetas. Columnas de costo y ganancia **sólo para
admin**. Alta manual e importación CSV. Cada rubro define campos propios (una llantería
tiene "medida" y "marca"; una tienda de repuestos, "código OEM").

### Inventario
Stock por producto y sucursal, con el mínimo al lado y resaltado cuando está por debajo.
Ajustar cantidad, transferir entre sucursales, historial de movimientos.

### Panel
Cuatro tarjetas de KPI arriba (ventas de hoy con variación vs. ayer, ventas del mes,
ticket promedio, proyección), gráfica de tendencia de 30 días **con los 30 anteriores
punteados detrás** para comparar, barras por sucursal, top 10 de productos, ventas por
vendedor y lista de stock bajo. El usuario elige qué widgets ve.

### Reportes
KPIs + comparativo por sucursal con filtro de rango de fechas. Exporta a CSV e imprime.

### Caja
Apertura con monto inicial, movimientos de entrada y salida con motivo, arqueo de cierre
con el descuadre calculado contra lo cobrado en efectivo. Aparte, la **Lectura Z**:
totales del día por vendedor × sucursal × método de pago.

### Configuración
Identidad (nombre, logo, rótulo), tema (presets de pareja de colores, dos selectores y
deslizador de radio, **con vista previa en vivo**), moneda, impuesto, pie del recibo y
tope de descuento del vendedor.

### Login y pantallas sin sesión
Login, registro, recuperar contraseña, restablecer, verificar correo, términos y
privacidad. **Todas llevan el logo y los colores del negocio**, que se cargan sin sesión
a partir del subdominio.

## 9. Restricciones que no se negocian

- **Nada de dependencias nuevas.** React 18 + Tailwind + lucide-react + recharts, y
  nada más. No hay librería de componentes ni de animación, y no se va a añadir.
- **Los colores semánticos no se tematizan** (§4).
- **El patrón tabla↔tarjeta** por breakpoint se mantiene.
- **Todo tiene que funcionar sin conexión**: no puede haber nada que dependa de cargar
  algo de la red para verse (fuentes incluidas — van servidas desde la propia app).
- **Un solo breakpoint hace casi todo el trabajo: `md` (768px).** Por debajo, celular;
  por encima, escritorio. `sm` y `lg` se usan sólo para rejillas.
- El servidor es un VPS de 1 vCPU. Nada que exija mucho del navegador ni muchas
  peticiones.

## 10. Qué espero de vuelta

En orden de utilidad:

1. **POS en móvil**, resuelto de verdad: rejilla, carrito como hoja, cobro. Es donde se
   gana o se pierde el producto.
2. **Un patrón de lista** que sirva igual para Productos, Ventas e Inventario, en las
   dos anchuras.
3. **Panel** en móvil: cómo apilar KPIs y gráficas sin que sea un rollo infinito.
4. **Barra lateral y barra inferior** con el aire y la jerarquía correctos.
5. **Estados**: vacío, cargando, error, sin conexión. Hoy son lo más flojo.

Con tokens, medidas y estados. Si algo cambia el sistema de color, decir explícitamente
cómo sobrevive a la tabla de §5.
