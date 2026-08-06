---
name: legal
description: Revisa los textos legales de VentaFácil (términos y privacidad) contrastándolos con lo que el código HACE de verdad, y gestiona la disciplina de TERMS_VERSION. Usar cuando se toquen `packages/shared/src/legal.ts` o `apps/web/src/features/legal/textos.ts`, cuando se pregunte por términos, privacidad, retención de datos o RGPD/protección de datos, antes de abrir el registro al público, y después de cualquier cambio que altere qué datos se guardan, quién los ve o cuánto duran.
---

# Revisión legal de VentaFácil

## Lo que este skill SÍ hace

Comprobar que **el texto no promete lo que el sistema no hace**. Esa es una revisión de
consistencia entre dos artefactos del repo, y se puede verificar leyendo código: es
trabajo de ingeniería, no de derecho.

Es también la clase de error más probable. Los textos se redactaron en agosto de 2026 a
partir del comportamiento real, y el comportamiento cambia cada semana; el texto no.

## Lo que este skill NO hace, y no hay que fingir que hace

- **No sustituye a un abogado.** Nada de aquí valida la limitación de responsabilidad, la
  cláusula de ley aplicable, ni el tratamiento de datos personales bajo la normativa
  boliviana. Si hace falta afirmar qué exige una ley concreta, se dice que hay que
  consultarlo — **no se citan artículos de memoria**. Una cita legal inventada es peor que
  no decir nada, porque parece verificada.
- **No completa los datos de la empresa.** Los marcadores `[ENTRE CORCHETES]` de `EMPRESA`
  (razón social, NIT, ciudad, correo, hosting) son datos reales de franz. Inventar un NIT
  es falsificar un identificador tributario. Se piden; no se rellenan.

## Dónde vive todo

| Qué | Dónde |
|---|---|
| Datos de la empresa, `TERMS_VERSION`, retención | `packages/shared/src/legal.ts` |
| El texto de términos y privacidad | `apps/web/src/features/legal/textos.ts` |
| Las pantallas públicas | `apps/web/src/features/legal/LegalPage.tsx` |
| Exportación de datos | `apps/api/src/modules/export.ts` + `features/legal/ExportarDatos.tsx` |
| La aceptación registrada | `business.termsAcceptedAt` / `termsVersion` |

`faltanDatosLegales()` avisa si quedan marcadores sin completar.

## El procedimiento

### 1. Cada afirmación comprobable, contra el código

Recorrer los textos frase a frase y separar las que **afirman un hecho sobre el sistema**
de las que son condiciones contractuales. Sólo las primeras se verifican aquí. Para cada
una: encontrar el código que la sostiene, o marcarla.

Las que más se han desincronizado, con dónde se comprueban:

| Afirmación | Se comprueba en |
|---|---|
| "al desactivar a un usuario, sus sesiones se cierran de inmediato" | `revocarTodo()` en `users.ts`, y qué cambios la disparan |
| "puedes cambiar de plan cuando quieras" | ¿existe una ruta de cliente que lo haga? `subscription.ts` |
| "descargar una copia completa desde Administración" | `export.ts` y quién puede llamarla |
| "conservamos tus datos N días… después podremos borrarlos" | ¿hay algo que borre? Si no, decirlo |
| "los negocios están aislados… la base de datos aplica esa separación" | RLS **activado en producción**, no sólo programado |
| "al cerrar sesión, esa información se borra del dispositivo" | `logout()` en `AuthProvider` — ¿vacía IndexedDB, o sólo los tokens? |
| "hacemos copias de seguridad periódicas" | ¿hay backup **programado en el servidor**? Un script sin cron no es una copia periódica |
| "nuestro equipo puede acceder… y esos accesos quedan registrados" | `platform_audit_log`, y si hay poderes mayores sin declarar |

⚠️ **Un `.ts` correcto no basta.** Varias de estas frases hablan de producción: RLS y los
backups pueden estar programados y probados en local y no estar activos en el VPS. La
afirmación es sobre el servicio que se presta, no sobre el repositorio.

### 2. Frente a un desajuste, la pregunta correcta

No es "cómo suavizo el texto". Es **cuál de los dos está mal**:

- Si el sistema debería hacerlo → es un bug o una tarea, y se dice. Que el logout no borre
  el catálogo del dispositivo no es un problema de redacción.
- Si la promesa sobra → se ajusta el texto, y **sube `TERMS_VERSION`**.

Bajar una promesa es más barato que cumplirla, y por eso hay que resistirlo: el texto se
escribió porque alguien pensó que eso era lo correcto.

### 3. La disciplina de `TERMS_VERSION`

Se guarda junto a la aceptación de cada negocio (`business.termsVersion`). **Cualquier
cambio de texto la sube**, o deja de haber forma de saber qué aceptó cada quien. Formato
fecha `AAAA-MM-DD`.

Si el cambio es material (afecta a lo que el cliente puede esperar, no una coma), decirlo:
los términos prometen aviso previo para cambios importantes, y eso obliga.

### 4. Lo que un cambio de producto debería disparar

Volver aquí cuando se toque: qué datos se guardan, cuánto duran, quién puede verlos, qué
puede hacer soporte, cómo se cancela, dónde se alojan los datos, o qué se guarda en el
dispositivo.

## Antes de abrir el registro al público

- [ ] `faltanDatosLegales()` devuelve `false` — los cinco datos completados por franz
- [ ] Un abogado con criterio en Bolivia ha revisado responsabilidad y datos personales
- [ ] Cada afirmación del paso 1 verificada contra producción, no contra el repo
- [ ] `TERMS_VERSION` refleja la última edición real
