import { describe, expect, it } from 'vitest';
import { parseRoute } from '../router/routes.ts';
import {
  DESKTOP_CAPTURE_EVENT,
  desktopCaptureTarget,
  onDesktopCapture,
} from './desktop-capture.ts';

describe('evento del atajo de la app de escritorio', () => {
  it('avisa con el timeStamp del evento y deja de escuchar al parar', () => {
    const target = new EventTarget();
    const calls: number[] = [];
    const stop = onDesktopCapture(target, (timeStamp) => calls.push(timeStamp));

    const event = new Event(DESKTOP_CAPTURE_EVENT);
    target.dispatchEvent(event);
    expect(calls).toEqual([event.timeStamp]);

    stop();
    target.dispatchEvent(new Event(DESKTOP_CAPTURE_EVENT));
    expect(calls).toHaveLength(1);
  });

  it('no atiende otros eventos', () => {
    const target = new EventTarget();
    let calls = 0;
    onDesktopCapture(target, () => {
      calls += 1;
    });
    target.dispatchEvent(new Event('gameagenda:otro'));
    target.dispatchEvent(new Event('capture'));
    expect(calls).toBe(0);
  });

  it('abre la paleta en Mi lista y en /apuntar; desde otra pantalla va a /apuntar', () => {
    expect(desktopCaptureTarget(parseRoute('/'))).toBe('here');
    expect(desktopCaptureTarget(parseRoute('/apuntar'))).toBe('here');
    expect(desktopCaptureTarget(parseRoute('/catalogo'))).toBe('/apuntar');
    expect(desktopCaptureTarget(parseRoute('/ajustes/datos'))).toBe('/apuntar');
    expect(desktopCaptureTarget(parseRoute('/juego/steam:730'))).toBe('/apuntar');
    expect(desktopCaptureTarget(parseRoute('/no-existe'))).toBe('/apuntar');
  });
});
