# Promesas retiradas de los textos legales

> Revisión del **2026-08-06**. Se contrastó frase a frase `apps/web/src/features/legal/textos.ts`
> con lo que el código hace, y se retiró del texto todo lo que el sistema **no cumple hoy**.
> `TERMS_VERSION` pasó de `2026-08-04` a `2026-08-06`.
>
> Están aquí porque **no son errores de redacción**: alguien las escribió porque le parecía
> lo correcto. La pregunta pendiente no es cómo redactarlas mejor, sino **si se implementan**.
> Cuando una se implemente, vuelve al texto y sube otra vez `TERMS_VERSION`.
>
> Bajar una promesa siempre es más barato que cumplirla, y por eso conviene que quede escrito
> lo que se bajó.

---

## 1. Cambiar de plan por tu cuenta

**Decía:** «Puedes cambiar de plan cuando quieras; el cambio se aplica de inmediato.»
**Dice ahora:** «Para cambiar de plan, escríbenos y lo aplicamos sobre tu cuenta.»

**Por qué se retiró.** No existe ninguna ruta de cliente que cambie el plan. `subscription.ts`
sólo tiene `GET /subscription/me` y `GET /plans`; `planCode` únicamente se escribe desde
`PATCH /platform/tenants/:id/subscription`, que además ahora es del operador principal. El
cliente ve su plan y los demás planes, y no puede moverse entre ellos.

