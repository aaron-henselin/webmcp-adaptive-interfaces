export type SteamSpyGame = {
  id: number;
  title: string;
  developer: string;
  publisher: string;
  owners: string;
  ownersMin: number;
  ownersMax: number;
  priceCents: number;
  initialPriceCents: number;
  discountPercent: number;
  positive: number;
  negative: number;
  reviewCount: number;
  positiveRatio: number | null;
  ccu: number;
  averageForever: number;
  average2Weeks: number;
  medianForever: number;
  median2Weeks: number;
};

export type SteamSpySnapshot = {
  source: string;
  sourceUrl: string;
  request: string;
  snapshotDate: string;
  pageCount: number;
  recordCount: number;
  sourceFiles: Array<{
    page: number;
    filename: string;
    records: number;
    sha256: string;
  }>;
  contentPolicy: {
    version: number;
    excludedSexualContent: number;
  };
  games: SteamSpyGame[];
};

export const STEAMSPY_SNAPSHOT_URL = "/data/steamspy-snapshot.json";

let snapshotPromise: Promise<SteamSpySnapshot> | null = null;

export function loadSteamSpySnapshot() {
  snapshotPromise ??= fetch(STEAMSPY_SNAPSHOT_URL, { cache: "force-cache" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`SteamSpy snapshot request failed with status ${response.status}.`);
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || !Array.isArray((value as { games?: unknown }).games)) {
        throw new Error("SteamSpy snapshot response is invalid.");
      }
      return value as SteamSpySnapshot;
    })
    .catch((error) => {
      snapshotPromise = null;
      throw error;
    });
  return snapshotPromise;
}

export const PRICE_BANDS = [
  "Free",
  "Under $10",
  "$10–$29.99",
  "$30–$59.99",
  "$60+",
] as const;

export const REVIEW_BANDS = [
  "95%+ positive",
  "90–94% positive",
  "80–89% positive",
  "70–79% positive",
  "Below 70%",
  "No reviews",
] as const;

export function priceBand(game: SteamSpyGame) {
  if (game.priceCents === 0) return PRICE_BANDS[0];
  if (game.priceCents < 1_000) return PRICE_BANDS[1];
  if (game.priceCents < 3_000) return PRICE_BANDS[2];
  if (game.priceCents < 6_000) return PRICE_BANDS[3];
  return PRICE_BANDS[4];
}

export function reviewBand(game: SteamSpyGame) {
  if (game.positiveRatio === null) return REVIEW_BANDS[5];
  if (game.positiveRatio >= 0.95) return REVIEW_BANDS[0];
  if (game.positiveRatio >= 0.9) return REVIEW_BANDS[1];
  if (game.positiveRatio >= 0.8) return REVIEW_BANDS[2];
  if (game.positiveRatio >= 0.7) return REVIEW_BANDS[3];
  return REVIEW_BANDS[4];
}

export function activityBand(game: SteamSpyGame) {
  if (game.ccu >= 100_000) return "100K+ playing";
  if (game.ccu >= 10_000) return "10K–99K playing";
  if (game.ccu >= 1_000) return "1K–9.9K playing";
  if (game.ccu >= 100) return "100–999 playing";
  if (game.ccu > 0) return "Under 100 playing";
  return "No players reported";
}

export const OWNER_BANDS = [
  "100,000,000 .. 200,000,000",
  "50,000,000 .. 100,000,000",
  "20,000,000 .. 50,000,000",
  "10,000,000 .. 20,000,000",
  "5,000,000 .. 10,000,000",
  "2,000,000 .. 5,000,000",
  "1,000,000 .. 2,000,000",
  "500,000 .. 1,000,000",
  "200,000 .. 500,000",
  "100,000 .. 200,000",
  "50,000 .. 100,000",
  "20,000 .. 50,000",
] as const;

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCompact(value: number) {
  return compactNumber.format(value);
}

export function formatOwnerRange(game: Pick<SteamSpyGame, "ownersMin" | "ownersMax">) {
  return `${formatCompact(game.ownersMin)}–${formatCompact(game.ownersMax)}`;
}

export function formatPrice(cents: number) {
  if (cents === 0) return "Free";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function formatPercent(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPlaytime(minutes: number) {
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 6) / 10}h`;
}

export function formatSnapshotDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
