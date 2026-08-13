import type { PlanFeature, Role } from '@ventafacil/shared';

/**
 * El guion del tour guiado: qué se enseña, en qué pantalla y en qué orden.
 *
 * Está en un archivo aparte, y son datos y no componentes, por una razón práctica: lo que
 * hay que retocar cuando un cliente llama con una duda es el TEXTO, y así se retoca sin
 * tocar el motor ni arriesgarse a romper la navegación.
 *
 * ## Cómo se ancla cada paso
 *
 * `ancla` es el valor de un atributo `data-tour` en la pantalla. Si el elemento no está
 * —porque en móvil no existe, porque la lista está vacía, porque la pantalla aún carga—,
 * el paso NO se cae: se enseña centrado, con la sección de fondo. Eso importa más de lo
 * que parece: un tour que se rompe en el teléfono de un vendedor es peor que no tenerlo,
 * porque la llamada que llega después es «se me quedó la pantalla oscura».
 *
 * Por eso cada sección abre con un paso SIN ancla. Explica para qué sirve la pantalla
 * —que es lo que de verdad se pregunta por teléfono— y funciona en cualquier tamaño.
 *
 * ## Por qué el orden es éste
 *
 * El del día de trabajo, no el del menú: se vende, se mira lo vendido, se repone, se
 * cuadra la caja. Lo de administración va al final porque se toca una vez y no todos los
 * días. Un vendedor se queda sólo con la primera mitad, que es justo la suya.
 */
export interface PasoTour {
  /** Identificador estable. Sirve para los tests y para saltar a un paso concreto. */
  id: string;
  /** A qué pantalla hay que ir. El tour navega solo antes de enseñar el paso. */
  ruta: string;
  /** `data-tour` del elemento a resaltar. Sin ancla, el paso sale centrado. */
  ancla?: string;
  titulo: string;
  texto: string;
  /** Sólo para administradores: un vendedor ni siquiera puede abrir esas pantallas. */
  soloAdmin?: boolean;
  /** Además, sólo desde la sucursal central (el API cierra estas a las demás). */
  soloCentral?: boolean;
  /** Sólo si el plan contratado incluye la función. */
  feature?: PlanFeature;
}

