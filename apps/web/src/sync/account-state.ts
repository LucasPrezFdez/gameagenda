// Lo que este dispositivo sabe de la cuenta (ADR-014), en `meta.account`. Sin Zod: lo lee la
// fachada, en el *chunk* inicial. Lo que no tiene la forma esperada cuenta como vacío. Se borra con
// el estado de la sincronización (al cerrar sesión, al borrar la agenda o con un 401).

/** `meta.account`. */
export interface AccountRecord {
  /**
   * El email con que se creó la cuenta o se entró en este dispositivo, normalizado. D1 no lo
   * guarda en claro, así que un dispositivo que entró con un código o una llave no lo sabe.
   */
  readonly email: string | null;
  /** La agenda tiene una cuenta de Steam vinculada (lo último que dijo `GET /account`). */
  readonly steamLinked: boolean;
  /** «Actualizar sola»: la biblioteca de Steam, al abrir la app. Es de este dispositivo. */
  readonly steamAuto: boolean;
  /** La última vez que este dispositivo pidió la biblioteca a Steam (ms), o `null`. */
  readonly steamCheckedAt: number | null;
}

export const EMPTY_ACCOUNT: AccountRecord = {
  email: null,
  steamLinked: false,
  steamAuto: true,
  steamCheckedAt: null,
};

export function parseAccountRecord(value: unknown): AccountRecord {
  if (typeof value !== 'object' || value === null) return EMPTY_ACCOUNT;
  const { email, steamLinked, steamAuto, steamCheckedAt } = value as Record<string, unknown>;
  return {
    email: typeof email === 'string' && email !== '' ? email : null,
    steamLinked: steamLinked === true,
    steamAuto: steamAuto !== false,
    steamCheckedAt:
      typeof steamCheckedAt === 'number' &&
      Number.isSafeInteger(steamCheckedAt) &&
      steamCheckedAt >= 0
        ? steamCheckedAt
        : null,
  };
}
