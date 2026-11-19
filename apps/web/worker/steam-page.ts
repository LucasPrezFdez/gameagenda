// La página de la vuelta de Steam (`GET /api/v1/steam/callback`; ADR-012): la ve el usuario en la
// pestaña o el navegador donde ha iniciado sesión, que puede no ser el de la app (Safari, en la PWA
// de iOS; el navegador del sistema, en la app de escritorio). Por eso no lleva a ningún sitio: dice
// qué ha pasado y que vuelva a GameAgenda, que canjea el ticket por su cuenta. Sin *scripts* ni
// estilos (la CSP de la micro-API, `default-src 'none'`, no los deja) y solo con textos fijos.

export type SteamPageKind =
  | 'done'
  | 'cancelled'
  | 'invalid'
  | 'expired'
  | 'unavailable'
  | 'busy'
  | 'disabled';

const PAGES: Readonly<Record<SteamPageKind, { readonly title: string; readonly text: string }>> = {
  done: {
    title: 'Listo. Vuelve a GameAgenda',
    text: 'Ya has iniciado sesión con Steam. Vuelve a GameAgenda para terminar la importación. Puedes cerrar esta página.',
  },
  cancelled: {
    title: 'Has cancelado el inicio de sesión',
    text: 'No hemos traído nada de Steam. Si quieres intentarlo de nuevo, vuelve a GameAgenda y empieza otra vez.',
  },
  invalid: {
    title: 'No hemos podido comprobar el inicio de sesión',
    text: 'Steam no lo ha dado por bueno. Vuelve a GameAgenda y empieza otra vez.',
  },
  expired: {
    title: 'Este enlace ya no vale',
    text: 'Ha caducado o ya se ha usado. Vuelve a GameAgenda y empieza otra vez.',
  },
  unavailable: {
    title: 'Steam no responde',
    text: 'Recarga esta página dentro de un momento. Si sigue igual, vuelve a GameAgenda y empieza otra vez más tarde.',
  },
  busy: {
    title: 'Hoy ya no se puede importar más',
    text: 'Hemos llegado al máximo de consultas a Steam de hoy. Vuelve a GameAgenda y prueba mañana.',
  },
  disabled: {
    title: 'La importación de Steam no está disponible',
    text: 'Ahora mismo no se puede importar desde Steam. Vuelve a GameAgenda y prueba más tarde.',
  },
};

export function steamPageTitle(kind: SteamPageKind): string {
  return PAGES[kind].title;
}

/** HTML de la página: textos fijos, sin nada que venga de la petición. */
export function steamPage(kind: SteamPageKind): string {
  const { title, text } = PAGES[kind];
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${title} · GameAgenda</title>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${text}</p>
</main>
</body>
</html>
`;
}
