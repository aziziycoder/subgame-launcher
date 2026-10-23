export interface LauncherGame {
  id: string;
  slug: string;
  title: string;
  cardImage: string;
  cover: string;
  fallbackImage?: string;
  status: 'Tayyor' | 'Jarayonda' | 'Tez kunda';
  version: string;
  keyPrefix: string;
  developer: string;
  releaseYear: number;
  genres: string[];
  description: string;
  subtitleSize: string;
  price?: string;
  defaultExeName: string;
  targetFileName?: string;
  targetRelativeDir?: string;
  subtitleDownloadUrl?: string;
  isStandalone?: boolean;
  skipSubtitleInjection?: boolean;
}

export const LAUNCHER_GAMES: LauncherGame[] = [
  {
    id: 'a-plague-tale-requiem',
    slug: 'a-plague-tale-requiem',
    title: 'A Plague Tale: Requiem',
    cardImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1182900/header.jpg',
    fallbackImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1182900/header.jpg',
    cover: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1182900/library_600x900.jpg',
    status: 'Tayyor',
    version: 'v1.0.0',
    keyPrefix: 'SUB-REQU',
    developer: 'Asobo Studio',
    releaseYear: 2022,
    genres: ['Sarguzasht', 'Action', 'Stealth'],
    description: 'Vatanlaridan qochib qutulgan Amitsiya va Gyugoning yangi hayot va najot sari afsonaviy sarguzashti.',
    subtitleSize: '1.9 MB',
    defaultExeName: 'APlagueTaleRequiem_x64.exe',
    targetFileName: 'tt01.pc',
    targetRelativeDir: 'TRTEXT',
  },
  {
    id: 'a-plague-tale-innocence',
    slug: 'a-plague-tale-innocence',
    title: 'A Plague Tale: Innocence',
    cardImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/752590/header.jpg',
    fallbackImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/752590/header.jpg',
    cover: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/752590/library_600x900.jpg',
    status: 'Tayyor',
    version: 'v1.0.0',
    keyPrefix: 'SUB-INNO',
    developer: 'Asobo Studio',
    releaseYear: 2019,
    genres: ['Sarguzasht', 'Action', 'Stealth'],
    description: '1349-yil Fransiya. Amitsiya va Gyugoning vabo epidemiyasi va qora kalamushlar qurshovidagi ta\'sirli kurashi.',
    subtitleSize: '1.1 MB',
    defaultExeName: 'APlagueTaleInnocence_x64.exe',
    targetFileName: 'tt01.pc',
    targetRelativeDir: 'TRTEXT',
  },
  {
    id: 'outward-2',
    slug: 'outward-2',
    title: 'Outward 2',
    cardImage: 'https://www.subgame.uz/images/outward2/header.jpg',
    fallbackImage: 'https://sub-game.vercel.app/images/outward2/header.jpg',
    cover: 'https://www.subgame.uz/images/outward2/cover.jpg',
    status: 'Tayyor',
    version: 'v1.0.0',
    keyPrefix: 'SUB-OUTW',
    developer: 'Nine Dots Studio',
    releaseYear: 2026,
    genres: ['RPG', 'Omon qolish', 'Ochiq dunyo'],
    description: 'Murakkab va jozibali ochiq dunyo RPG o\'yini. Qahramon oddiy inson bo\'lib boshlanadigan realistik omon qolish sarguzashti.',
    subtitleSize: '1.5 MB',
    defaultExeName: 'otw2_ue.exe',
    targetFileName: 'otw2_ue-Windows_Uzbek_P.pak',
    targetRelativeDir: 'otw2_ue/Content/Paks',
  },
  {
    id: 'a-plague-tale-legacy',
    slug: 'a-plague-tale-legacy',
    title: 'A Plague Tale: Legacy',
    cardImage: 'https://www.subgame.uz/images/legacy/header.jpg',
    fallbackImage: 'https://sub-game.vercel.app/images/legacy/header.jpg',
    cover: 'https://www.subgame.uz/images/legacy/cover.jpg',
    status: 'Tez kunda',
    version: 'v1.0.0',
    keyPrefix: 'SUB-LEGA',
    developer: 'Asobo Studio',
    releaseYear: 2026,
    genres: ['Sarguzasht', 'Dramatik hikoya'],
    description: 'Afsonaviy Plague Tale olamining yangi bobidagi sir-asrorlar va kutilmagan voqealar rivoji.',
    subtitleSize: 'Tez kunda',
    defaultExeName: 'Game.exe',
  },
  {
    id: 'resident-evil-2-remake',
    slug: 'resident-evil-2-remake',
    title: 'Resident Evil 2 Remake',
    cardImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/883710/header.jpg',
    fallbackImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/883710/header.jpg',
    cover: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/883710/library_600x900.jpg',
    status: 'Jarayonda',
    version: 'v0.5.0',
    keyPrefix: 'SUB-RE2R',
    developer: 'Capcom',
    releaseYear: 2019,
    genres: ['Qo‘rqinchli', 'Omon qolish', 'Action'],
    description: 'Rakkun-Siti zombi falokati. Leon Kennedi va Kler Redfild dahshatli shaharda tirik qolish uchun kurashadi.',
    subtitleSize: '15 MB',
    defaultExeName: 're2.exe',
    targetFileName: 're_chunk_000.pak.patch_001.pak',
  },
  {
    id: 'level-devil',
    slug: 'level-devil',
    title: 'Level Devil',
    cardImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3242750/header.jpg',
    fallbackImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3242750/header.jpg',
    cover: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3242750/library_600x900.jpg',
    status: 'Tayyor',
    version: 'v1.0.0',
    keyPrefix: 'SUB-LDEV',
    developer: 'Unept',
    releaseYear: 2024,
    genres: ['Platformer', 'Troll', 'Qiyin'],
    description: 'Oddiy ko‘ringan, ammo asablarni qitiqlaydigan shafqatsiz va kulgili 2D platformer. To‘liq o‘zbek tilida tayyor!',
    subtitleSize: '1.5 MB',
    defaultExeName: 'Level Devil.exe',
    isStandalone: true,
    skipSubtitleInjection: true,
  },
  {
    id: 'stray',
    slug: 'stray',
    title: 'Stray',
    cardImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1332010/header.jpg',
    fallbackImage: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1332010/header.jpg',
    cover: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1332010/library_600x900.jpg',
    status: 'Jarayonda',
    version: 'v0.2.0',
    keyPrefix: 'SUB-STRA',
    developer: 'BlueTwelve Studio',
    releaseYear: 2022,
    genres: ['Sarguzasht', 'Kiberpank', 'Indie'],
    description: 'Unutilgan kiber-shaharda adashib qolgan mushukning uyga qaytish yo‘lidagi sirli va ta’sirli sarguzashti.',
    subtitleSize: '0.4 MB',
    defaultExeName: 'Stray.exe',
    targetFileName: 'Hk_project-WindowsNoEditor_Uzbek_P.pak',
    targetRelativeDir: 'Hk_project/Content/Paks',
  },
];
