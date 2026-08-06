import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Marca, NombreDeMarca } from '@/components/Marca';
import { PRIVACIDAD, TERMINOS, ULTIMA_ACTUALIZACION, type Seccion } from './textos';

/** Términos y privacidad. Páginas públicas: se leen antes de tener cuenta. */
export function LegalPage({ tipo }: { tipo: 'terminos' | 'privacidad' }) {
  const esTerminos = tipo === 'terminos';
  const secciones: Seccion[] = esTerminos ? TERMINOS : PRIVACIDAD;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      {/* La marca también aquí: se llega desde el login del negocio, y salir a una
          página sin identidad da la sensación de haberse ido de la aplicación. */}
      <div className="mb-6 flex items-center gap-3 border-b border-border pb-5">
        <Marca size="sm" />
        <NombreDeMarca className="text-[15px] font-bold tracking-[-0.02em]" />
      </div>

      <Link
        to="/login"
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={15} /> Volver
      </Link>

      <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">
        {esTerminos ? 'Términos del servicio' : 'Política de privacidad'}
      </h1>
      <p className="mt-1.5 text-[13px] text-muted">Última actualización: {ULTIMA_ACTUALIZACION}</p>

      {/* Índice: son documentos largos y casi siempre se viene a buscar UNA cosa. */}
      <nav className="mt-6 rounded-theme border border-border bg-surface p-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-muted">
          En esta página
        </div>
        <ol className="flex flex-col gap-1.5">
          {secciones.map((s, i) => (
            <li key={s.titulo}>
              <a
                href={`#s${i}`}
                className="text-[13px] text-fg/80 underline-offset-2 hover:text-primary hover:underline"
              >
                {i + 1}. {s.titulo}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-8 flex flex-col gap-7">
        {secciones.map((s, i) => (
          <section key={s.titulo} id={`s${i}`} className="scroll-mt-6">
            <h2 className="text-[16px] font-bold tracking-[-0.01em]">
              <span className="mr-1.5 text-muted">{i + 1}.</span>
              {s.titulo}
            </h2>
            {s.parrafos.map((p, j) => (
              <p key={j} className="mt-2.5 text-[14px] leading-[1.65] text-fg/90">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-5 text-[13px]">
        {esTerminos ? (
          <Link to="/privacidad" className="font-semibold text-primary hover:underline">
            Ver la política de privacidad
          </Link>
        ) : (
          <Link to="/terminos" className="font-semibold text-primary hover:underline">
            Ver los términos del servicio
          </Link>
        )}
        <Link to="/login" className="text-muted hover:text-fg">
          Volver a entrar
        </Link>
      </div>
    </div>
  );
}
