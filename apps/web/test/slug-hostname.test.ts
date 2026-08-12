import { describe, expect, it } from 'vitest';
import { esSubdominioPlataforma, slugDesdeHostname } from '@/features/auth/AuthProvider';
import { urlDelNegocio } from '@/features/auth/LoginPage';

/**
 * A dónde manda el login a quien entra por el dominio base.
 *
 * Es el ÚNICO sitio de la aplicación donde una redirección se arma con texto escrito por
 * una persona: `https://{lo que escribió}.{dominio}/`. Con una barra dentro —`evil.com/`—
 * el resultado es `https://evil.com/.midominio.com/`, y ahí el host ya no es el nuestro:
 * el navegador se va a evil.com y el resto queda de ruta.
 *
 * Hoy no era alcanzable de verdad, porque el API rechaza el login de un negocio que no
 * existe y el campo no se puede rellenar desde la URL. Pero esa garantía la daba el
 * servidor, no esta función — y en esta misma rama ya se cayó una excepción de alcance que
 * se sostenía en algo de fuera. Aquí la comprobación cuesta una línea.
 */
describe('urlDelNegocio', () => {
  const D = 'ventafacil.com';
  const EN_BASE = { protocol: 'https:', port: '', hostname: 'ventafacil.com' };

  it('manda al subdominio del negocio que se escribió', () => {
    expect(urlDelNegocio('llantas', D, EN_BASE)).toBe('https://llantas.ventafacil.com/');
  });

  it('conserva el puerto, para que en local siga funcionando', () => {
    expect(urlDelNegocio('llantas', D, { ...EN_BASE, port: '5173' })).toBe(
      'https://llantas.ventafacil.com:5173/',
    );
  });

  it('estando ya en el subdominio no manda a ninguna parte', () => {
    expect(
      urlDelNegocio('llantas', D, { ...EN_BASE, hostname: 'llantas.ventafacil.com' }),
    ).toBeNull();
  });

  it('sin dominio base configurado, tampoco', () => {
    expect(urlDelNegocio('llantas', undefined, EN_BASE)).toBeNull();
  });

  /*
    Lo que de verdad defiende este test: que ningún carácter permita escaparse del
    dominio. Cada uno de estos rompe la URL por un sitio distinto —la barra abre la ruta,
    la arroba convierte lo anterior en credenciales, los dos puntos en puerto, y el
    interrogante y la almohadilla cortan el host.
  */
  it('un slug que no es un slug NO redirige a ninguna parte', () => {
    for (const malo of [
      'evil.com/',
      'evil.com/x',
      'evil.com\\',
      'evil.com@',
      'evil.com:8080',
      'evil.com?',
      'evil.com#',
      'evil com',
      '..',
      'a.b',
      '',
      '   ',
    ]) {
      expect(urlDelNegocio(malo, D, EN_BASE), `dejó pasar ${JSON.stringify(malo)}`).toBeNull();
    }
  });

  it('lo que sí es un slug pasa, con espacios y mayúsculas de más', () => {
    expect(urlDelNegocio('  Ferre-Dos  ', D, EN_BASE)).toBe('https://ferre-dos.ventafacil.com/');
  });
});

/**
 * Deducir el negocio del subdominio es lo que evita pedirle a nadie un "código de
 * negocio" al entrar. Equivocarse aquí manda a un cliente al negocio de otro, así que
 * conviene tenerlo cubierto.
 */
describe('slugDesdeHostname', () => {
  const D = 'ventafacil.com';

  it('saca el negocio del subdominio', () => {
    expect(slugDesdeHostname('llantas.ventafacil.com', D)).toBe('llantas');
    expect(slugDesdeHostname('ferre-dos.ventafacil.com', D)).toBe('ferre-dos');
  });

  it('el dominio pelado no es un negocio', () => {
    // Sin esto, "ventafacil.com" daría el slug "ventafacil".
    expect(slugDesdeHostname('ventafacil.com', D)).toBeUndefined();
  });

  it('ignora los subdominios de la plataforma', () => {
    for (const sub of ['www', 'app', 'api', 'admin', 'staging']) {
      expect(slugDesdeHostname(`${sub}.ventafacil.com`, D)).toBeUndefined();
    }
  });

  it('no acepta más de un nivel', () => {
    expect(slugDesdeHostname('a.b.ventafacil.com', D)).toBeUndefined();
  });

  it('no confunde un dominio ajeno que termine parecido', () => {
    // "maliciosoventafacil.com" no debe pasar por un subdominio de ventafacil.com.
    expect(slugDesdeHostname('maliciosoventafacil.com', D)).toBeUndefined();
    expect(slugDesdeHostname('llantas.otrodominio.com', D)).toBeUndefined();
  });

  it('sin dominio base configurado no deduce nada', () => {
    // Evita que en desarrollo o en una IP se invente un negocio.
    expect(slugDesdeHostname('llantas.ventafacil.com', undefined)).toBeUndefined();
    expect(slugDesdeHostname('localhost', undefined)).toBeUndefined();
  });

  it('es indiferente a mayúsculas', () => {
    expect(slugDesdeHostname('LLANTAS.VentaFacil.com', D)).toBe('llantas');
  });

  it('funciona con *.localhost, que es como se prueba en local', () => {
    expect(slugDesdeHostname('llantas-el-rapido.localhost', 'localhost')).toBe('llantas-el-rapido');
    expect(slugDesdeHostname('localhost', 'localhost')).toBeUndefined();
  });
});

describe('esSubdominioPlataforma', () => {
  const D = 'ventafacil.com';

  it('reconoce el subdominio del panel', () => {
    expect(esSubdominioPlataforma('admin.ventafacil.com', D)).toBe(true);
    expect(esSubdominioPlataforma('ADMIN.VentaFacil.com', D)).toBe(true);
  });

  it('el subdominio de un negocio no es el panel', () => {
    expect(esSubdominioPlataforma('llantas.ventafacil.com', D)).toBe(false);
    expect(esSubdominioPlataforma('ventafacil.com', D)).toBe(false);
  });

  it('no se cuela un dominio ajeno que termine parecido', () => {
    // El riesgo real: que `admin.ventafacil.com.malo.io` pasara por el panel.
    expect(esSubdominioPlataforma('admin.ventafacil.com.malo.io', D)).toBe(false);
    expect(esSubdominioPlataforma('adminventafacil.com', D)).toBe(false);
    expect(esSubdominioPlataforma('otro.admin.ventafacil.com', D)).toBe(false);
  });

  it('sin dominio base configurado no deduce nada', () => {
    expect(esSubdominioPlataforma('admin.ventafacil.com', undefined)).toBe(false);
  });

  it('funciona con *.localhost, que es como se prueba en local', () => {
    expect(esSubdominioPlataforma('admin.localhost', 'localhost')).toBe(true);
  });
});
