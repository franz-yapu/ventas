import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { useSubscription } from '@/features/subscription/SubscriptionProvider';
import { Tour } from '@/features/tour/Tour';
import { PASOS, pasosPara, type PasoTour } from '@/features/tour/pasos';

/**
 * Cuándo sale el tour, dónde está y cómo se apaga.
 *
 * Sale solo en las dos primeras entradas de cada persona —lo decide el servidor, que es
 * el único que sabe cuántas veces ha entrado, también desde otro equipo— y a partir de
 * ahí sólo cuando lo piden desde Ayuda.
 *
 * Cerrarlo de cualquier modo (saltar, terminar, la X, Escape) significa lo mismo: no
 * volver a sacarlo solo. Es lo que se pidió, y es lo honesto: un tour que reaparece
 * después de que alguien lo cerró es exactamente la clase de cosa que hace que la gente
 * llame por teléfono.
 */

interface TourContextValue {
  activo: boolean;
  /** Lo abre desde el principio. Es lo que hace el botón de Ayuda. */
  iniciarTour: () => void;
}

const TourContext = createContext<TourContextValue>({ activo: false, iniciarTour: () => {} });

export function TourProvider({ children }: { children: ReactNode }) {
  const { user, marcarTourVisto } = useAuth();
  const { has } = useSubscription();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [indice, setIndice] = useState<number | null>(null);
  /*
    Que ya se ofreció en ESTA carga de la página. `mostrarTour` viene del servidor y
    tarda en cambiar a false —hay una petición de por medio—, así que sin esta marca el
    efecto volvería a abrirlo en el mismo instante en que se cierra.
  */
  const [yaOfrecido, setYaOfrecido] = useState(false);

  const pasos: PasoTour[] = useMemo(
    () =>
      user ? pasosPara({ role: user.role, isCentral: user.isCentral, tiene: has }, PASOS) : [],
    [user, has],
  );

  const iniciarTour = useCallback(() => {
    if (pasos.length > 0) setIndice(0);
  }, [pasos.length]);

  // Ofrecerlo solo, una vez por carga, cuando el servidor dice que toca.
  useEffect(() => {
    if (!user?.mostrarTour || yaOfrecido || pasos.length === 0) return;
    setYaOfrecido(true);
    setIndice(0);
  }, [user?.mostrarTour, yaOfrecido, pasos.length]);

  const cerrar = useCallback(() => {
    setIndice(null);
    void marcarTourVisto();
  }, [marcarTourVisto]);

  const paso = indice === null ? null : pasos[indice];

  // Llevar a la pantalla del paso. El tour navega por la persona: si tuviera que ir ella,
  // dejaría de ser un tour y sería una lista de instrucciones.
  useEffect(() => {
    if (paso && paso.ruta !== pathname) navigate(paso.ruta);
  }, [paso, pathname, navigate]);

  const siguiente = useCallback(() => {
    setIndice((i) => {
      if (i === null) return null;
      // El último «Siguiente» no existe: ahí el botón dice «Listo» y cierra.
      return i + 1 < pasos.length ? i + 1 : i;
    });
  }, [pasos.length]);

  const anterior = useCallback(
    () => setIndice((i) => (i === null ? null : Math.max(0, i - 1))),
    [],
  );

  return (
    <TourContext.Provider value={{ activo: paso !== null, iniciarTour }}>
      {children}
      {paso && indice !== null && (
        <Tour
          // Remontar en cada paso: así el estado interno (la caja medida, el alto de la
          // tarjeta) no se arrastra del paso anterior y se ve un salto de posición.
          key={paso.id}
          paso={paso}
          indice={indice}
          total={pasos.length}
          onAnterior={anterior}
          onSiguiente={siguiente}
          onCerrar={cerrar}
        />
      )}
    </TourContext.Provider>
  );
}

export function useTour() {
  return useContext(TourContext);
}
