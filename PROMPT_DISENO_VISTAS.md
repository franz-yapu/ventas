# 🎨 Prompt para el diseñador — Vistas de VentaFácil (POS)

> **Cómo usar este documento:** es un *brief* completo para diseñar todas las pantallas del sistema. Cada vista trae su propósito, quién la usa, el layout, los componentes, los campos, los estados (vacío/carga/error/offline) y las interacciones. Diseña **mobile-first** (el vendedor trabaja en celular) y **responsive a desktop** (el admin trabaja en pantalla grande). Entrega los estados, no solo el "happy path".

---

## 0. Contexto del producto

**VentaFácil** es un **punto de venta (POS) multi-sucursal, offline-first y white-label** para negocios medianos (llantas, repuestos, cualquier rubro). Se revende a distintos clientes, por lo que **la marca (logo, colores, textos) es configurable** y el diseño no debe depender de una identidad fija.

**Dos roles:**
- **Vendedor (`seller`)** — mostrador, mayormente en **celular**. Ve: Vender, Ventas, Productos (solo lectura), Inventario (solo lectura).
- **Admin** — el dueño, mayormente en **desktop**. Ve todo lo anterior + Panel, Reportes, Caja, y Administración (Ubicaciones, Usuarios, Actividad, Configuración).

**Dimensión de ubicación:** un usuario "central" ve todas las sucursales (aparecen filtros/selectores de ubicación); un usuario de sucursal solo ve la suya (sin esos selectores).

---

## 1. Sistema de diseño (fundacional — diséñalo primero)

Antes de las pantallas, define los **tokens y componentes base**, porque toda la app los reutiliza.

**Tokens (white-label, vía variables CSS):**
- `--color-primary`, `--color-secondary` (los define cada cliente; usa placeholders neutros).
- `--radius` (radio de bordes configurable).
- Logo y nombre del negocio dinámicos (se muestran en cabecera y recibo).
- Moneda configurable (por defecto `Bs.` / BOB). Zona horaria La Paz.

**Componentes base a diseñar (ya existen como primitivos):**
`Button` (variantes: primario, secundario, peligro/ghost), `Input`, `Select`, `Card`, `Modal`. Diseña sus estados: normal, hover, focus, disabled, error.

**Estados globales que TODA pantalla de datos debe contemplar:**
- **Cargando** (skeleton o spinner).
- **Vacío** (mensaje + acción sugerida).
- **Error** (mensaje claro + reintentar).
- **Sin conexión / offline** (banner o badge; ver §14).

**Navegación (shell):**
- **Desktop:** nav lateral izquierdo (~224 px) con logo arriba, items de menú, botón "Salir" abajo. El bloque "Administración" es un grupo desplegable (solo admin).
- **Móvil:** nav inferior fija con los items principales (Vender, Ventas, Productos, Inventario) + una entrada "Admin" (solo admin) que lleva a un índice.
- **Barra superior sticky** en el área de contenido con el **indicador de sincronización** (badge) siempre visible.
- Los items de menú admin-only **no se muestran** al vendedor.

---

## 2. Login (`/login`) · público

**Propósito:** iniciar sesión.
**Layout:** centrado, tarjeta única, logo/nombre del negocio arriba.
**Campos:** usuario, contraseña. Botón "Ingresar" (con estado *cargando* que lo deshabilita).
**Estados:** error de credenciales (mensaje bajo el form), botón deshabilitado mientras procesa.
**Nota:** sin selector de rol (lo decide el backend). Diseño limpio, apto para celular.

---

## 3. POS — "Vender" (`/`) · vendedor y admin · ⭐ pantalla más importante

**Propósito:** registrar una venta rápido, funcione con o sin internet.

