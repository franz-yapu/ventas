import { ImageOff, ImageUp, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { urlDeMedia } from '@/lib/api';
import {
  ahorro,
  ErrorDeImagen,
  MAX_ENTRADA_MB,
  prepararImagen,
  type ImagenLista,
} from '@/lib/imagen';

/**
 * Elegir la foto de un producto dentro del formulario.
 *
 * La foto **no se sube aquí**. Este control deja la imagen ya preparada —recortada al
 * cuadro, 800×800 WebP— y quien manda el formulario la sube después de guardar. El motivo
 * es el producto nuevo: todavía no tiene identificador, así que no hay `/products/:id/image`
 * al que subirla. Pedirle a alguien que guarde primero y vuelva a entrar para poner la foto
 * es hacerle pagar a él un detalle de nuestra implementación.
 *
 * ## Lo que se enseña, y por qué
 *
 * El «3,8 MB → 61 kB» no es un adorno técnico: es lo que explica la espera de dos segundos
 * que acaba de pasar, y lo que le dice a alguien con una conexión mala que esto va a subir.
 * Sin ese número, el redimensionado es trabajo invisible que sólo se nota cuando falla.
 */

interface Props {
  /** La que ya tiene guardada, si la tiene. */
  actual: string | null | undefined;
  /** La preparada y aún sin subir. `null` = ninguna nueva. */
  nueva: ImagenLista | null;
  onNueva: (i: ImagenLista | null) => void;
  /** Marcada para quitar al guardar. Sólo aplica si había una. */
  quitar: boolean;
  onQuitar: (v: boolean) => void;
}

export function FotoDeProducto({ actual, nueva, onNueva, quitar, onQuitar }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);

  /*
    La URL del objeto se revoca al cambiarla o al desmontar. Sin esto, cada foto que
    alguien prueba antes de decidirse se queda en memoria hasta recargar la página — y
    quien monta un catálogo prueba muchas.
  */
  useEffect(() => {
    return () => {
      if (nueva) URL.revokeObjectURL(nueva.url);
    };
  }, [nueva]);

  async function elegir(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreparando(true);
    try {
      const lista = await prepararImagen(file);
      if (nueva) URL.revokeObjectURL(nueva.url);
      onNueva(lista);
      onQuitar(false);
    } catch (e) {
      setError(e instanceof ErrorDeImagen ? e.message : 'No se pudo preparar la imagen.');
    } finally {
      setPreparando(false);
      // Se limpia para que elegir DOS VECES el mismo archivo vuelva a disparar el cambio.
      if (input.current) input.current.value = '';
    }
  }

  const previa = nueva?.url ?? (quitar ? undefined : urlDeMedia(actual));
  const hayAlgo = !!nueva || (!!actual && !quitar);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm text-muted">Foto (opcional)</label>
      <div className="flex items-center gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-theme border border-field bg-bg">
          {previa ? (
            // `contain` como en la miniatura: la vista previa tiene que enseñar la foto
            // ENTERA y centrada. Con `cover`, una foto todavía sin recortar —la que acaba
            // de elegirse de la galería— se veía a trozos, y quien la elige no puede saber
            // si escogió la que quería.
            <img src={previa} alt="" className="h-full w-full object-contain" />
          ) : (
            <ImageOff size={22} className="text-muted" aria-hidden="true" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-3"
              disabled={preparando}
              onClick={() => input.current?.click()}
            >
              <ImageUp size={16} />
              {preparando ? 'Preparando…' : hayAlgo ? 'Cambiar' : 'Elegir foto'}
            </Button>
            {hayAlgo && (
              <Button
                type="button"
                variant="outline"
                className="h-10 px-3"
                aria-label="Quitar la foto"
                onClick={() => {
                  if (nueva) URL.revokeObjectURL(nueva.url);
                  onNueva(null);
                  // Sólo hay que pedirle al servidor que la borre si había una guardada.
                  onQuitar(!!actual);
                }}
              >
                <Trash2 size={16} />
              </Button>
            )}
          </div>

          <p className="text-[12px] leading-[1.45] text-muted">
            {nueva ? (
              <>
                Se subirá al guardar · <span className="font-semibold">{ahorro(nueva)}</span>
              </>
            ) : quitar && actual ? (
              'Se quitará al guardar.'
            ) : (
              `Se recorta al cuadro y se reduce sola. Hasta ${MAX_ENTRADA_MB} MB.`
            )}
          </p>
        </div>
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void elegir(e.target.files?.[0])}
      />
    </div>
  );
}

