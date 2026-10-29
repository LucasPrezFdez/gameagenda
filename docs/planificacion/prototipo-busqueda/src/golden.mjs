// Conjunto dorado de consultas en español (appid esperado; varios = cualquiera vale) y secuencias de tecleo.
export const GOLDEN = [
  // exactas y prefijos de títulos populares
  ['elden', [1245620], 'prefijo'], ['elden ring', [1245620], 'exacta'], ['hollow', [367520], 'prefijo'], ['hollow knight', [367520], 'exacta'],
  ['silksong', [1030300], 'palabra'], ['baldurs gate', [1086940], 'apóstrofo'], ['baldurs gate 3', [1086940], 'apóstrofo'], ["baldur's gate 3", [1086940], 'exacta'],
  ['counter strike', [730], 'puntuación'], ['counter-strike 2', [730], 'exacta'], ['witcher 3', [292030], 'artículo'], ['the witcher 3', [292030], 'exacta'],
  ['witcher', [292030], 'artículo'], ['hades', [1145360], 'exacta'], ['hades 2', [1145350], 'romanos'], ['stardew', [413150], 'prefijo'],
  ['cyberpunk', [1091500], 'prefijo'], ['2077', [1091500], 'número'], ['los sims 4', [1222670], 'español'], ['sims 4', [1222670], 'artículo'],
  ['los sims', [1222670], 'español'], ['skyrim', [489830], 'palabra'], ['fallout 4', [377160], 'exacta'], ['fallout new vegas', [22380], 'exacta'],
  ['portal', [400], 'exacta'], ['portal 2', [620], 'exacta'], ['half life 2', [220], 'puntuación'], ['halflife', [70, 220, 546560], 'compuesto'],
  ['left 4 dead 2', [550], 'exacta'], ['dota 2', [570], 'exacta'], ['team fortress 2', [440], 'exacta'], ['terraria', [105600], 'exacta'],
  ['rust', [252490], 'exacta'], ['dead by daylight', [381210], 'exacta'], ['among us', [945360], 'exacta'], ['apex', [1172470], 'prefijo'],
  ['pubg', [578080], 'prefijo'], ['destiny 2', [1085660], 'exacta'], ['warframe', [230410], 'exacta'], ['monster hunter world', [582010], 'puntuación'],
  ['monster hunter wilds', [2246340], 'exacta'], ['sekiro', [814380], 'prefijo'], ['dark souls 3', [374320], 'romanos'], ['dark souls iii', [374320], 'exacta'],
  ['resident evil 4', [2050650, 254700], 'exacta'], ['god of war', [1593500], 'exacta'], ['spiderman', [1817070, 1817190, 2651280], 'compuesto'],
  ['spider man', [1817070, 1817190, 2651280], 'puntuación'], ['assassins creed valhalla', [2208920], 'apóstrofo'], ['civilization 6', [289070], 'romanos'],
  ['age of empires 2', [813780], 'romanos'], ['euro truck', [227300], 'prefijo'], ['satisfactory', [526870], 'exacta'], ['valheim', [892970], 'exacta'],
  ['phasmophobia', [739630], 'exacta'], ['lethal company', [1966720], 'exacta'], ['palworld', [1623730], 'exacta'], ['helldivers 2', [553850], 'marca ™'],
  ['black myth wukong', [2358720], 'puntuación'], ['wukong', [2358720], 'palabra'], ['no mans sky', [275850], 'apóstrofo'], ['slay the spire', [646570], 'exacta'],
  ['garrys mod', [4000], 'apóstrofo'], ['dont starve together', [322330], 'apóstrofo'], ['five nights at freddys', [319510], 'apóstrofo'],
  ['kingdom come deliverance 2', [1771300], 'romanos'], ['persona 5 royal', [1687950], 'exacta'], ['stalker 2', [1643320], 'siglas con puntos'],
  ['nier automata', [524220], 'puntuación'], ['okami', [587620], 'diacríticos'], ['brutal legend', [225260], 'diacríticos'],
  ['mafia edicion definitiva', [1030840], 'nombre ES'], ['star wars jedi la orden caida', [1172380], 'nombre ES'], ['guardianes de la noche', [1490890], 'nombre ES'],
  ['the last of us parte i', [1888930], 'nombre ES'],
  // siglas y alias
  ['bg3', [1086940], 'sigla'], ['cs2', [730], 'sigla'], ['csgo', [730], 'alias'], ['rdr2', [1174180], 'sigla'], ['gta 5', [3240220], 'sigla'],
  ['gta v', [3240220], 'sigla'], ['ff7', [1462040, 2909400], 'alias'], ['dbd', [381210], 'sigla'], ['tf2', [440], 'sigla'], ['l4d2', [550], 'sigla'],
  ['ets2', [227300], 'sigla'], ['kcd2', [1771300], 'sigla'], ['p5r', [1687950], 'sigla'], ['nms', [275850], 'sigla'], ['civ 6', [289070], 'alias'],
  ['aoe2', [813780], 'alias'], ['re4', [2050650, 254700], 'alias'],
  // erratas (nivel difuso)
  ['witchr', [292030], 'errata'], ['cyberpnk', [1091500], 'errata'], ['hollow knigth', [367520], 'errata'], ['eldenring', [1245620], 'sin espacio'],
  ['stardew valey', [413150], 'errata'], ['palword', [1623730], 'errata'],
];
// sin resultado correcto en Steam: se espera que no haya coincidencias de nivel 0–1 (y se ofrezca el alta manual)
export const NEGATIVE = ['pokemon', 'pokémon', 'zelda', 'mario kart', 'fortnite', 'valorant'];