**Layout (2 columnas en desktop; apiladas o con carrito colapsable en móvil):**
- **Izquierda — catálogo:** barra de búsqueda (nombre/SKU) + botón de **escáner de código de barras** (ícono cámara). Grid de tarjetas de producto.
  - Cada tarjeta: nombre, precio, y **estado de stock**: verde "disponible", ámbar "stock bajo", rojo "Agotado" (tarjeta deshabilitada).
  - Selector de sucursal arriba **solo si es admin**.
- **Derecha — carrito:** lista de líneas (nombre, precio, cantidad con **+/−**, botón eliminar), y al pie:
  - Selector de **método de pago** (efectivo, tarjeta, QR, transferencia — **sin "fiado" en el POS**).
  - *(Solo online)* selector de **comprador** + botón "nuevo cliente"; campo **descuento** en Bs.
  - **Total** grande. Botón **COBRAR** protagonista.

**Vista del escáner (modal):** overlay con la cámara activa, guía de encuadre, feedback "Agregado: [producto]" o "Sin producto para el código".

**Modal "Nuevo cliente":** campos nombre + teléfono, guardar.

**Recibo tras cobrar (modal):** ver §5 (recibo). Mostrar botones **Imprimir** y **Nueva venta**. Si es provisional, mostrar número `PROV-xxxx` con aviso "se confirma al sincronizar".

**Estados clave a diseñar:**
- Offline: descuento y comprador **deshabilitados** con tooltip ("requiere conexión"); el resto funciona.
- Carrito vacío (COBRAR deshabilitado).
- Producto agotado.

---

## 4. Ventas — historial (`/ventas`) · ver todos / cancelar admin

**Propósito:** consultar ventas pasadas, ver/imprimir recibo, cancelar (admin).

**Layout:** barra de filtros arriba + tabla + pie con totales.
**Filtros:** ubicación (solo central), estado (Completadas/Canceladas), rango de fechas (desde/hasta).
**Tabla (columnas):** Recibo #, Fecha, Ubicación, Vendedor, Comprador, Pago, Total, Estado (chip verde=completada / gris=cancelada). Scroll infinito ("Cargar más").
**Pie:** **suma total** del conjunto filtrado + conteo.
**Acciones por fila:** "Ver recibo" (ícono impresora, todos); "Cancelar" (ícono, **solo admin** y estado completada).
**Modal cancelar:** campo **motivo obligatorio (≥3 caracteres)** + aviso "La venta no se elimina; queda marcada como cancelada y se registra en auditoría".
**Diseño responsive:** en móvil la tabla se vuelve lista de tarjetas.

---

## 5. Recibo (componente reutilizable, se abre en modal)

**Propósito:** ticket térmico 80 mm, imprimible.
**Layout:** angosto, monoespaciado, alineado a ticket.
**Contenido:** logo/nombre del negocio, ubicación, **número de recibo** (o `PROV-xxxx` provisional), fecha, vendedor, comprador (si hay), **líneas** (nombre, cantidad, precio, total), subtotal, descuento, **TOTAL**, método de pago, pie configurable. Si está cancelada: sello **"*** ANULADO ***"** superpuesto.
**Diseñar:** versión pantalla (modal) y versión impresión (`@media print`, aislada).

---

## 6. Productos (`/productos`) · ver todos / CRUD admin

**Propósito:** catálogo de productos.
**Layout:** cabecera con acciones + filtros + tabla (scroll infinito).
**Acciones (solo admin):** "Nuevo producto", "Importar CSV".
**Filtros:** por ubicación (solo central).
**Tabla:** SKU, Nombre, Ubicación, Precio; **y solo admin:** Costo unitario, Ganancia (precio − costo). Acciones por fila: "Historial" (todos), "Editar" (solo si tiene permiso sobre esa ubicación).
**Modal formulario (crear/editar):** campos SKU, Nombre, Precio, Compra unitario, Compra por mayor, **+ campos dinámicos según el rubro** (atributos configurables). Mostrar **ganancia y margen % en vivo** mientras se teclea.
**Modal Importar CSV:** zona de carga, indica cabecera esperada `sku,name,price` + atributos, resultado "Importados X / Omitidos Y".
**Modal Historial:** timeline de acciones del producto (creación, cambios de precio, ajustes de stock, ventas) con usuario y fecha.