/**
 * La foto de un producto en una lista o en la rejilla: la imagen, o un hueco del mismo
 * tamaño para que nada baile entre un producto con foto y otro sin ella.
 *
 * ## El caso que obliga a manejar el error de carga
 *
 * Esto es un POS **offline-first**: el catálogo vive en el navegador y se vende sin
 * internet. Las fotos no — son archivos del servidor, y el service worker precachea la
 * aplicación, no `/media`. O sea que sin señal la URL está guardada y la imagen no llega.
 *
 * Sin `onError`, cada tarjeta enseñaría el icono de imagen rota del navegador: un catálogo
 * que parece averiado justo cuando alguien está vendiendo con el móvil sin cobertura. Con
 * él se cae al mismo hueco discreto que un producto sin foto, y no pasa nada.
 */
export function Miniatura({
  url,
  className = 'h-10 w-10',
  icono = 14,
}: {
  url: string | null | undefined;
  className?: string;
  icono?: number;
}) {
  /**
   * Se guarda QUÉ url falló, no un simple "falló".
   *
   * Con un booleano, el primer `onError` lo dejaba en `true` para siempre: ni al cambiar
   * la prop `url` ni al volver la red se reintentaba. Y en el POS las filas conservan
   * `key={p.id}`, así que las mismas instancias siguen montadas — un vendedor perdía
   * señal, todas las miniaturas caían al marcador (que es lo correcto), volvía la señal y
   * **el catálogo se quedaba sin fotos el resto de la sesión**. Igual al reemplazar una
   * foto cuya url anterior había fallado: la nueva salía como marcador y la subida parecía
   * no haber hecho nada.
   *
   * Comparando con la url de ahora, cambiarla ya es reintentar, sin ningún efecto de por
   * medio. Y una que sigue fallando no parpadea: se compara contra la misma cadena.
   */
  const [urlFallida, setUrlFallida] = useState<string | null>(null);
  const src = urlDeMedia(url);
  const falló = !!src && urlFallida === src;

  /*
    Y al volver la conexión se olvida el fallo.

    Es el caso que describe el docstring de arriba y el único que no se arregla solo: la
    url no cambia, así que sin esto la única salida sería recargar la página — con una
    venta a medias en la pantalla.
  */
  useEffect(() => {
    const alVolver = () => setUrlFallida(null);
    window.addEventListener('online', alVolver);
    return () => window.removeEventListener('online', alVolver);
  }, []);

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-theme-sm border border-border bg-bg ${className}`}
    >
      {src && !falló ? (
        /*
          `object-contain`, no `cover`.

          Las fotos se guardan CUADRADAS (recorte central 800×800), pero este hueco no
          siempre lo es: en la rejilla del POS es una banda ancha y baja. Con `cover` la
          foto se recortaba arriba y abajo y se ampliaba el centro — se veía un trozo del
          producto, grande y descuadrado. Con `contain` se ve entera y centrada, que es
          para lo que está ahí.

          `alt` vacío a propósito: el nombre del producto ya está al lado, y repetirlo hace
          que un lector de pantalla lo diga dos veces por fila.
        */
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setUrlFallida(src)}
          className="h-full w-full object-contain"
        />
      ) : (
        /*
          El marcador es SÓLO para una foto que existe y no cargó — sin señal en el
          mostrador, típicamente—, porque ahí informa de algo real y temporal.

          Un producto sin foto no lleva nada: el icono de imagen tachada se lee como un
          error, y no tener foto no es un error. El hueco se queda reservado igual, que es
          lo que impide que la rejilla baile entre unos productos y otros.
        */
        falló && <ImageOff size={icono} className="text-muted" aria-hidden="true" />
      )}
    </div>
  );
}
