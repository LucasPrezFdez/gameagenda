// Contrato entre la interfaz (Ajustes › Sincronización) y la sincronización (M4; §5.3, §7.7 y
// §11.4; ADR-011). Lo cumple `createSyncService()` (`facade.ts`), que va en el *chunk* inicial sin
// Zod ni red: el motor (`runtime.ts`) se carga con `import()` solo si este navegador está emparejado
// o cuando la interfaz pide activar, emparejar o recuperar. La sincronización nunca pregunta
// (RF-26): va sola al arrancar, al volver el foco o la red, al cambiar la visibilidad y unos 2 s
// después de cada cambio local.
import type { ApiErrorCode, DeviceInfo } from '@gameagenda/core/api';

/**
 * - `off`: este navegador no sincroniza (nunca se activó, se desemparejó o se borró la agenda).
 * - `paired`: emparejado; mira `activity`.
 * - `restoring`: hay indicio de emparejamiento (`__Host-ga_sync=1`) pero no hay estado local
 *   (IndexedDB borrada, CA4.3): baja la agenda desde 0. Pasa a `paired` con la primera ronda buena.
 *   Si se borra con la app abierta, restaura sin recargar.
 * - `unpaired`: había estado local, pero el dispositivo ya no está emparejado: mira
 *   `unpairedReason`. La agenda local y la `outbox` siguen intactas; la interfaz ofrece canjear el
 *   código de recuperación (`redeemRecoveryCode`) o dejarlo así (`forget`).
 */
export type SyncStatus = 'off' | 'paired' | 'restoring' | 'unpaired';

/**
 * Qué hace la sincronización (solo con `paired` o `restoring`; con los demás, `idle`):
 * - `idle`: al día o esperando el siguiente disparador;
 * - `syncing`: hay una ronda en marcha;
 * - `offline`: sin red (`navigator.onLine === false` o un fallo de red sin conexión): espera a
 *   `online`;
 * - `error`: la última ronda falló (`error` dice por qué); se reintenta sola con espera
 *   exponencial (de unos 5 s a 5 min) mientras la página esté visible. También si no se ha podido
 *   cargar el motor (`network`; una pestaña vieja tras un despliegue): eso no se reintenta solo,
 *   sino con `syncNow` («Sincronizar ahora»);
 * - `disabled`: la micro-API responde 503 `sync_disabled` (interruptor `SYNC_ENABLED`, CA4.7);
 *   no se reintenta en bucle, solo con el siguiente disparador.
 */
export type SyncActivity = 'idle' | 'syncing' | 'offline' | 'error' | 'disabled';

/**
 * Error de una operación de la micro-API: un código de `@gameagenda/core/api` (`invalid_code`,
 * `already_paired`, `age_policy_changed`, `rate_limited`, `sync_disabled`, `unauthorized`…), o
 * - `network`: no se ha podido hablar con el servidor (sin red, tiempo agotado);
 * - `bad_response`: la respuesta no es la esperada (Zod la rechaza, o no es JSON);
 * - `storage`: no se ha podido leer o guardar en IndexedDB durante la ronda;
 * - `unavailable`: no hay IndexedDB (la agenda vive solo en memoria): no se puede sincronizar.
 */
export type SyncErrorCode = ApiErrorCode | 'network' | 'bad_response' | 'storage' | 'unavailable';

/** Lo que lanzan las operaciones de `SyncService`. */
export class SyncError extends Error {
  readonly code: SyncErrorCode;
  /** Estado HTTP, si hubo respuesta. */
  readonly status: number | null;

  constructor(code: SyncErrorCode, status: number | null = null) {
    super(`sync: ${code}${status === null ? '' : ` (${status})`}`);
    this.name = 'SyncError';
    this.code = code;
    this.status = status;
  }
}

/** Instantánea para `useSyncExternalStore`: la referencia cambia solo si cambia algo. */
export interface SyncState {
  /** `false` hasta leer el estado guardado (unos ms tras arrancar): evita parpadeos en Ajustes. */
  readonly ready: boolean;
  readonly status: SyncStatus;
  readonly activity: SyncActivity;
  /** Por qué falló la última ronda (con `activity` `error`, `offline` o `disabled`), o `null`. */
  readonly error: SyncErrorCode | null;
  /**
   * Con `unpaired`: `cookies` (se borraron las cookies del sitio, o caducaron) o `server` (el
   * servidor respondió 401: revocado desde otro dispositivo o agenda borrada). Si no, `null`.
   */
  readonly unpairedReason: 'cookies' | 'server' | null;
  /** Id de este dispositivo en el servidor (para marcarlo en la lista), si se conoce. */
  readonly deviceId: string | null;
  /** Juegos con cambios sin subir (entradas distintas en la `outbox`); 0 con `off`. */
  readonly pending: number;
  /** Última ronda correcta (ms desde 1970), de esta pestaña o de otra; `null` si ninguna. */
  readonly lastSyncAt: number | null;
}

