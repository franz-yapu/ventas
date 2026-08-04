import {
  DIAS_RETENCION_TRAS_CANCELAR,
  EMPRESA,
  TERMS_VERSION,
  TRIAL_DAYS,
} from '@ventafacil/shared';

/**
 * Textos legales.
 *
 * ⚠️ **BORRADOR.** Está redactado a partir de lo que el sistema hace de verdad —los
 * planes, la prueba, la morosidad que no corta, la exportación, dónde viven los datos—
 * y no de una plantilla genérica. Pero **no lo ha revisado un abogado**. Antes de abrir
 * el registro al público conviene que lo mire alguien con criterio legal en Bolivia,
 * sobre todo la limitación de responsabilidad y el tratamiento de datos personales.
 *
 * Los marcadores de `EMPRESA` (razón social, NIT, hosting, correo) están sin completar
 * a propósito: inventar una razón social o un NIT sería peor que dejarlos a la vista.
 *
 * Si cambias cualquiera de estos textos, **sube `TERMS_VERSION`**: es lo que se guarda
 * junto a la aceptación de cada negocio.
 */

export interface Seccion {
  titulo: string;
  parrafos: string[];
}

export const ULTIMA_ACTUALIZACION = TERMS_VERSION;

export const TERMINOS: Seccion[] = [
  {
    titulo: '1. Quiénes somos y qué es este servicio',
    parrafos: [
      `${EMPRESA.producto} es un sistema de punto de venta que se usa por internet, prestado por ${EMPRESA.razonSocial} (NIT ${EMPRESA.nit}), con domicilio en ${EMPRESA.ciudad}, ${EMPRESA.pais}.`,
      'Al crear una cuenta aceptas estas condiciones. Si no estás de acuerdo con alguna, no uses el servicio.',
    ],
  },
  {
    titulo: '2. Tu cuenta',
    parrafos: [
      'Eres responsable de lo que se haga desde tu cuenta y las de tu equipo. Guarda tus contraseñas, no las compartas y da de baja a quien deje de trabajar contigo: al desactivar a un usuario, sus sesiones se cierran de inmediato.',
      'Debes darnos datos reales al registrarte, incluido un correo válido. Sin un correo confirmado no podrás recuperar tu contraseña por tu cuenta.',
      'Cada negocio tiene su propia dirección (subdominio). Nos reservamos las direcciones que puedan confundirse con la plataforma.',
    ],
  },
  {
    titulo: '3. Prueba, planes y pagos',
    parrafos: [
      `Al registrarte tienes ${TRIAL_DAYS} días de prueba sin costo y sin tarjeta. Al terminar, para seguir usando el servicio hay que elegir un plan.`,
      'Cada plan incluye un cupo de sucursales, usuarios y productos. Puedes cambiar de plan cuando quieras; el cambio se aplica de inmediato.',
      'Los precios están en bolivianos y pueden cambiar. Si cambian, te avisaremos antes de que te afecte.',
    ],
  },
  {
    titulo: '4. Si te atrasas en el pago',
    parrafos: [
      'Un pago atrasado NO corta el servicio de inmediato: seguirás vendiendo y verás un aviso en la aplicación. Nos parece que dejar sin caja a un negocio por un pago de unos días es desproporcionado.',
      'Si la deuda se prolonga y no hay respuesta, podremos suspender la cuenta. Suspendida, no se puede usar el sistema, pero tus datos siguen ahí y vuelven al reactivarla.',
    ],
  },
  {
    titulo: '5. Disponibilidad del servicio',
    parrafos: [
      'Hacemos lo razonable para que el servicio esté disponible, pero no prometemos que funcione sin interrupciones. Habrá cortes por mantenimiento, fallas del proveedor de servidores o causas fuera de nuestro control.',
      'La aplicación puede seguir vendiendo sin internet y sincroniza al reconectar. Aun así, revisa que tus ventas se hayan sincronizado.',
    ],
  },
  {
    titulo: '6. Tus datos son tuyos',
    parrafos: [
      'Los productos, ventas, clientes y demás información que cargues son tuyos. No los vendemos ni los usamos para otra cosa que prestarte el servicio.',
      'Puedes descargar una copia completa en cualquier momento desde Administración, en un archivo que sirve para migrar a otro sistema.',
      `Si cancelas, conservamos tus datos ${DIAS_RETENCION_TRAS_CANCELAR} días por si quieres volver o descargar una copia. Pasado ese plazo podremos borrarlos definitivamente.`,
    ],
  },
  {
    titulo: '7. Uso aceptable',
    parrafos: [
      'No uses el servicio para actividades ilegales, ni para almacenar información que no tengas derecho a tratar, ni para intentar acceder a datos de otros negocios.',
      'Podemos suspender de inmediato una cuenta que ponga en riesgo el servicio o los datos de terceros.',
    ],
  },
  {
    titulo: '8. Facturación e impuestos',
    parrafos: [
      'El sistema registra tus ventas para tu control interno. No emite facturas fiscales ni te sustituye ante el Servicio de Impuestos Nacionales: el cumplimiento tributario de tu negocio sigue siendo tuyo.',
    ],
  },
  {
    titulo: '9. Responsabilidad',
    parrafos: [
      'El servicio se presta tal como está. En la medida en que la ley lo permita, nuestra responsabilidad por cualquier reclamo se limita a lo que hayas pagado por el servicio en los últimos tres meses.',
      'No respondemos por lucro cesante ni por daños indirectos.',
    ],
  },
  {
    titulo: '10. Cambios y cancelación',
    parrafos: [
      'Puedes cancelar cuando quieras. No hay permanencia mínima.',
      'Podemos cambiar estas condiciones. Si el cambio es importante, te avisaremos con antelación razonable; seguir usando el servicio después implica aceptarlas.',
    ],
  },
  {
    titulo: '11. Ley aplicable',
    parrafos: [
      `Estas condiciones se rigen por las leyes de ${EMPRESA.pais}. Cualquier diferencia se resolverá ante los tribunales de ${EMPRESA.ciudad}.`,
      `Para cualquier consulta: ${EMPRESA.correoContacto}.`,
    ],
  },
];

