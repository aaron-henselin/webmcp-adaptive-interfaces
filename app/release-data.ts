export const GENRES = [
  'Action', 'Adventure', 'RPG', 'Strategy', 'Simulation', 'Puzzle',
  'Racing', 'Horror', 'Cozy', 'Survival', 'Platformer', 'Sports',
] as const;

export type Genre = (typeof GENRES)[number];
export type ReleaseStatus = 'Upcoming' | 'Early access' | 'Announced';

export type Game = {
  id: number;
  title: string;
  releaseDate: string;
  genre: Genre;
  secondaryGenre: Genre;
  price: number | null;
  status: ReleaseStatus;
  studio: string;
  wishlists: number;
  accent: number;
};

const adjectives = [
  'Quiet', 'Iron', 'Glass', 'Neon', 'Hidden', 'Last', 'Golden', 'Hollow',
  'Electric', 'Wild', 'Paper', 'Midnight', 'Velvet', 'Frozen', 'Solar', 'Tiny',
  'Crimson', 'Forgotten', 'Bright', 'Secret', 'Parallel', 'Amber', 'Endless', 'Lunar',
];

const subjects = [
  'Harbor', 'Circuit', 'Garden', 'Relay', 'Cartographer', 'Bureau', 'Frontier', 'Signal',
  'Archive', 'Kingdom', 'Voyage', 'Workshop', 'Comet', 'Pilgrim', 'Engine', 'Keepers',
  'Tides', 'Orchard', 'Station', 'Paradox', 'Caravan', 'Ritual', 'Outpost', 'Lantern',
  'Drift', 'Covenant', 'Valley', 'Protocol', 'Machine', 'Constellation',
];

const forms = [
  '', ' Zero', ' Rising', ' Below', ' Beyond', ' Refracted', ' Unbound',
  ': Afterlight', ': Long Way Home', ': First Contact',
];

const studios = [
  'Mothlight Works', 'North Signal', 'Copper Finch', 'Orbital Kite', 'Soft Static',
  'Juniper Room', 'Daybreak Assembly', 'Pocket Current', 'Low Moon Labs', 'Good Weather',
  'Blue Hour Games', 'Velvet Hammer', 'Parallel Play', 'Hinterland House', 'Tin Can Studio',
];

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function titleFor(index: number) {
  const adjective = adjectives[index % adjectives.length];
  const subject = subjects[Math.floor(index / adjectives.length) % subjects.length];
  const form = forms[Math.floor(index / (adjectives.length * subjects.length)) % forms.length];
  return `${adjective} ${subject}${form}`;
}

export function generateGames(count = 4800): Game[] {
  const start = Date.UTC(2026, 7, 28);
  return Array.from({ length: count }, (_, index) => {
    const dayOffset = Math.floor(Math.pow(seeded(index, 2), 1.45) * 368);
    const date = new Date(start + dayOffset * 86_400_000);
    const genreIndex = Math.floor(seeded(index, 4) * GENRES.length);
    const secondaryIndex = (genreIndex + 1 + Math.floor(seeded(index, 6) * (GENRES.length - 1))) % GENRES.length;
    const free = seeded(index, 8) < 0.13;
    const priceSteps = [4.99, 9.99, 14.99, 19.99, 24.99, 29.99, 39.99, 49.99, 59.99, 69.99];
    const statusRoll = seeded(index, 10);

    return {
      id: 820000 + index,
      title: titleFor(index),
      releaseDate: date.toISOString().slice(0, 10),
      genre: GENRES[genreIndex],
      secondaryGenre: GENRES[secondaryIndex],
      price: free ? null : priceSteps[Math.floor(seeded(index, 12) * priceSteps.length)],
      status: statusRoll < 0.17 ? 'Early access' : statusRoll < 0.22 ? 'Announced' : 'Upcoming',
      studio: studios[Math.floor(seeded(index, 14) * studios.length)],
      wishlists: Math.floor(280 + Math.pow(seeded(index, 16), 2.5) * 128000),
      accent: Math.floor(seeded(index, 18) * 8),
    };
  });
}

export const GAMES = generateGames();

export function daysFromLaunch(date: string) {
  const baseline = Date.UTC(2026, 7, 27);
  return Math.ceil((new Date(`${date}T00:00:00Z`).getTime() - baseline) / 86_400_000);
}

export function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
}

export function formatPrice(price: number | null) {
  return price === null ? 'Free' : `$${price.toFixed(2)}`;
}
