import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS } from '@ventafacil/shared';

/**
 * Toda acción que el API escriba en la bitácora tiene que tener nombre en español.
 *
 * El tipo de `AuditEntry` ya impide emitir una acción que no esté en la lista, y el
 * `Record<AuditAction, string>` impide que una de la lista se quede sin rótulo. Eso cubre
 * el caso normal.
 *
 * Lo que NO cubre es que alguien vuelva a poner `action: string` para salir del paso, que
 * es justo como llegó a haber 21 acciones emitidas y 8 traducidas: trece salían crudas en
 * la única pantalla que tiene un dueño para vigilar a su gente. Este test lee el código
 * fuente y no los tipos, así que sobrevive a que alguien afloje el tipo.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function archivosTs(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) salida.push(...archivosTs(ruta));
    else if (e.name.endsWith('.ts')) salida.push(ruta);
  }
  return salida;
}

/**
 * Acciones y entidades escritas en el código de los módulos del negocio.
 *
 * `platform.ts` queda fuera: sus acciones van a `platform_audit_log`, que es otra tabla y
 * otra pantalla. Lo que hacemos nosotros sobre la cartera de clientes no se mezcla con lo
 * que hace el personal de un negocio sobre su propio inventario.
 */
function emitidas(clave: 'action' | 'entity'): Set<string> {
  const re = new RegExp(`${clave}: '([a-z_]+)'`, 'g');
  const encontradas = new Set<string>();
  for (const archivo of archivosTs(SRC)) {
    if (archivo.endsWith('platform.ts')) continue;
    for (const [, v] of readFileSync(archivo, 'utf8').matchAll(re)) encontradas.add(v!);
  }
  return encontradas;
}

describe('la bitácora se lee en español', () => {
  it('toda acción que emite el API tiene rótulo', () => {
    const sinRotulo = [...emitidas('action')].filter((a) => !(a in AUDIT_ACTION_LABELS));
    expect(
      sinRotulo,
      `estas acciones saldrían crudas en la pantalla de Actividad: ${sinRotulo.join(', ')}`,
    ).toEqual([]);
  });

  it('toda entidad que emite el API tiene rótulo', () => {
    const sinRotulo = [...emitidas('entity')].filter((e) => !(e in AUDIT_ENTITY_LABELS));
    expect(sinRotulo, `estas entidades saldrían crudas: ${sinRotulo.join(', ')}`).toEqual([]);
  });

  it('el barrido encuentra algo: si no, los dos de arriba pasan por vacío', () => {
    // El seguro de siempre. Si el patrón dejara de casar —porque cambió la forma de
    // llamar a `app.audit`—, las comprobaciones de arriba estarían verdes sin mirar nada.
    expect(emitidas('action').size).toBeGreaterThan(8);
    expect(emitidas('entity').size).toBeGreaterThan(5);
  });
});
