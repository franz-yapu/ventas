# 🔍 Auditoría — Diseño (Claude Design) vs. INFORME_PROYECTO.md

**Fuente de diseño:** proyecto MCP `VentaFácil - Sistema POS` (`VentaFacil POS.dc.html`).
**Fecha:** 2026-07-12.

## Resumen

El prototipo cubre **todas las secciones** del informe y respeta las reglas de negocio clave (roles, scope por ubicación, offline-first, fiado fuera del POS). La cobertura es **alta y fiel**. Abajo, el detalle pantalla por pantalla y las diferencias/enhancements detectados.

---

## Cobertura por sección

| Sección del informe       | En el diseño | Estado    | Notas                                                                                                                                |
| ------------------------- | :----------: | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Login                     |      ✅      | OK        | Coincide (usuario/contraseña, error, spinner).                                                                                       |
| POS / Vender              |      ✅      | OK        | Búsqueda, escáner, carrito, 4 métodos de pago (sin fiado ✓), descuento y comprador deshabilitados offline ✓, banner offline, recibo. |
| Ventas (historial)        |      ✅      | OK        | Filtros, tabla desktop + tarjetas móvil, suma total, cancelar (solo admin) con chip de estado.                                       |
| Recibo                    |      ✅      | OK        | Térmico 80mm, `@media print`, provisional/anulado.                                                                                   |
| Productos                 |      ✅      | OK        | Columnas Costo/Ganancia solo admin ✓, historial, nuevo/importar solo admin.                                                          |
| Inventario                |      ✅      | OK        | Stock/mínimo, resaltado bajo stock, ajustar, transferir, historial.                                                                  |
| Panel/Dashboard           |      ✅      | OK        | KPIs, tendencia, ventas por ubicación/vendedor, top productos, stock bajo, personalizar.                                             |
| Reportes                  |      ✅      | OK        | KPIs + comparativo por sucursal con totales.                                                                                         |
| Caja (Corte Z)            |      ✅      | OK        | Tabla vendedor×ubicación×método + total; botón "Abrir caja (próx.)" deshabilitado ✓ (coincide con fase pendiente).                   |
| Administración (índice)   |      ✅      | OK        | Tarjetas-enlace (móvil).                                                                                                             |
| Ubicaciones               |      ✅      | OK        | Lista + nueva.                                                                                                                       |
| Usuarios                  |      ✅      | OK        | Lista + nuevo (rol, ubicación).                                                                                                      |
| Actividad/Auditoría       |      ✅      | OK        | Filtros + "Ver detalle".                                                                                                             |
| Configuración/White-label |      ✅      | OK+       | Identidad, logo, colores, moneda, impuesto, pie de recibo. **Agrega** presets de tema y slider de radio (no estaban en el informe).  |
| Clientes/Fiado            |      ➖      | Coherente | Sin página dedicada, embebido en POS — igual que el informe.                                                                         |
| Sincronización offline    |      ✅      | OK        | Badge de sync, banner offline en POS, toast de confirmación.                                                                         |

---

## Diferencias y hallazgos

1. **Credenciales demo en el login** — el diseño muestra `admin / 1234`, pero el seed real es `admin / admin123` y `vendedor / vende123`. _Solo texto de ayuda del prototipo; sin impacto funcional._
2. **Agrupación de navegación** — el diseño organiza el menú en tres grupos: **operativo** (Vender/Ventas/Productos/Inventario), **Análisis** (Panel/Reportes/Caja) y **Administración**. El código tenía todo en una sola lista. → **Aplicado** en `Layout.tsx`.
3. **Bloque de usuario en el sidebar** — el diseño muestra avatar + nombre + rol arriba del botón "Salir". → **Aplicado**.
4. **Configuración enriquecida** — el diseño añade **presets de color** y **slider de radio de bordes**. El informe/código solo tenían color picker. → _Pendiente (enhancement opcional)._
5. **Comparativo de Reportes** — el diseño muestra columnas Hoy / #ventas / Mes / Ganancia mes; el informe menciona además columnas de "rango" cuando hay filtro activo. _El diseño es una versión simplificada; no es un conflicto._
6. **Caja — apertura/cierre real** — ambos coinciden en que es **fase pendiente** (`cash_register` sin endpoints). El diseño ya deja el botón "Abrir caja (próx.)".

**Conclusión:** el diseño es una guía visual válida y completa para el proyecto. No hay contradicciones con las reglas de negocio del informe; las únicas diferencias son texto de demo y un par de mejoras de UI en Configuración.

---

## Qué se aplicó al proyecto (`apps/web`)

Como el diseño y la app comparten el **mismo sistema de tokens CSS** (`--color-*`, `--radius`), se aplicó el lenguaje visual a nivel global y se propaga a todas las pantallas:

| Cambio                                                                                                                                                                                  | Archivo                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Fuentes **Onest** + **IBM Plex Mono** y `theme-color`                                                                                                                                   | `apps/web/index.html`                   |
| **Paleta cálida** del diseño (bg `#f6f5f3`, borde `#ecebe6`, texto `#17171a`, muted `#8c8a83`), primario `#2f68d8`, radio `12px`, tokens semánticos (success/danger/warning), scrollbar | `apps/web/src/index.css`                |
| `fontFamily` (sans/mono) + colores semánticos                                                                                                                                           | `apps/web/tailwind.config.ts`           |
| Botón: peso 600, feedback al pulsar, variante **danger**                                                                                                                                | `apps/web/src/components/ui/button.tsx` |
| Shell: grupos **Análisis**/**Administración**, bloque de usuario, barra superior blanca                                                                                                 | `apps/web/src/components/Layout.tsx`    |
| Tema por defecto del negocio (nuevos tenants)                                                                                                                                           | `packages/db/src/seed.ts`               |

### ⚠️ Nota sobre color primario y radio en tenants existentes

`ThemeProvider` sobreescribe `--color-primary`, `--color-secondary` y `--radius` con el `theme_json` **de la base de datos**. Los **neutros cálidos y la tipografía** aplican de inmediato, pero el negocio ya sembrado seguirá con el azul/radio viejos hasta que:

- se **re-siembre** la BD (`pnpm db:seed`), **o**
- se cambien color y radio en **Configuración**, **o**
- se actualice el registro del negocio en `business.theme_json`.

Los nuevos negocios (`pnpm new-tenant`) ya nacen con el tema del diseño.
