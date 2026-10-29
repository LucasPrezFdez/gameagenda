// Mini-catálogo para el cliente falso: juegos reales con su `appid`. El orden de las filas
// imita el rango estático del núcleo (ver §7.6); `pop` es aproximado.
import { GAME_FLAGS } from '../protocol.ts';

export interface SampleGame {
  readonly appid: number;
  readonly name: string;
  readonly nameEs: string | null;
  readonly year: number | null;
  readonly flags: number;
  readonly pop: number;
}

const { free, earlyAccess } = GAME_FLAGS;

function game(
  appid: number,
  name: string,
  year: number | null,
  pop: number,
  flags = 0,
  nameEs: string | null = null,
): SampleGame {
  return { appid, name, nameEs, year, flags, pop };
}

export const SAMPLE_GAMES: readonly SampleGame[] = [
  game(730, 'Counter-Strike 2', 2012, 46, free),
  game(570, 'Dota 2', 2013, 42, free),
  game(578080, 'PUBG: BATTLEGROUNDS', 2017, 41, free),
  game(105600, 'Terraria', 2011, 40),
  game(1245620, 'ELDEN RING', 2022, 39),
  game(271590, 'Grand Theft Auto V Legacy', 2015, 39),
  game(1086940, "Baldur's Gate 3", 2023, 38),
  game(413150, 'Stardew Valley', 2016, 38),
  game(1172470, 'Apex Legends™', 2020, 38, free),
  game(292030, 'The Witcher® 3: Wild Hunt', 2015, 38),
  game(1091500, 'Cyberpunk 2077', 2020, 38),
  game(440, 'Team Fortress 2', 2007, 38, free),
  game(1174180, 'Red Dead Redemption 2', 2019, 37),
  game(367520, 'Hollow Knight', 2017, 37),
  game(252490, 'Rust', 2018, 37),
  game(620, 'Portal 2', 2011, 37),
  game(553850, 'HELLDIVERS™ 2', 2024, 36),
  game(1145360, 'Hades', 2020, 36),
  game(374320, 'DARK SOULS™ III', 2016, 36),
  game(2358720, 'Black Myth: Wukong', 2024, 36),
  game(1623730, 'Palworld', 2024, 36, earlyAccess),
  game(1966720, 'Lethal Company', 2023, 36, earlyAccess),
  game(220, 'Half-Life 2', 2004, 35),
  game(1222670, 'The Sims™ 4', 2014, 35, free, 'Los Sims™ 4'),
  game(814380, 'Sekiro™: Shadows Die Twice', 2019, 35),
  game(646570, 'Slay the Spire', 2019, 35),
  game(1030300, 'Hollow Knight: Silksong', 2025, 35),
  game(1794680, 'Vampire Survivors', 2022, 35),
  game(1903340, 'Clair Obscur: Expedition 33', 2025, 34),
  game(504230, 'Celeste', 2018, 34),
  game(632470, 'Disco Elysium - The Final Cut', 2019, 34),
  game(268910, 'Cuphead', 2017, 34),
  game(1145350, 'Hades II', 2025, 33),
  game(2622380, 'ELDEN RING NIGHTREIGN', 2025, 33),
  game(949230, 'Cities: Skylines II', 2023, 33),
  game(753640, 'Outer Wilds', 2020, 33),
  game(1030840, 'Mafia: Definitive Edition', 2020, 32, 0, 'Mafia: Edición Definitiva'),
  game(228280, "Baldur's Gate: Enhanced Edition", 2013, 31),
  game(257350, "Baldur's Gate II: Enhanced Edition", 2013, 30),
  game(10, 'Counter-Strike', 2000, 30),
];

/** Alias compactos (ver §8.5); un alias admite varios `appid`. */
export const SAMPLE_ALIASES: Readonly<Record<string, readonly number[]>> = {
  bg3: [1086940],
  cs2: [730, 949230],
  csgo: [730],
  rdr2: [1174180],
  tw3: [292030],
  gta5: [271590],
  gtav: [271590],
  hk: [367520],
};