export interface ActivateInput {
  /** Nombre del dispositivo en la lista («Chrome en Windows»): ver `defaultDeviceLabel()`. */
  readonly label: string;
  /** La edad que se le ha pedido declarar (`DEFAULT_MIN_AGE`, 14; R-10). */
  readonly minAge: number;
}

export interface RedeemInput {
  /** Lo que ha tecleado o pegado el usuario: se normaliza con `parseCode()` de core. */
  readonly code: string;
  readonly label: string;
}

export type { DeviceInfo };

/**
 * El servicio `sync` de `AppServices`. Las operaciones cargan el motor si hace falta y lanzan
 * `SyncError`. Ninguna toca las entradas salvo para subirlas o fusionar lo que llega.
 */
export interface SyncService {
  getSnapshot(): SyncState;
  subscribe(listener: () => void): () => void;

  /**
   * «Activar sincronización» (con la declaración de edad ya aceptada, CA4.7): crea la agenda en el
   * servidor (cookie `__Host-` y su indicio), sube todas las entradas locales y sincroniza.
   * Devuelve el código de recuperación formateado (`XXXX-XXXX-…`), que solo se muestra esta vez.
   * Errores: `age_policy_changed` (el servidor pide otra edad), `already_paired`,
   * `rate_limited`, `sync_disabled`, `network`…
   */
  activate(input: ActivateInput): Promise<{ readonly recoveryCode: string }>;
  /**
   * Canjea un código de emparejamiento de otro dispositivo: se une a su agenda, sube las entradas
   * locales (se fusionan con las de la agenda, nada se pierde) y sincroniza. Un código mal escrito
   * da `invalid_code` sin llamar al servidor; usado, caducado o inventado, también `invalid_code`.
   */
  redeemPairingCode(input: RedeemInput): Promise<void>;
  /** Como `redeemPairingCode`, con el código de recuperación (CA4.3; el código sigue valiendo). */
  redeemRecoveryCode(input: RedeemInput): Promise<void>;
  /** Código de emparejamiento nuevo, de un solo uso y 10 min (`expiresAt`, ISO 8601 UTC). */
  createPairingCode(): Promise<{ readonly code: string; readonly expiresAt: string }>;
  /** Código de recuperación nuevo; el anterior deja de valer. Se muestra una vez. */
  createRecoveryCode(): Promise<{ readonly recoveryCode: string }>;
  /** Dispositivos de la agenda (`current` marca este), incluido el buzón del Atajo de iOS. */
  listDevices(): Promise<readonly DeviceInfo[]>;
  /**
   * Revoca un dispositivo. Si es este (`self: true`), es «Desemparejar este dispositivo»: el
   * servidor quita las cookies, el estado pasa a `off` y la agenda local se queda como está. Una
   * ronda que ya estuviera en marcha acaba sin cambiar ese `off`.
   */
  revokeDevice(id: string): Promise<{ readonly self: boolean }>;
  /**
   * Borra la agenda del servidor en cascada (CA4.7) y deja este navegador en `off`. Para «Borrar
   * todos mis datos»: llamarla ANTES de `agenda.deleteAll()`; si no, con el indicio aún puesto y
   * `meta` vacía, la app restauraría la agenda desde el servidor. Sin emparejar, no hace nada.
   * Antes espera a que acabe la ronda en marcha de otra pestaña (Web Lock), y lo que llegue
   * después ya no se guarda.
   *
   * Si el dispositivo ya no está emparejado (401: lo han revocado desde otro, o la agenda ya no
   * existe; el servidor no distingue los dos casos), NO ha borrado nada: el estado pasa a
   * `unpaired` (`server`; `off` si no había estado local) y rechaza con `unauthorized`. Con los
   * demás errores tampoco ha borrado nada, y la sincronización sigue como estaba.
   */
  deleteServerAgenda(): Promise<void>;
  /** Sincroniza ya («Reintentar ahora»); se resuelve al acabar la ronda (no lanza). */
  syncNow(): Promise<void>;
  /** Con `unpaired`: olvida el estado de sincronización (pasa a `off`); no toca la agenda. */
  forget(): Promise<void>;
  /** Para `main.tsx`: la agenda de esta pestaña ha guardado operaciones en la `outbox`. */
  notifyLocalWrite(): void;
  /** Deja de escuchar eventos (pruebas). */
  dispose(): void;
}
