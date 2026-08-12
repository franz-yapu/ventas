// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, montar, screen, userEvent, waitFor } from './montar';
import { FotoDeProducto, Miniatura } from '@/features/products/FotoDeProducto';
import { ahorro, type ImagenLista } from '@/lib/imagen';

/**
 * La foto de producto en la pantalla.
 *
 * `lib/imagen.ts` (recorte y redimensionado) y `lib/almacen.ts` (dónde se escribe)
 * llevaban días escritos y **sin que nada los llamara**. Esto cubre el trozo que los une
 * con lo que ve una persona.
 *
 * Lo que se fija aquí es sobre todo la **caída al hueco cuando la imagen no carga**. No es
 * un detalle cosmético: esto es un POS offline-first, el catálogo vive en el navegador y
 * las fotos no —el service worker precachea la aplicación, no `/media`—. Sin señal, la URL
 * está guardada y la imagen no llega. Con el icono roto del navegador, el catálogo parece
 * averiado justo cuando alguien vende con el móvil sin cobertura.
 *
 * El recorte a 800×800 no se prueba aquí: necesita un `<canvas>` de verdad, y jsdom no lo
 * tiene. Se comprueba en el navegador.
 */

function imagenFalsa(bytes = 61_000, original = 3_800_000): ImagenLista {
  return {
    blob: new Blob([new Uint8Array(8)], { type: 'image/webp' }),
    url: 'blob:falsa',
    bytes,
    bytesOriginal: original,
  };
}

beforeEach(() => {
  // jsdom no las implementa, y el componente las usa para la vista previa.
  URL.createObjectURL = vi.fn(() => 'blob:falsa');
  URL.revokeObjectURL = vi.fn();
});

