// *Kill switches* del *manifest* (§7.6, §4.8 y CA2.3): `covers` apaga las portadas y `details`, la
// ficha completa, en la siguiente comprobación del cliente y sin publicar otro cliente. Se fijan en
// `pipeline/kill-switches.json`, versionado: encender uno es un *commit* y una ejecución del
// pipeline, y queda firmado con el *manifest*.

import { readFileSync } from 'node:fs';
import { z } from 'zod';

const killSwitchesSchema = z.strictObject({ covers: z.boolean(), details: z.boolean() });

export type KillSwitches = z.infer<typeof killSwitchesSchema>;

export const KILL_SWITCHES_OFF: KillSwitches = { covers: false, details: false };

/** Lee y valida el fichero de *kill switches*; un campo de más o de menos es un error. */
export function readKillSwitches(path: string): KillSwitches {
  const parsed = killSwitchesSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`${path}: se esperaba {"covers": boolean, "details": boolean}`);
  }
  return parsed.data;
}
