import { money } from '@/lib/format';

/**
 * ¿Esta venta merece una confirmación antes de registrarse?
 *
 * Vive fuera de `PosPage` porque es una **decisión de producto**, no un detalle de la
 * pantalla, y porque dentro del componente no se podía probar: estaba atrapada en una
 * clausura que lee media docena de estados. El test que se escribió para ella acabó
 * probando una copia de la lógica —cero líneas del código real—, que es la peor clase de
 * test: da confianza sin dar nada.
 *
 * ## La regla
 *
 * "Cobrar" no pedía ninguna confirmación: un roce y la venta quedaba hecha. Pero
 * confirmar SIEMPRE tampoco sirve — es el gesto más repetido del día, y un diálogo que se
 * pulsa doscientas veces deja de leerse en una semana, justo cuando haría falta.
 *
 * Así que se pregunta sólo cuando algo se sale de lo normal, que es donde el error sale
 * caro y no se descubre hasta el arqueo:
 *
 * - hay **descuento** (dinero que se deja de cobrar),
 * - es **fiado** (no entra efectivo y queda alguien debiendo),
 * - o el **total es alto** para el mostrador.
 */

/**
 * A partir de cuánto se confirma por el monto.
 *
 * No es una cifra sagrada: es "esto ya no es la compra de siempre" para una tienda de
 * barrio. Si algún día molesta, el sitio para volverlo configurable es Configuración,
 * junto al tope de descuento.
 */
export const MONTO_QUE_MERECE_CONFIRMAR = 1000;

export interface VentaAConfirmar {
  total: number;
  descuento: number;
  metodoDePago: string;
  /** Nombre del cliente, cuando es fiado. */
  cliente?: string | null;
}

export function motivoParaConfirmar(v: VentaAConfirmar): string | null {
  if (v.descuento > 0) {
    return `Vas a cobrar ${money(v.total)} con ${money(v.descuento)} de descuento.`;
  }
  if (v.metodoDePago === 'credit') {
    return v.cliente
      ? `Vas a fiar ${money(v.total)} a ${v.cliente}. Quedará como deuda suya.`
      : `Vas a fiar ${money(v.total)}.`;
  }
  if (v.total >= MONTO_QUE_MERECE_CONFIRMAR) {
    return `Vas a cobrar ${money(v.total)}, que es una venta grande.`;
  }
  return null;
}
