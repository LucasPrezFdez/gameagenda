// Steam vinculado, dentro de «Tu cuenta» (ADR-014): desde cuándo, la última actualización,
// «Actualizar sola» (de este dispositivo), «Actualizar ahora» y desvincular. Sin vínculo, lleva a
// «Importar desde Steam», en Ajustes › Datos, donde se vincula. Los textos van en `steam/texts.ts`,
// fuera del JS inicial, y la actualización (`steam/auto-refresh.ts`) se carga al pulsar.
import { useEffect, useId, useState } from 'react';
import { useServices } from '../../app/services.tsx';
import { Link } from '../../router/router.tsx';
import { settingsPath } from '../../router/routes.ts';
import { steamTexts as t } from '../../steam/texts.ts';
import type { AccountInfo, SyncService } from '../../sync/types.ts';
import { steamLinkDates, syncErrorText } from './sync-model.ts';
import { attempt, ConfirmAction, focusWhenReady } from './sync-ui.tsx';

type Refresh = 'idle' | 'busy' | { readonly message: string };

export function SteamLinkSection({
  sync,
  info,
  onInfo,
  notify,
  headingId,
}: {
  sync: SyncService;
  info: AccountInfo;
  onInfo: (info: AccountInfo) => void;
  notify: (message: string) => void;
  /** El encabezado de «Tu cuenta», al que vuelve el foco al desvincular. */
  headingId: string;
}) {
  const id = useId();
  const { agenda, search, notices } = useServices();
  const [auto, setAuto] = useState<boolean | null>(null);
  const [refresh, setRefresh] = useState<Refresh>('idle');

  useEffect(() => {
    let live = true;
    void sync.localAccount().then((account) => {
      if (live) setAuto(account.steamAuto);
    });
    return () => {
      live = false;
    };
  }, [sync]);

  if (info.steam === null) {
    return (
      <section className="sync__block" aria-labelledby={`${id}-title`} data-steam-link="off">
        <h3 id={`${id}-title`} className="settings__subtitle">
          {t.linkTitle}
        </h3>
        <p>{t.notLinked}</p>
        <div className="settings__buttons">
          <Link to={settingsPath('data')} className="btn">
            {t.goImport}
          </Link>
        </div>
      </section>
    );
  }

  const dates = steamLinkDates(info.steam, Date.now());

  async function refreshNow(): Promise<void> {
    if (refresh === 'busy' || !__STEAM_IMPORT__) return;
    setRefresh('busy');
    let message: string;
    try {
      const steam = await import('../../steam/auto-refresh.ts');
      const outcome = await steam.runSteamAutoRefresh({
        sync,
        agenda,
        notices,
        catalogTitles: async (appids) => {
          const { found } = await search.lookup(appids);
          return new Map(found.map((game) => [game.appid, game.nameEs ?? game.name]));
        },
      });
      switch (outcome.kind) {
        case 'applied':
          message = t.autoApplied(outcome.counts);
          break;
        case 'unchanged':
          message = t.refreshNothing;
          break;
        case 'private':
          message = t.refreshPrivate;
          break;
        case 'tooSoon':
          message = t.refreshTooSoon;
          break;
        case 'unlinked':
          message = t.unlinked;
          break;
        case 'failed':
          message = t.refreshFailed;
          break;
      }
    } catch {
      message = t.refreshFailed;
    }
    setRefresh({ message });
    // La fecha nueva (o que ya no hay vínculo), de la micro-API.
    const fresh = await attempt(() => sync.account());
    if (fresh.ok) onInfo(fresh.value);
  }

  return (
    <>
      <section className="sync__block" aria-labelledby={`${id}-title`} data-steam-link="on">
        <h3 id={`${id}-title`} className="settings__subtitle">
          {t.linkTitle}
        </h3>
        <p>
          {dates.since !== null && t.linkedSince(dates.since)}{' '}
          {dates.last !== null ? t.lastRefresh(dates.last) : t.neverRefreshed}
        </p>
        {auto !== null && (
          <label className="settings__choice">
            <input
              type="checkbox"
              checked={auto}
              onChange={(event) => {
                const on = event.target.checked;
                setAuto(on);
                void sync.updateLocalAccount({ steamAuto: on });
              }}
            />
            {t.autoLabel}
          </label>
        )}
        <div className="settings__buttons">
          <button
            id={`${id}-refresh`}
            type="button"
            className="btn"
            aria-disabled={refresh === 'busy'}
            onClick={() => void refreshNow()}
          >
            {refresh === 'busy' ? t.refreshing : t.refreshNow}
          </button>
        </div>
        <div className="settings__import-result" role="status">
          {typeof refresh === 'object' && <p>{refresh.message}</p>}
        </div>
      </section>
      <ConfirmAction
        headingId={`${id}-unlink`}
        title={t.unlinkTitle}
        intro={t.unlinkIntro}
        action={t.unlinkTitle}
        question={t.unlinkConfirm}
        confirm={t.unlinkDo}
        busyLabel={t.unlinking}
        danger
        run={async () => {
          const result = await attempt(() => sync.unlinkSteam());
          if (!result.ok) return syncErrorText(result.code, 'account');
          onInfo(result.value);
          notify(t.unlinked);
          focusWhenReady(headingId);
          return null;
        }}
      />
    </>
  );
}