---

## 7. Inventario (`/inventario`) · ver todos / ajustar según permiso

**Propósito:** stock por ubicación, ajustes y transferencias.
**Layout:** cabecera (botón "Transferir" si tiene permiso) + filtros + tabla.
**Filtros:** ubicación (solo central).
**Tabla:** Producto, Ubicación, **Stock**, **Mínimo**. Resaltar en rojo las filas con stock ≤ mínimo. Acciones: "Historial" (todos), "Ajustar" (solo con permiso).
**Modal Ajustar:** campos Stock, Mínimo, **Motivo obligatorio (≥3)**.
**Modal Transferir:** producto, **desde** (solo ubicaciones que puede ajustar) → **hacia** (mostrando stock actual en cada una), cantidad. Validar origen ≠ destino y cantidad ≥ 1.

---

## 8. Panel / Dashboard (`/panel`) · admin

**Propósito:** KPIs personalizables por el usuario.
**Layout:** grid de widgets de distinto tamaño (sm/md/lg). Botón "Personalizar".
**Modo personalizar:** panel lateral con checkboxes (activar/desactivar widgets) y flechas ↑/↓ (reordenar). Botón "Guardar panel".
**Widgets a diseñar:**
- **KPI Hoy** (ventas del día), **Total del mes**, **Ticket promedio** — tarjetas numéricas grandes.
- **Proyección** — valor estimado del próximo mes + banda (mín/máx) + método.
- **Tendencia 30 días** — gráfico de líneas.
- **Ventas por ubicación** — gráfico de barras.
- **Ventas por vendedor** — lista/ranking.
- **Top 10 productos** — lista.
- **Stock bajo** — lista de alertas.
> Usa los colores del tema (`var(--color-primary)`), no colores fijos. Diseña también el estado sin datos de cada widget.
**Acciones:** exportar Excel / PDF.

---

## 9. Reportes (`/reportes`) · admin

**Propósito:** análisis y comparativo por sucursal.
**Layout:** filtro de rango de fechas arriba; si hay rango activo, tarjeta destacada (Vendido y Ganancia del rango). Fila de KPIs (reutiliza widgets: hoy, mes, ticket, proyección). Gráficos (tendencia, ventas por ubicación). Listas (top productos, ventas por vendedor).
**Tabla comparativa por sucursal:** por cada ubicación → vendido/ganancia de hoy, # de ventas hoy, vendido/ganancia del mes, y columnas del rango si aplica; **pie con totales**.
**Acción:** exportar (PDF/impresión).

---

## 10. Caja — Corte Z (`/caja`) · admin

**Propósito:** lectura Z (totales del día por método de pago).
**Layout:** selector de fecha (default hoy) + tabla.
**Tabla:** filas por **Vendedor × Ubicación × Método de pago** → cantidad de ventas y total. Cabecera con **gran total**.
**Acción:** exportar Excel.
**Nota de diseño:** dejar espacio para una futura **apertura/cierre de caja con fondo inicial y arqueo** (fase siguiente) — considera cómo encajaría un flujo "abrir caja / cerrar caja".

---

## 11. Administración — índice (`/administracion`) · admin (sobre todo móvil)

**Propósito:** menú de tarjetas hacia las sub-secciones cuando el submenú se colapsa (móvil).
**Layout:** grid de **tarjetas-enlace** con ícono + título + descripción: Ubicaciones, Usuarios, Actividad, Configuración.

---

## 12. Sub-secciones de Administración · admin

### 12.1 Ubicaciones (`/ubicaciones`)
Lista (Nombre, Dirección, Estado Activa/Inactiva) + botón "Nueva". Modal alta/edición: Nombre, Dirección, (activar/desactivar).