export const PASOS: PasoTour[] = [
  // ── Vender ────────────────────────────────────────────────────
  {
    id: 'vender',
    ruta: '/',
    titulo: 'Aquí se cobra',
    texto:
      'Ésta es la pantalla del mostrador y la que más vas a usar. Busca el producto, ármale ' +
      'el carrito al cliente y cobra. Funciona aunque se caiga el internet: la venta se ' +
      'guarda en este equipo y sube sola cuando vuelve.',
  },
  {
    id: 'vender-buscar',
    ruta: '/',
    ancla: 'pos-buscar',
    titulo: 'Busca por nombre o por código',
    texto:
      'Escribe las primeras letras del producto. Si tienes lector de código de barras, ' +
      'dispáralo sin más: entra por aquí y se agrega solo al carrito.',
  },
  {
    id: 'vender-carrito',
    ruta: '/',
    ancla: 'pos-carrito',
    titulo: 'El carrito',
    texto:
      'Lo que va a llevarse el cliente. Puedes cambiar la cantidad o quitar una línea antes ' +
      'de cobrar. Si el producto no tiene existencias, no se deja agregar: primero dale ' +
      'entrada en Inventario.',
  },
  {
    id: 'vender-cobrar',
    ruta: '/',
    ancla: 'pos-cobrar',
    titulo: 'Cobrar y entregar el recibo',
    texto:
      'Elige cómo te pagan y confirma. Sale el recibo para imprimir o para mandar. La venta ' +
      'ya descontó el stock y ya está en la caja del turno.',
  },

  // ── Ventas ────────────────────────────────────────────────────
  {
    id: 'ventas',
    ruta: '/ventas',
    titulo: 'Todo lo que vendiste',
    texto:
      'El historial. Aquí encuentras una venta por fecha, por cliente o por número de ' +
      'recibo, vuelves a imprimir su recibo y ves qué llevaba.',
  },
  {
    id: 'ventas-anular',
    ruta: '/ventas',
    ancla: 'ventas-lista',
    titulo: 'Si te equivocaste, se anula',
    texto:
      'Abre la venta y anúlala. El sistema devuelve los productos al stock y saca el dinero ' +
      'de la caja por ti. No borra nada: la venta queda marcada como anulada, que es lo que ' +
      'te salva cuando hay que explicar un descuadre.',
  },

  // ── Productos ─────────────────────────────────────────────────
  {
    id: 'productos',
    ruta: '/productos',
    titulo: 'Tu catálogo',
    texto:
      'Lo que vendes, con su precio y su foto. Lo que crees aquí aparece en el acto en la ' +
      'pantalla de cobro.',
  },
  {
    id: 'productos-nuevo',
    ruta: '/productos',
    ancla: 'productos-nuevo',
    titulo: 'Dar de alta un producto',
    texto:
      'Nombre y precio es lo único obligatorio. El código se genera solo si no le pones ' +
      'uno. El COSTO no se lo ve el cliente y es lo que hace que el reporte de ganancia ' +
      'diga la verdad, así que vale la pena llenarlo.',
  },

  // ── Inventario ────────────────────────────────────────────────
  {
    id: 'inventario',
    ruta: '/inventario',
    titulo: 'Cuánto te queda',
    texto:
      'Las existencias de cada producto en cada sucursal. Vender descuenta solo; lo que se ' +
      'hace a mano aquí es dar entrada a lo que compraste y dar salida a lo que se rompió o ' +
      'se regaló.',
  },
  {
    id: 'inventario-movimiento',
    ruta: '/inventario',
    ancla: 'inventario-movimiento',
    titulo: 'Entradas y salidas',
    texto:
      'Cada movimiento queda con su motivo y con quién lo hizo. Es la diferencia entre «me ' +
      'falta mercadería» y «sé exactamente cuándo salió y por qué».',
  },

  // ── Caja ──────────────────────────────────────────────────────
  {
    id: 'caja',
    ruta: '/caja',
    titulo: 'La caja del turno',
    texto:
      'Se abre al empezar el día con el efectivo que hay en el cajón, y se cierra al ' +
      'terminar contando lo que quedó. El sistema te dice si sobra o falta.',
  },
  {
    id: 'caja-movimientos',
    ruta: '/caja',
    ancla: 'caja-movimientos',
    titulo: 'Sacar o meter plata fuera de una venta',
    texto:
      'Pagar al proveedor, comprar bolsas, dejar un adelanto. Anótalo aquí en el momento: ' +
      'es lo único que evita que al cerrar el turno no cuadre y nadie recuerde por qué.',
  },

  // ── Análisis (admin) ──────────────────────────────────────────
  {
    id: 'caja-z',
    ruta: '/caja/z',
    soloAdmin: true,
    titulo: 'La lectura Z',
    texto:
      'El resumen de un turno ya cerrado: cuánto entró, por qué medio de pago y qué ' +
      'diferencia hubo al contar. Es el papel que se archiva al final del día.',
  },
  {
    id: 'panel',
    ruta: '/panel',
    soloAdmin: true,
    feature: 'reportes_avanzados',
    titulo: 'Cómo va el negocio',
    texto:
      'De un vistazo: lo vendido, lo que más sale y cómo te pagan. Sirve para decidir qué ' +
      'reponer sin ponerte a sumar.',
  },
  {
    id: 'reportes',
    ruta: '/reportes',
    soloAdmin: true,
    titulo: 'Reportes para imprimir',
    texto:
      'Elige un rango de fechas y sácalo en PDF o Excel. Es lo que se le entrega al ' +
      'contador, y lo que responde «cuánto gané este mes» con la ganancia real, ya ' +
      'descontado el costo.',
  },

  // ── Administración ────────────────────────────────────────────
  {
    id: 'clientes',
    ruta: '/clientes',
    soloAdmin: true,
    titulo: 'Tus clientes',
    texto:
      'Quiénes te compran y cuánto llevan comprado. No hace falta darlos de alta aquí: en ' +
      'la pantalla de cobro se crea uno nuevo sin salir de la venta.',
  },
  {
    id: 'usuarios',
    ruta: '/usuarios',
    soloAdmin: true,
    titulo: 'Quién puede entrar',
    texto:
      'Da de alta a tu gente con su propio usuario. Un vendedor ve lo suyo: cobra, consulta ' +
      'y maneja caja, pero no toca precios, costos ni reportes. Que cada uno entre con el ' +
      'suyo es lo que después permite saber quién hizo qué.',
  },
  {
    id: 'ubicaciones',
    ruta: '/ubicaciones',
    soloAdmin: true,
    soloCentral: true,
    titulo: 'Si tienes más de un local',
    texto:
      'Cada sucursal lleva su propio stock y su propia caja. La central es la que ve y ' +
      'configura todas; las demás sólo lo suyo.',
  },
  {
    id: 'actividad',
    ruta: '/actividad',
    soloAdmin: true,
    feature: 'auditoria',
    titulo: 'Quién hizo qué',
    texto:
      'El registro de lo que se tocó: quién anuló una venta, quién cambió un precio, quién ' +
      'dio salida a mercadería. Con fecha y con nombre.',
  },
  {
    id: 'configuracion',
    ruta: '/configuracion',
    soloAdmin: true,
    soloCentral: true,
    titulo: 'Los datos de tu negocio',
    texto:
      'Nombre, logo, moneda y lo que sale impreso en el recibo. Déjalo listo una vez y ' +
      'olvídate.',
  },
  {
    id: 'suscripcion',
    ruta: '/suscripcion',
    soloAdmin: true,
    soloCentral: true,
    titulo: 'Tu plan',
    texto: 'Qué plan tienes, hasta cuándo está pagado y qué incluye.',
  },

  // ── Cierre ────────────────────────────────────────────────────
  {
    id: 'ayuda',
    ruta: '/perfil',
    ancla: 'perfil-ayuda',
    titulo: 'Y si se te olvida, vuelve aquí',
    texto:
      'Este recorrido está siempre disponible en Ayuda. Púlsalo cuando quieras y arranca de ' +
      'nuevo, sin llamar a nadie.',
  },
];

/** Con qué se cuenta para decidir qué pasos ve esta persona. */
export interface QuienMira {
  role: Role;
  isCentral: boolean;
  /** ¿El plan incluye esta función? Se le pasa `has` de la suscripción. */
  tiene: (feature: PlanFeature) => boolean;
}

/**
 * Los pasos que esta persona puede ver de verdad.
 *
 * Filtrar no es cosmética: sin esto, el tour llevaría a un vendedor a `/usuarios`, la ruta
 * lo devolvería al inicio y el recorrido se quedaría dando tumbos. Enseñar una pantalla a
 * la que no se puede entrar tampoco es enseñar nada — es prometer algo que no hay.
 */
export function pasosPara(quien: QuienMira, pasos: PasoTour[] = PASOS): PasoTour[] {
  return pasos.filter((p) => {
    if (p.soloAdmin && quien.role !== 'admin') return false;
    if (p.soloCentral && !quien.isCentral) return false;
    if (p.feature && !quien.tiene(p.feature)) return false;
    return true;
  });
}
