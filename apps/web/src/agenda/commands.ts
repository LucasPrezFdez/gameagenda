// Une las acciones de la agenda con el aviso y Deshacer: cada acción pinta al instante, avisa con
// el texto de la §9.9 y deja su Deshacer en la pila.
import { useMemo } from 'react';
import { useServices } from '../app/services.tsx';
import { es } from '../i18n/es.ts';
import type { FeedbackTiming } from '../perf/measures.ts';
import type {
  AgendaEffect,
  AgendaResult,
  CaptureOptions,
  CaptureTarget,
  EntryPatch,
  Flag,
  MoveTarget,
  Status,
} from './types.ts';

export function describeEffect(effect: AgendaEffect): string | null {
  switch (effect.kind) {
    case 'captured':
      return es.toast.captured(effect.status, effect.title);
    case 'alreadyInList':
      return es.palette.alreadyInList(effect.title, effect.status);
    case 'status':
      return es.toast.statusChanged(effect.title, effect.to);
    case 'flag':
      if (effect.flag === 'platinum' && effect.value && effect.autoCompleted) {
        return es.toast.platinumAuto;
      }
      return effect.value
        ? es.toast.flagOn(effect.flag, effect.title)
        : es.toast.flagOff(effect.flag, effect.title);
    case 'moved':
      return es.toast.moved(effect.title, effect.position, effect.total);
    case 'updated':
      return es.toast.updated(effect.field, effect.title);
    case 'removed':
      return es.toast.removed(effect.title);
    case 'linked':
      return es.toast.linked(effect.title);
    case 'noop':
      return null;
  }
}

/** Acciones de la agenda listas para la interfaz (con aviso, Deshacer y medidas). */
export interface Commands {
  capture(target: CaptureTarget, options?: CaptureOptions, timing?: FeedbackTiming): AgendaEffect;
  setStatus(id: string, status: Status, timing?: FeedbackTiming): AgendaEffect;
  setFlag(id: string, flag: Flag, value: boolean, timing?: FeedbackTiming): AgendaEffect;
  move(id: string, to: MoveTarget, timing?: FeedbackTiming): AgendaEffect;
  update(id: string, patch: EntryPatch, timing?: FeedbackTiming): AgendaEffect;
  remove(id: string, timing?: FeedbackTiming): AgendaEffect;
  link(manualId: string, target: CaptureTarget, timing?: FeedbackTiming): AgendaEffect;
}

export function useCommands(): Commands {
  const { agenda, notices } = useServices();
  return useMemo(() => {
    function run(result: AgendaResult, timing?: FeedbackTiming): AgendaEffect {
      const message = describeEffect(result.effect);
      if (message !== null) notices.notify(message, { undo: result.undo, timing });
      return result.effect;
    }
    return {
      capture: (target, options, timing) => run(agenda.capture(target, options), timing),
      setStatus: (id, status, timing) => run(agenda.setStatus(id, status), timing),
      setFlag: (id, flag, value, timing) => run(agenda.setFlag(id, flag, value), timing),
      move: (id, to, timing) => run(agenda.move(id, to), timing),
      update: (id, patch, timing) => run(agenda.update(id, patch), timing),
      remove: (id, timing) => run(agenda.remove(id), timing),
      link: (manualId, target, timing) => run(agenda.link(manualId, target), timing),
    };
  }, [agenda, notices]);
}