export const PRIVACIDAD: Seccion[] = [
  {
    titulo: '1. Qué datos guardamos',
    parrafos: [
      'De ti y de tu equipo: nombre, usuario, correo y contraseña (cifrada, nunca en texto legible), además de un registro de la actividad dentro del sistema.',
      'De tu negocio: productos, inventario, ventas, movimientos de caja y los clientes que registres.',
      'Datos técnicos mínimos para que el servicio funcione y para detectar abusos.',
    ],
  },
  {
    titulo: '2. Los datos de TUS clientes',
    parrafos: [
      'Si registras clientes (por ejemplo para ventas al fiado), esos datos son responsabilidad tuya: tú decides qué guardas y para qué. Nosotros sólo los almacenamos por cuenta tuya, como parte del servicio.',
      'Carga sólo lo que necesites y ten el consentimiento de esas personas cuando corresponda.',
    ],
  },
  {
    titulo: '3. Para qué los usamos',
    parrafos: [
      'Únicamente para prestarte el servicio: mostrarte tu información, cobrar tu suscripción, darte soporte y avisarte de cosas importantes de tu cuenta.',
      'No vendemos tus datos ni los cedemos a terceros con fines comerciales. No usamos publicidad ni herramientas de seguimiento de terceros dentro de la aplicación.',
    ],
  },
  {
    titulo: '4. Quién puede verlos',
    parrafos: [
      'Tú y los usuarios que tú crees. Los negocios están aislados entre sí: la base de datos aplica esa separación por sí misma, no sólo el programa.',
      'Nuestro equipo puede acceder cuando haga falta para dar soporte o resolver una falla, y esos accesos quedan registrados.',
      `La información se aloja en ${EMPRESA.hosting}.`,
    ],
  },
  {
    titulo: '5. Sesión y almacenamiento en tu dispositivo',
    parrafos: [
      'Guardamos en tu navegador lo necesario para mantener la sesión y para que la aplicación funcione sin internet (catálogo y ventas pendientes de sincronizar). No usamos cookies de publicidad.',
      'Al cerrar sesión, esa información se borra del dispositivo y la sesión se cierra también en nuestro servidor.',
    ],
  },
  {
    titulo: '6. Cuánto tiempo los conservamos',
    parrafos: [
      'Mientras tengas la cuenta activa.',
      `Si cancelas, ${DIAS_RETENCION_TRAS_CANCELAR} días más, por si quieres volver o descargar una copia. Después podremos borrarlos definitivamente.`,
    ],
  },
  {
    titulo: '7. Tus derechos',
    parrafos: [
      'Puedes descargar una copia completa de tus datos cuando quieras, desde Administración.',
      `Puedes pedirnos que corrijamos o borremos información escribiendo a ${EMPRESA.correoContacto}. Ten en cuenta que algunos registros —como los de ventas ya emitidas— pueden tener que conservarse por obligaciones contables.`,
    ],
  },
  {
    titulo: '8. Seguridad',
    parrafos: [
      'Las contraseñas se guardan cifradas y no se pueden recuperar, sólo restablecer. Las conexiones van cifradas. Hacemos copias de seguridad periódicas.',
      'Ningún sistema es infalible. Si ocurriera un incidente que afecte tus datos, te lo comunicaremos.',
    ],
  },
  {
    titulo: '9. Contacto',
    parrafos: [
      `${EMPRESA.razonSocial} · ${EMPRESA.ciudad}, ${EMPRESA.pais} · ${EMPRESA.correoContacto}`,
    ],
  },
];