// consultas del borrador (25) + las pedidas para esta revisión + CJK
export const DRAFT_FINALS = ['elden ring', 'the witcher 3', 'cyberpunk 2077', 'hollow knight', "baldur's gate 3", 'counter-strike 2', 'grand theft auto v',
  'baldurs gate 3', 'counter strike 2', 'witchr', 'cyberpnk', 'hollow knigth', 'eldenring', '2077', 'gta', 'cs2', 'senorita', 'señorita',
  'espana', 'españa', 'deja vu', 'déjà vu', 'zelda', 'pokemon', 'pokémon'];
export const EXTRA_FINALS = ['baldurs gate', 'cs2', 'rdr2', 'gta 5', 'ff7', 'witcher 3', 'hades', 'elden', 'hollow', 'stardew', 'los sims 4', 'pokemon',
  'zelda', '2077', '1942', 'witchr', 'cyberpnk', '三国志', '東方', '勇者', 'ドラゴン', '전쟁'];
export const TARGETS = [['elden ring', [1245620]], ['the witcher 3', [292030]], ['cyberpunk 2077', [1091500]], ['hollow knight', [367520]],
  ["baldur's gate 3", [1086940]], ['counter-strike 2', [730]], ['grand theft auto v', [3240220]], ['hades', [1145360]], ['stardew valley', [413150]], ['los sims 4', [1222670]]];

export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// secuencias: cada consulta final tecleada carácter a carácter (sin repetir prefijos iguales tras normalizar)
export function typedSequences(finals, normalize) {
  const seqs = [];
  for (const f of finals) {
    const cps = Array.from(f); const seq = []; let prev = null;
    for (let i = 1; i <= cps.length; i++) { const raw = cps.slice(0, i).join(''); const n = normalize(raw); if (!n || n === prev) continue; prev = n; seq.push(raw); }
    seqs.push(seq);
  }
  return seqs;
}
// muestra realista: 50 populares (rango < 5 000), 50 intermedios (5 000–50 000) y 50 de la cola, hasta 25 caracteres
export function realisticFinals(games, seed = 20261028) {
  const rnd = mulberry32(seed); const N = games.length;
  const pick = (lo, hi, n) => { const s = new Set(); while (s.size < n) s.add(lo + Math.floor(rnd() * (hi - lo))); return [...s]; };
  const ids = [...pick(0, 5000, 50), ...pick(5000, 50000, 50), ...pick(50000, N, 50)];
  return ids.map((g) => Array.from(games[g].name).slice(0, 25).join(''));
}
