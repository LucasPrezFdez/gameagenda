// Formato publicado del catálogo (§7.6): núcleo, recientes y alias en TSV, detalles en *shards*,
// esquema del manifest y lo que hace falta para firmarlo y verificarlo.

export { canonicalJson } from './canonical.ts';
export { type Clock, type CooperativeTask, runToEnd } from './cooperative.ts';
export {
  DETAIL_SHARDS,
  DeckSupport,
  DetailPlatform,
  type DetailShard,
  type DetailsIndex,
  detailShardOf,
  detailShardPath,
  detailShardSchema,
  detailsIndexSchema,
  type GameDetails,
  type GameDetailsView,
  gameDetailsSchema,
  RELEASE_PRECISIONS,
  type ReleasePrecision,
  viewDetails,
} from './details.ts';
export {
  type CatalogFile,
  type CatalogManifest,
  catalogFileSchema,
  catalogManifestSchema,
} from './manifest.ts';
export { applyRecent } from './recent.ts';
export {
  CATALOG_SIGNING_KEYS,
  type CatalogSigningKey,
  fromBase64Url,
  manifestSigningBytes,
  toBase64Url,
  trustedSigningKeys,
} from './signature.ts';
export {
  type AliasList,
  type AliasPair,
  CatalogFlag,
  CatalogFormatError,
  type CoreCatalog,
  type CoreKind,
  type CoreRow,
  coreFromRows,
  coreRowAt,
  createCoreReader,
  isCatalogVersion,
  parseAliases,
  parseCore,
  serializeAliases,
  serializeCore,
} from './tsv.ts';