### 12.2 Usuarios (`/usuarios`)
Lista (Nombre, Usuario, Rol, Ubicación, Estado) + botón "Nuevo". Modal: Nombre, Usuario, Contraseña, **Rol** (Vendedor/Administrador), Ubicación (opcional). Validación: usuario ≥3, contraseña ≥6.

### 12.3 Actividad / Auditoría (`/actividad`)
**Propósito:** registro de todo lo que pasa.
**Layout:** filtros (acción, entidad, usuario, rango de fechas) + tabla (Fecha, Usuario, Acción, Entidad, Ubicación) con scroll infinito.
**Acción por fila:** "Ver detalle" → modal **Diff** (tabla Campo / Antes / Después, resaltando en ámbar/verde lo que cambió).

### 12.4 Configuración / White-label (`/configuracion`)
**Propósito:** personalizar la marca del cliente. **Diseña esto con esmero: es el corazón white-label.**
**Secciones del formulario:**
- **Identidad:** nombre del negocio, nombre de la app, **logo** (subir imagen con preview + quitar).
- **Colores:** primario y secundario (color picker + hex) con **vista previa en vivo**.
- **Recibo y moneda:** pie del recibo, moneda, tasa de impuesto (%).
- **Esquema de producto por rubro:** editor de los atributos custom que verán los formularios de producto.
**Guardar** aplica el tema a toda la app al instante.

---

## 13. Clientes / Fiado · integrado en el POS (no tiene página propia hoy)

Hoy se gestiona desde el POS (selector + alta rápida). **Propuesta de diseño (opcional):** una vista dedicada de clientes con: lista ordenada por **saldo de fiado** (deudores primero), detalle de cliente (datos + saldo + ventas a crédito + historial de abonos) y acción **"Registrar abono"** (monto, método, nota). Diséñala como evolución futura.

---

## 14. Estados de sincronización (offline-first) — transversal

**Indicador de sync** (badge en la barra superior, siempre visible), tres estados:
- 🟠 **Sin conexión** — ícono nube tachada — "Sin conexión · N por subir".
- 🔵 **Sincronizando/pendiente** — ícono refrescar girando — "N ventas pendientes".
- 🟢 **Al día** — ícono check — "Sincronizado".
- Al tocarlo → "Sincronizar ahora".

**Reglas de diseño offline:**
- El POS debe verse **plenamente funcional sin conexión** (búsqueda, carrito, cobro).
- Elementos que requieren red (descuento, comprador, fiado) van **deshabilitados con explicación**.
- Los recibos offline muestran número **provisional** (`PROV-xxxx`).
- Nunca bloquear una venta por falta de internet.

---

## 15. Entregables sugeridos para el diseñador

1. **Sistema de diseño**: tokens (con placeholders neutros para white-label), tipografía, componentes base con sus estados.
2. **Flujos prioritarios** (diseñar primero): **Login → POS → Cobro → Recibo**, en móvil y desktop.
3. **Todas las pantallas** listadas arriba, cada una con: happy path + vacío + carga + error + (si aplica) offline.
4. **Dos temas de ejemplo** distintos para demostrar el white-label (p. ej. una llantera y una tienda genérica).
5. **Responsive**: versión móvil (vendedor) y desktop (admin) de cada vista.

### Principios rectores
- **Rapidez y cero fricción** en el POS: pocos toques para cobrar.
- **Para gente sin experiencia técnica**: etiquetas claras en español, botones grandes.
- **Mobile-first** para el vendedor; **denso e informativo** para el admin en desktop.
- **Neutralidad de marca**: nada de colores/estilos hardcodeados; todo respeta el tema del cliente.
- **Siempre mostrar el estado**: conexión, sincronización, carga, errores.

---

*Basado en `INFORME_PROYECTO.md`. Referencia de campos, roles y endpoints: ver ese documento.*
</content>
