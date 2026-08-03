import { describe, expect, it } from 'vitest';
import { slugDesdeHostname } from '@/features/auth/AuthProvider';

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
    expect(slugDesdeHostname('llantas-el-rapido.localhost', 'localhost')).toBe(
      'llantas-el-rapido',
    );
    expect(slugDesdeHostname('localhost', 'localhost')).toBeUndefined();
  });
});