describe('la miniatura de una lista', () => {
  it('enseña la foto cuando la hay, apuntando al origen del API', () => {
    // `imageUrl` se guarda como ruta relativa; un `<img src="/media/…">` se resolvería
    // contra el origen de la WEB, que no es el del API. En producción son dominios
    // distintos y en local, puertos distintos: sin prefijo, todas las fotos rotas.
    montar(<Miniatura url="/media/negocio-1/abc.webp" />);
    const img = screen.getByRole('presentation', { hidden: true }) as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/^https?:\/\/.+\/media\/negocio-1\/abc\.webp$/);
  });

  it('sin foto no se pinta ninguna imagen, y el recuadro sigue ahí', () => {
    // Antes este caso comprobaba el hueco A TRAVÉS del icono de imagen tachada. Ese icono
    // se quitó —parecía un error de carga en un producto que simplemente no tiene foto—,
    // así que el hueco se comprueba por lo que de verdad importa: que ocupe su sitio y la
    // fila no baile entre productos con y sin foto.
    const { container } = montar(<Miniatura url={null} className="h-10 w-10" />);
    expect(container.querySelector('img')).toBeNull();
    expect((container.firstElementChild as HTMLElement).className).toContain('h-10');
  });

  it('si la imagen NO CARGA cae al mismo hueco: es el caso de vender sin señal', () => {
    const { container } = montar(<Miniatura url="/media/negocio-1/abc.webp" />);
    // `fireEvent` y no `dispatchEvent(new Event('error'))`: el evento `error` de una imagen
    // NO burbujea, y React escucha en la raíz. Lanzado a mano nunca llegaba al `onError`,
    // así que el test fallaba por el montaje y no por el componente.
    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img'), 'se quedó el icono roto del navegador').toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  /**
   * Sin foto no se pinta un icono de «imagen rota».
   *
   * Reportado probando en el NAS: en la rejilla de Vender, los productos sin foto salían
   * con el icono de imagen tachada — que es exactamente lo que parece un error de carga.
   * Un producto sin foto no es un fallo: es un producto sin foto.
   *
   * Se distingue de lo otro, que sí merece marcador: una foto que EXISTE y no cargó (sin
   * señal en el mostrador). Ahí el hueco tachado informa de algo real y temporal.
   */
  it('un producto sin foto deja el hueco vacío, sin icono de rota', () => {
    const { container } = montar(<Miniatura url={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg'), 'pinta el icono de imagen rota').toBeNull();
  });

  it('pero el hueco sigue ocupando su sitio, para que la rejilla no baile', () => {
    const { container } = montar(<Miniatura url={null} className="h-20 w-full" />);
    const hueco = container.firstElementChild as HTMLElement;
    expect(hueco.className).toContain('h-20');
  });

  it('una foto que SÍ existe pero no carga sí lleva marcador: es un fallo real', () => {
    const { container } = montar(<Miniatura url="/media/n1/abc.webp" />);
    fireEvent.error(container.querySelector('img')!);
    expect(
      container.querySelector('svg'),
      'sin marcador no se distingue de no tener foto',
    ).toBeTruthy();
  });

  /*
    Y la foto se ve ENTERA y centrada, no recortada y ampliada.

    Las fotos se guardan cuadradas (recorte central 800×800), pero en el POS el hueco es
    una banda ancha y baja: con `object-cover` se recortaba arriba y abajo y se ampliaba el
    centro — «se ve muy grande», que es como lo describió quien lo probó.
  */
  it('la imagen se ve completa dentro de su hueco', () => {
    const { container } = montar(<Miniatura url="/media/n1/abc.webp" className="h-20 w-full" />);
    const img = container.querySelector('img')!;
    expect(img.className).toContain('object-contain');
    expect(img.className, 'recorta la foto en vez de mostrarla entera').not.toContain(
      'object-cover',
    );
  });

  /**
   * Caerse al hueco es correcto; QUEDARSE ahí, no.
   *
   * `falló` se ponía a `true` en el primer `onError` y no se reiniciaba nunca. En el POS
   * las filas mantienen `key={p.id}`, así que las mismas instancias siguen montadas: un
   * vendedor perdía señal, todas las miniaturas caían al marcador (bien), volvía la señal
   * — y **el catálogo se quedaba sin fotos el resto de la sesión**, hasta recargar.
   *
   * Lo mismo al reemplazar una foto cuya URL anterior había fallado: la nueva salía como
   * marcador y la subida parecía no haber hecho nada.
   */
  it('al cambiar la foto vuelve a intentarlo, en vez de quedarse en el hueco', () => {
    const { container, rerender } = montar(<Miniatura url="/media/negocio-1/vieja.webp" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    rerender(<Miniatura url="/media/negocio-1/nueva.webp" />);

    const img = container.querySelector('img');
    expect(img, 'la foto nueva heredó el fallo de la anterior').toBeTruthy();
    expect(img!.getAttribute('src')).toContain('nueva.webp');
  });

  it('y una foto que falló sigue fallando si no cambia, sin parpadear', () => {
    // La otra mitad: reintentar en cada render dejaría el icono roto entrando y saliendo.
    const { container, rerender } = montar(<Miniatura url="/media/negocio-1/abc.webp" />);
    fireEvent.error(container.querySelector('img')!);
    rerender(<Miniatura url="/media/negocio-1/abc.webp" />);
    expect(container.querySelector('img')).toBeNull();
  });

  /*
    Y cuando vuelve la conexión. Es el caso del docstring del componente: en el POS no hay
    remontaje que valga —las filas conservan su `key`— así que sin esto la única salida es
    recargar la página, con una venta a medias.
  */
  it('cuando vuelve la red reintenta las que se cayeron sin señal', () => {
    const { container } = montar(<Miniatura url="/media/negocio-1/abc.webp" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    fireEvent(window, new Event('online'));

    expect(container.querySelector('img'), 'sigue en el hueco con la red de vuelta').toBeTruthy();
  });
});

describe('elegir la foto en el formulario', () => {
  function montarControl(props: Partial<Parameters<typeof FotoDeProducto>[0]> = {}) {
    const onNueva = vi.fn();
    const onQuitar = vi.fn();
    montar(
      <FotoDeProducto
        actual={null}
        nueva={null}
        onNueva={onNueva}
        quitar={false}
        onQuitar={onQuitar}
        {...props}
      />,
    );
    return { onNueva, onQuitar };
  }

  it('sin nada todavía, invita a elegir y dice el tope', () => {
    montarControl();
    expect(screen.getByRole('button', { name: /Elegir foto/ })).toBeTruthy();
    expect(screen.getByText(/Se recorta al cuadro/)).toBeTruthy();
  });

  it('con una preparada, enseña el AHORRO y avisa de que se sube al guardar', () => {
    /*
      El «3,8 MB → 61 kB» no es un adorno técnico: explica la espera que acaba de pasar y
      le dice a alguien con mala conexión que esto va a subir. Sin ese número, el
      redimensionado es trabajo invisible que sólo se nota cuando falla.
    */
    const foto = imagenFalsa();
    montarControl({ nueva: foto });
    // Se compara contra `ahorro()` de verdad y no contra un texto escrito a mano: al
    // escribirlo a mano puse "3,8 MB → 61 kB" calculando los megas en decimal, y la
    // función los calcula en binario ("3.6 MB → 60 kB"). Un test que copia el resultado
    // esperado en vez de derivarlo sólo prueba que sé multiplicar.
    expect(screen.getByText(ahorro(foto))).toBeTruthy();
    expect(screen.getByText(/Se subirá al guardar/)).toBeTruthy();
  });

  it('con una ya guardada, el botón dice CAMBIAR y aparece el de quitar', () => {
    montarControl({ actual: '/media/negocio-1/abc.webp' });
    expect(screen.getByRole('button', { name: /Cambiar/ })).toBeTruthy();
    expect(screen.getByLabelText('Quitar la foto')).toBeTruthy();
  });

  it('quitar una GUARDADA pide borrarla; quitar una recién elegida, no', async () => {
    // La diferencia importa: una que nunca se subió no tiene nada que borrar en el
    // servidor, y pedirlo sería una petición que sobra y un 404 en el log.
    const a = montarControl({ actual: '/media/negocio-1/abc.webp' });
    await userEvent.click(screen.getByLabelText('Quitar la foto'));
    expect(a.onQuitar).toHaveBeenCalledWith(true);
    expect(a.onNueva).toHaveBeenCalledWith(null);
  });

  it('el selector sólo ofrece imágenes', async () => {
    /*
      La primera defensa, y la que evita el 99 % de los casos: el `accept` del input. Se
      comprueba porque el test de abajo tiene que SALTÁRSELA a propósito, y conviene que
      quede claro que existe.
    */
    montarControl();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.accept).toBe('image/*');
  });

  it('y aun así, un archivo que no es imagen se rechaza sin llamar a nadie', async () => {
    /*
      Se usa `fireEvent` y no `userEvent.upload` porque éste RESPETA el `accept` del input
      y ni siquiera dispara el cambio — o sea que con él este test pasaba sin ejecutar una
      sola línea de la comprobación que dice vigilar. La segunda defensa importa porque el
      `accept` es una sugerencia: en el diálogo del sistema se puede elegir «todos los
      archivos», y en algunos móviles ni se respeta.
    */
    const { onNueva } = montarControl();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const archivo = new File(['no soy una foto'], 'notas.txt', { type: 'text/plain' });

    fireEvent.change(input, { target: { files: [archivo] } });

    await waitFor(() => expect(screen.getByText(/no parece una imagen/i)).toBeTruthy());
    expect(onNueva).not.toHaveBeenCalled();
  });
});
