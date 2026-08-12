# Lo que salió de probar el sistema de verdad — 12 de agosto de 2026

> Una tarde de pruebas manuales en la instancia del NAS encontró **más y peores fallos que
> las tres revisiones anteriores juntas**. Ninguno lo veían los tests, y casi ninguno era
> visible en producción: aparecen sólo donde el sistema se usa — una red de tienda, sin
> HTTPS y sin salida a Internet, con dos sucursales y un vendedor que no es el dueño.
>
> 867 tests al terminar el día (523 API + 344 web), desde los 730 de la mañana.

---

## ⏳ Pendiente de confirmar por franz

Tres cosas que quedaron desplegadas y sin comprobar en pantalla. **Empezar por aquí.**

1. **El cobro con varios productos.** Era el bloqueante. Ver abajo la causa raíz (era
   `crypto.randomUUID`), pero conviene confirmarlo con el dedo.
2. **La rejilla de Vender sin hueco reservado**, que deja las tarjetas de altura desigual.
   Si molesta, la alternativa acordada es mantener la altura pareja y usar ese hueco para el
   nombre y la descripción.
3. **Que un producto sin stock ya no se pueda seleccionar** y que la salida por Inventario
   sea cómoda. Si estorba en el mostrador, se puede añadir un ajuste rápido de stock desde el
   propio POS para administradores.

## Los dos que sólo aparecen fuera de HTTPS y fuera de Internet

Son la causa de que la caja no cobrara, y explican también síntomas que se habían atribuido
a otras cosas.

### `crypto.randomUUID` no existe en un contexto no seguro

Esa API del navegador **sólo está disponible en HTTPS o en `localhost`**. El NAS se sirve por
`http://` a una IP, así que ahí es `undefined` — comprobado: `isSecureContext=false`. Y
`checkout()` empezaba generando el id de la venta con ella: reventaba en la primera línea,
antes de guardar nada.

Es también la causa raíz del cuelgue de «Cobrando…» — lanzaba antes de liberar el botón — y
en producción no se veía porque ahí hay HTTPS. Ahora el id sale de `lib/uuid.ts`, sobre
`crypto.getRandomValues`, que sí existe sin HTTPS.

### `navigator.onLine` miente en la red de una tienda

Un equipo conectado al wifi del local **sin salida a Internet** se declara «offline» aunque
el servidor esté en la misma red. La aplicación se lo creía y se apagaba entera: no
sincronizaba el catálogo (**ésa era la causa real del «creé un producto y no aparece en
Vender»**), no subía ninguna venta, no cargaba compradores y bloqueaba los descuentos.

Ahora se intenta siempre y el estado se deduce del resultado. Un test que afirmaba «sin
conexión no se envía nada» resultó ser el fallo y no la garantía.

## Lo que se vendía sin tener

El peor de la tarde, y no estaba en ninguna lista: **un vendedor de una sucursal nueva vendió
un producto del que no tenía ni una unidad**. Recibo emitido, inventario sin registrar nada.
La causa estaba escrita en el propio comentario del descuento de stock: «sólo … productos con
inventario en la ubicación» — un `UPDATE` que, sin fila, afecta a cero filas y sigue como si
nada. Con fila, dejaba el stock en negativo.

Ahora se comprueba antes de insertar, con `FOR UPDATE` sobre el inventario (sin el bloqueo,
dos cajas venden la última unidad a la vez) y contando por producto, no por línea.

## Decisiones de producto de franz (12 de agosto)

Están razonadas en los commits y en el código; aquí sólo el registro de qué se decidió.

| Decisión | Qué implicó |
|---|---|
| Una sucursal ve **su surtido** | `/products` filtra por fila de inventario para quien no es central. Ventas y Actividad ya filtraban; Inventario se sigue viendo entero |
| **Rechazar** vender sin existencias | 409 con el nombre del producto y cuánto queda |
| **Deshabilitar** en el POS lo que no hay | Revierte una decisión anterior que ya no se sostenía — ver abajo |
| Anular **pregunta si se devolvió** el efectivo | El servidor registra el retiro; la casilla va sin marcar a propósito |
| La tarjeta **sin foto se compacta** | Revierte la banda todo-o-nada; con ella desapareció el fallo de la rejilla que se movía |
| El **SKU no se escribe** | Sólo lectura al crear y al editar; el CSV sigue aceptándolo |
| Aviso de **términos** al cambiar | Sólo por cambios materiales, sólo al admin de la central |

## Dos comentarios que dejaron de ser ciertos el mismo día

Vale la pena tenerlo presente, porque es el patrón que más ha costado en este proyecto:

- **«Sin existencias se puede vender igual, y se avisa»** (POS). Defendía no deshabilitar la
  tarjeta: «vale más una existencia en rojo que una venta invisible». Dejó de valer horas
  después, cuando el servidor pasó a rechazar esas ventas.
- **«Sin RESEND_API_KEY los correos van al log»** (staging). Dejó de ser cierto el 7 de
  agosto, y el stack no arrancaba por eso.

Los dos estaban bien escritos y bien razonados **cuando se escribieron**.

## Apuntado al apagar el NAS

Al parar el stack, la base salió con código 0 y **el API con 1**: no maneja `SIGTERM`, así
que muere de golpe en vez de cerrar ordenadamente. Aquí da igual —no hay nada que perder en
el proceso—, pero en el VPS significa que cada despliegue corta las peticiones en vuelo: la
que estuviera cobrando una venta en ese instante se pierde a medias. Vale la pena mirarlo
antes de desplegar.

## Lo que queda del proyecto

1. **El VPS.** ⛔ Leer `docs/DESPLIEGUE_TRAS_REVISION.md` antes. Y añadir a esa lista:
   comprobado desde fuera el 12 de agosto, `vertexweb.lat` **no tiene DNS comodín**
   (`llantas.vertexweb.lat` no resuelve) y el certificado cubre sólo el dominio y `www`. Sin
   `*.vertexweb.lat` y certificado comodín, **el subdominio por negocio no funciona en
   producción** aunque el código esté listo.
2. **Los cinco datos de la empresa y el abogado**, que siguen bloqueando abrir el registro.
3. Los avisos de **vitest (crítico) y vite (alto)**, que el CI no ve porque `--prod` deja
   fuera las de desarrollo. Defendible, pero mejor decidido a la vista.

## Cómo se probó (para repetirlo)

La instancia del NAS, con subdominios reales por `nip.io`. Todo en
[[nas-instancia-pruebas]] — accesos, cómo actualizarla y qué no se puede probar ahí.

Lo que **no** se pudo verificar con el navegador sin interfaz: el POS con productos. Con el
reloj acelerado no llega a completarse la escritura en IndexedDB, así que la rejilla sale
«Sin resultados» en las capturas. Las pantallas que no dependen del catálogo local sí se
capturan bien.
