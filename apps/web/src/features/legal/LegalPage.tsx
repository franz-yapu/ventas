import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PRIVACIDAD, TERMINOS, ULTIMA_ACTUALIZACION, type Seccion } from './textos';

/** Términos y privacidad. Páginas públicas: se leen antes de tener cuenta. */
export function LegalPage({ tipo }: { tipo: 'terminos' | 'privacidad' }) {
  const esTerminos = tipo === 'terminos';
  const secciones: Seccion[] = esTerminos ? TERMINOS : PRIVACIDAD;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <ArrowLeft size={15} /> Volver
      </Link>

      <h1 className="text-2xl font-bold tracking-[-0.02em]">
        {esTerminos ? 'Términos del servicio' : 'Política de privacidad'}
      </h1>
      <p className="mt-1 text-[13px] text-muted">
        Última actualización: {ULTIMA_ACTUALIZACION}
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {secciones.map((s) => (
          <section key={s.titulo}>
            <h2 className="text-[15px] font-bold">{s.titulo}</h2>
            {s.parrafos.map((p, i) => (
              <p key={i} className="mt-2 text-sm leading-relaxed text-fg/90">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>

      <div className="mt-8 border-t border-border pt-4 text-[13px] text-muted">
        {esTerminos ? (
          <Link to="/privacidad" className="underline underline-offset-2">
            Ver la política de privacidad
          </Link>
        ) : (
          <Link to="/terminos" className="underline underline-offset-2">
            Ver los términos del servicio
          </Link>
        )}
      </div>
    </div>
  );
}
