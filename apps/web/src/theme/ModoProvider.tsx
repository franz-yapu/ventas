import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { aplicarModo, esOscuro, guardarModo, leerModo, seguirAlSistema, type Modo } from './modo';

interface ValorModo {
  modo: Modo;
  /** Lo que se está pintando ahora: con "auto" depende del sistema. */
  oscuro: boolean;
  cambiar: (m: Modo) => void;
}

const Ctx = createContext<ValorModo | null>(null);

/**
 * Modo claro/oscuro para toda la app.
 *
 * Va por ENCIMA de la sesión (envuelve al resto en main.tsx): el login, el registro y
 * las pantallas de recuperación también se ven de noche, y son justo las que se abren
 * cuando alguien no puede entrar a las once de la noche.
 */
export function ModoProvider({ children }: { children: ReactNode }) {
  const [modo, setModo] = useState<Modo>(() => leerModo());
  const [oscuro, setOscuro] = useState<boolean>(() => esOscuro(leerModo()));

  useEffect(() => {
    aplicarModo(modo);
    setOscuro(esOscuro(modo));
    // Mientras esté en automático, seguir al sistema en vivo.
    return seguirAlSistema(() => modo);
  }, [modo]);

  const cambiar = useCallback((m: Modo) => {
    guardarModo(m);
    setModo(m);
    setOscuro(esOscuro(m));
  }, []);

  return <Ctx.Provider value={{ modo, oscuro, cambiar }}>{children}</Ctx.Provider>;
}

export function useModo() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useModo debe usarse dentro de ModoProvider');
  return ctx;
}
