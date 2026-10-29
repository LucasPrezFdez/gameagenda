// Zod compila sus validadores con `new Function` salvo en modo `jitless`. La CSP no admite
// `unsafe-eval` (ver §11.3): la prueba que hace Zod al construir un esquema se registraría como
// `securitypolicyviolation`. Este módulo va el primero del Worker, porque el esquema del
// *manifest* se construye al importar `@gameagenda/core/catalog-format`.
const scope = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
scope.__zod_globalConfig = { ...scope.__zod_globalConfig, jitless: true };

export {};
