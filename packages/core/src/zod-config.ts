// Zod sin JIT: la CSP de la app (§11.3) no admite `unsafe-eval`, y Zod prueba `new Function` al
// validar el primer objeto; aunque atrapa el error, el navegador lo informa como violación de CSP
// (y los E2E fallan ante cualquiera). Lo importa todo módulo de core que define esquemas.
import * as z from 'zod';

z.config({ jitless: true });
