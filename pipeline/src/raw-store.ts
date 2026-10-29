// Páginas crudas de una ejecución (`pipeline/state/raw-<fecha>/`, ignorada por git): cada
// respuesta correcta se guarda comprimida con su URL, su fecha y lo medido al descargarla. Sirven
// para reanudar una pasada cortada y para volver a derivar sin red (`--from-raw`) si falla la
// construcción.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { CachedResponse, ResponseCache } from '../steam/client.ts';

interface RawRecord extends CachedResponse {
  readonly url: string;
  readonly date: string;
}

const RE_NAME = /^[a-z0-9-]+$/;

export class RawStore implements ResponseCache {
  readonly dir: string;
  private readonly now: () => number;

  constructor(dir: string, now: () => number) {
    this.dir = dir;
    this.now = now;
  }

  private file(name: string): string {
    if (!RE_NAME.test(name)) throw new Error(`Nombre de página cruda no válido: ${name}`);
    return join(this.dir, `${name}.json.gz`);
  }

  get(name: string, url: string): CachedResponse | null {
    const f = this.file(name);
    if (!existsSync(f)) return null;
    const rec = JSON.parse(gunzipSync(readFileSync(f)).toString('utf8')) as RawRecord;
    // Otra petición con el mismo nombre (p. ej., otro `data_request`): no vale.
    if (rec.url !== url) return null;
    return { body: rec.body, wireBytes: rec.wireBytes ?? 0, ms: rec.ms ?? 0 };
  }

  put(name: string, url: string, response: CachedResponse): void {
    mkdirSync(this.dir, { recursive: true });
    const rec: RawRecord = {
      url,
      date: new Date(this.now()).toISOString(),
      wireBytes: response.wireBytes,
      ms: response.ms,
      body: response.body,
    };
    writeFileSync(this.file(name), gzipSync(JSON.stringify(rec)));
  }
}