**Qué costaría implementarlo.** Poco: una ruta de cliente que valide el cupo (bajar de plan
con más sucursales de las que permite el nuevo tiene que fallar, no romperse), invalide la
caché de suscripción y quede auditada. Lo que no es trivial es el **cobro**: subir de plan a
mitad de mes plantea prorrateo, y eso depende de la pasarela, que está bloqueada por el alta
como comercio (ver `planSaas.md` #11).

**Recomendación.** Implementar primero la **subida** de plan, que es la que el cliente quiere
hacer sola y con urgencia, y dejar la bajada por escrito. Nadie sube de plan a las once de la
noche esperando a que contesten un correo.

---

## 2. El aislamiento lo aplica la base de datos

**Decía:** «Los negocios están aislados entre sí: la base de datos aplica esa separación por
sí misma, no sólo el programa.»
**Dice ahora:** «Los negocios están aislados entre sí: ninguna consulta del sistema devuelve
información de otro negocio.»

**Por qué se retiró.** Es lo más incómodo de la lista, porque **el código sí lo hace**: RLS
está programado, los 13 módulos usan `withTenant()`, y hay 31 tests de integración con RLS
activo que lo demuestran. Pero **no está activado en el VPS** (`ENABLE_RLS=1` sigue
pendiente, `planSaas.md` #3), y la frase habla del servicio que se presta, no del repositorio.
La versión nueva es cierta hoy: el aislamiento por aplicación está y está probado.

**Qué costaría implementarlo.** Nada de programación. Es un paso de despliegue: crear el rol
de aplicación, apuntar `DATABASE_URL` a él y activar RLS después de un backup con restauración
probada. Ensayado entero en el staging local.

⚠️ **Ojo con el orden**: el usuario `ventafacil` de Postgres es superusuario, y Postgres
**ignora RLS para superusuarios** — ni `FORCE` les aplica. Si el API sigue conectándose con
él, activar RLS no protege nada _y lo parece_.

**Recomendación.** Es la que más devuelve por lo que cuesta, y va atada al punto 3: los dos
son el mismo despliegue.

---

## 3. Copias de seguridad periódicas

**Decía:** «Hacemos copias de seguridad periódicas.»
**Dice ahora:** la frase desapareció (§8 de privacidad conserva el cifrado de contraseñas y
de las conexiones, que sí son ciertos).

**Por qué se retiró.** Existen `scripts/backup.sh` y `scripts/restore-test.sh`, y son buenos
—el segundo verifica que el backup restaura de verdad, que es lo que convierte un archivo en
un backup—. Pero **no hay nada programado en el servidor**: un script que nadie ejecuta no es
una copia periódica. Hay un cliente real operando.

**Qué costaría implementarlo.** Un cron que llame a `backup.sh`, y **copiar el resultado
fuera del servidor**: un backup que vive en la misma máquina que la base no protege del caso
que más importa. `restore-test.sh` ya existe para verificarlo.

**Recomendación.** De toda esta lista, es lo único cuyo coste, si sale mal, no se recupera
con código. Antes que cualquier otra cosa de aquí.

---

## 4. Los datos se borran del dispositivo al cerrar sesión

**Decía:** «Al cerrar sesión, esa información se borra del dispositivo y la sesión se cierra
también en nuestro servidor.»
**Dice ahora:** «Al cerrar sesión, la sesión se cierra también en nuestro servidor y el
dispositivo deja de tener acceso. Si prestas o vendes el equipo, borra los datos del
navegador desde su configuración.»

**Por qué se retiró.** `logout()` en `AuthProvider.tsx` hace `tokens.clear()` y avisa al
servidor, pero **no toca IndexedDB**. Se quedan en el navegador el catálogo completo
(`catalog`), las ventas pendientes de sincronizar (`pendingSales`) y `meta`.

**Esto no es sólo una imprecisión del texto: es un fallo.** En una caja compartida, o en un
teléfono que cambia de manos, el catálogo del negocio anterior sigue ahí. La segunda mitad de
la frase —la sesión sí se cierra en el servidor— es cierta desde la #8.

**Qué costaría implementarlo.** Poco, pero tiene una trampa que hay que pensar antes de
tocarlo: **si hay ventas sin sincronizar, borrarlas al cerrar sesión destruye dinero
cobrado**. El cierre de sesión tendría que avisar («tienes N ventas sin subir») y no borrar
hasta que la cola esté vacía, o sincronizar antes de salir.

**Recomendación.** Arreglarlo, con esa guarda. Es el único de la lista que es un bug de
privacidad real y no un pendiente de despliegue.

---

## Y una en sentido contrario: lo que el sistema hace y el texto no decía

El panel de plataforma puede **generar una contraseña temporal para cualquier usuario de
cualquier negocio** (`POST /platform/tenants/:id/users/:userId/password`). Cierra todas las
sesiones de esa persona y queda en `platform_audit_log` con quién lo hizo, pero es un poder
mayor que el «podemos acceder para dar soporte» que declaraba el texto: permite entrar como
el dueño.

**Se añadió al texto** (§4 de privacidad), no se retiró. Un cliente tiene derecho a saber que
esa llave existe, y decirlo es más barato que explicarlo después.

---

# Segunda ronda — 2026-08-11

> Las fotos de producto entraron ese día y son una **categoría de datos nueva**: viven en
> el disco del servidor y no dentro de Postgres, y se sirven por una dirección que **no
> pide sesión**. `TERMS_VERSION` había subido esa misma mañana por lo del fiado sin que
> nadie tocara la privacidad — o sea que la disciplina se cumplió a medias: se subió la
> versión, pero no se revisó qué había cambiado de lo que se guarda y quién lo ve.
>
> Pasa de `2026-08-11` a `2026-08-11.2`. El sufijo distingue las dos ediciones del mismo
> día; la fecha que se enseña al pie sigue siendo limpia (`ULTIMA_ACTUALIZACION`).

## 5. «Una copia COMPLETA de tus datos»

**Decía:** «Puedes descargar una copia completa de tus datos cuando quieras.»
**Dice ahora:** enumera lo que trae y añade: «De las fotos de producto lleva su dirección,
no la imagen; cada foto se descarga abriendo esa dirección.»

**Por qué se retiró.** `GET /business/export` emite `product.imageUrl` —una ruta— y ningún
byte de imagen. Con 5.000 productos, meterlas en el JSON en base64 daría un archivo de
cientos de megas, así que la salida honesta no es hinchar el export: es decir qué trae.

**Qué costaría implementarlo.** Un ZIP en vez de un JSON: una dependencia de compresión en
el servidor y streaming para no cargarlo todo en memoria en una máquina de 1 vCPU. Es la
forma correcta de cumplir la portabilidad de verdad, y es un trabajo con su propio diseño.

## 6. Que el borrado tras cancelar ocurre solo

**Decía:** «Pasado ese plazo podremos borrarlos definitivamente.»
**Dice ahora:** lo mismo, más «El borrado no es automático: lo hacemos nosotros cuando
corresponde o cuando nos lo pides. Si quieres que tus datos y tus fotos se borren en una
fecha concreta, escríbenos y te confirmamos cuándo se hizo.»

**Por qué se matizó.** No existe **ninguna** ruta que borre un negocio ni sus datos: ni en
`business.ts` ni en `platform.ts`. Y para las fotos hay una función escrita para eso
—`borrarTodoDe()` en `lib/almacen.ts`— que **no tiene un solo llamador en producción**. El
verbo era «podremos», o sea una facultad y no una obligación, así que el texto no mentía;
lo que faltaba era decir que quien lo ejecuta es una persona.

**Qué costaría implementarlo.** Una tarea programada que recorra los negocios cancelados
hace más de `DIAS_RETENCION_TRAS_CANCELAR` días y borre base y fotos, con registro de qué
se borró y cuándo. Ojo con hacerlo automático sin freno: es la única operación del sistema
que destruye datos de un cliente sin vuelta atrás.

## Y otra en sentido contrario: las fotos se ven sin iniciar sesión

`/media/<negocio>/<uuid>.webp` lo sirve `fastify-static` **sin pasar por `requireAuth`**, y
es a propósito: son `<img>` del mostrador y pedir sesión por cada miniatura las haría
inservibles. La protección real es que el nombre lleva un uuid que no se puede adivinar y
que no hay listado de directorio.

Pero la privacidad decía «los negocios están aislados entre sí: ninguna consulta del sistema
devuelve información de otro negocio», y eso, leído por un cliente, promete que todo está
detrás de la sesión. **Se añadió la excepción al texto** (§4 de privacidad), con la
recomendación de no subir en una foto de producto nada que no se quiera ver así. Mismo
criterio que la contraseña temporal del panel: decirlo es más barato que explicarlo después.
