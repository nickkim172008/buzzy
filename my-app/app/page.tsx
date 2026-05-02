"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { firebaseConfigIsReady, getFirebaseAuth, getFirebaseDb, googleProvider } from "@/lib/firebase";

type MarketLevel = "admin" | "community" | "private";
type MarketStatus = "drop" | "trading";
type Side = "buy" | "sell";
type OrderStatus = "open" | "filled" | "partially_filled";
type AppTab = "markets" | "suggest" | "survey" | "create" | "drop" | "trading" | "portfolio" | "account";
type ChartRange = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";
type ChartMode = "value" | "returns";
type UserRole = "admin" | "user";
type NumericInput = number | "";

type Asset = {
  id: string;
  name: string;
  category: string;
  level: MarketLevel;
  volatility: number;
  lastPrice: number;
  previousPrice: number;
  volume: number;
  supply: number;
  description: string;
  signal: string;
  color: string;
  totalSupply: number;
  dropPrice: number;
  soldDropSupply: number;
  unsoldDropSupply: number;
  activeTradableSupply: number;
  remainingDropSupply: number;
  status: MarketStatus;
  source: "manual" | "scheduled_drop";
  createdAt: number;
};

type Order = {
  id: string;
  assetId: string;
  userId: string;
  user: string;
  ownerCoins: number;
  side: Side;
  limitPrice: number;
  quantity: number;
  remaining: number;
  status: OrderStatus;
  createdAt: number;
};

type Holding = {
  quantity: number;
  averagePrice: number;
};

type Trade = {
  id: string;
  assetId: string;
  buyerId: string;
  buyer: string;
  sellerId: string;
  seller: string;
  price: number;
  quantity: number;
  createdAt: number;
};

type PublicBalance = {
  coins: number;
  displayName: string;
  email: string;
};

type PublicHolding = {
  userId: string;
  marketId: string;
  quantity: number;
  averagePrice: number;
};

type Suggestion = {
  id: string;
  name: string;
  category: string;
  reason: string;
  color: string;
  suggestedBy: string;
  suggestedByName: string;
  upvotes: number;
  voters: Record<string, boolean>;
  createdAt: number;
};

type PortfolioSlice = {
  asset: Asset;
  quantity: number;
  value: number;
  percent: number;
};

type UpcomingDrop = {
  id: string;
  suggestionId: string;
  rank: number;
  title: string;
  category: string;
  color: string;
  votes: number;
  releaseAt: number;
  status: "Dropping next" | "Scheduled";
  limit: number;
  plannedSupply: number;
  price: number;
};

type MarketHistoryEvent =
  | "create"
  | "drop_buy"
  | "bulk_drop_buy"
  | "buy"
  | "sell"
  | "bulk_buy"
  | "bulk_sell"
  | "price_update"
  | "resolve";

type MarketHistoryPoint = {
  id: string;
  marketId: string;
  timestamp: number;
  price: number;
  volume: number;
  quantity: number;
  eventType: MarketHistoryEvent;
  transactionId?: string;
};

declare global {
  interface Window {
    buzzlyAddCoins?: (amount: number) => Promise<number>;
    buzzlySetCoins?: (amount: number) => Promise<number>;
  }
}

const levelCopy: Record<
  MarketLevel,
  { label: string; badge: string }
> = {
  admin: {
    label: "Admin Approved",
    badge: "Stable",
  },
  community: {
    label: "Community Verified",
    badge: "Voted",
  },
  private: {
    label: "Private",
    badge: "Custom",
  },
};

const STARTING_COINS = 0;
const ADMIN_EMAIL = "nutakkiabhiram@gmail.com";
const DROP_PURCHASE_LIMIT_PERCENT = 0.05;
const DROP_BATCH_SIZE = 3;
const DROP_CYCLE_MS = 60 * 1000;
const SCHEDULED_DROP_PRICE = 10;
const SCHEDULED_DROP_SUPPLY = 100;
const chartRanges: ChartRange[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "ALL"];

const tabs: { id: AppTab; label: string; mark: string }[] = [
  { id: "markets", label: "Markets", mark: "M" },
  { id: "suggest", label: "Suggest", mark: "S" },
  { id: "survey", label: "Vote", mark: "V" },
  { id: "create", label: "Create", mark: "+" },
  { id: "drop", label: "Drop", mark: "D" },
  { id: "trading", label: "Trade", mark: "T" },
  { id: "portfolio", label: "Portfolio", mark: "P" },
  { id: "account", label: "Account", mark: "A" },
];

function TabIcon({ id }: { id: AppTab }) {
  const iconProps = {
    className: "h-5 w-5",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (id === "markets") {
    return (
      <svg {...iconProps}>
        <path d="M4 17L9 12L13 15L20 7" />
        <path d="M4 20H20" />
      </svg>
    );
  }

  if (id === "suggest") {
    return (
      <svg {...iconProps}>
        <path d="M12 3L14.4 8.6L20 11L14.4 13.4L12 19L9.6 13.4L4 11L9.6 8.6L12 3Z" />
      </svg>
    );
  }

  if (id === "survey") {
    return (
      <svg {...iconProps}>
        <path d="M5 5H19" />
        <path d="M7 12H17" />
        <path d="M9 19H15" />
      </svg>
    );
  }

  if (id === "create") {
    return (
      <svg {...iconProps}>
        <path d="M12 5V19" />
        <path d="M5 12H19" />
      </svg>
    );
  }

  if (id === "drop") {
    return (
      <svg {...iconProps}>
        <path d="M12 3V14" />
        <path d="M7 9L12 14L17 9" />
        <path d="M5 20H19" />
      </svg>
    );
  }

  if (id === "trading") {
    return (
      <svg {...iconProps}>
        <path d="M7 7H19L15 3" />
        <path d="M17 17H5L9 21" />
      </svg>
    );
  }

  if (id === "portfolio") {
    return (
      <svg {...iconProps}>
        <path d="M4 7H20V19H4Z" />
        <path d="M8 7V5H16V7" />
        <path d="M8 14H16" />
      </svg>
    );
  }

  return (
    <svg {...iconProps}>
      <path d="M12 12A4 4 0 1 0 12 4A4 4 0 0 0 12 12Z" />
      <path d="M4 21C5.4 17.5 8.3 16 12 16C15.7 16 18.6 17.5 20 21" />
    </svg>
  );
}

function timestampMillis(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  return 0;
}

function currency(value: number) {
  return `${Math.round(value).toLocaleString()} coins`;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatVolatility(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function dropPurchaseLimit(asset: Pick<Asset, "totalSupply">) {
  return Math.max(1, Math.floor(asset.totalSupply * DROP_PURCHASE_LIMIT_PERCENT));
}

function numericInputValue(value: NumericInput, fallback = 0) {
  return value === "" ? fallback : value;
}

function plannedDropSupply() {
  return SCHEDULED_DROP_SUPPLY;
}

function plannedDropPrice() {
  return SCHEDULED_DROP_PRICE;
}

function nextHourlyDropTime(timestamp: number) {
  return Math.floor(timestamp / DROP_CYCLE_MS) * DROP_CYCLE_MS + DROP_CYCLE_MS;
}

function formatClock(ms: number) {
  const safeMs = Math.max(0, ms);
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);

  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatShortDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function rangeStart(range: ChartRange, now: number) {
  if (range === "ALL") return 0;
  if (range === "1D") return now - 86_400_000;
  if (range === "1W") return now - 7 * 86_400_000;
  if (range === "1M") return now - 30 * 86_400_000;
  if (range === "3M") return now - 90 * 86_400_000;
  if (range === "6M") return now - 180 * 86_400_000;
  if (range === "YTD") return new Date(new Date(now).getFullYear(), 0, 1).getTime();
  if (range === "1Y") return now - 365 * 86_400_000;

  return now - 540 * 86_400_000;
}

function formatChartTick(timestamp: number, range: ChartRange) {
  if (range === "1D") {
    return new Intl.DateTimeFormat("en", { hour: "numeric" }).format(new Date(timestamp));
  }

  if (range === "1W" || range === "1M") {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(timestamp));
  }

  return new Intl.DateTimeFormat("en", { month: "short", year: "2-digit" }).format(new Date(timestamp));
}

function eventLabel(eventType: MarketHistoryEvent) {
  return eventType.replaceAll("_", " ");
}

function dedupeHistoryPoints(points: MarketHistoryPoint[]) {
  return points
    .sort((a, b) => a.timestamp - b.timestamp)
    .filter((point, index, sorted) => {
      const previous = sorted[index - 1];

      return !previous ||
        previous.marketId !== point.marketId ||
        previous.timestamp !== point.timestamp ||
        previous.price !== point.price ||
        previous.volume !== point.volume ||
        previous.quantity !== point.quantity ||
        previous.eventType !== point.eventType ||
        previous.transactionId !== point.transactionId;
    });
}

function fallbackHistoryFromTrades(asset: Asset, assetTrades: Trade[]) {
  const createdPoint: MarketHistoryPoint = {
    id: `${asset.id}-created`,
    marketId: asset.id,
    timestamp: asset.createdAt || 0,
    price: asset.dropPrice || asset.previousPrice || asset.lastPrice,
    volume: 0,
    quantity: 0,
    eventType: "create",
  };
  const tradePoints = assetTrades.map((trade) => ({
    id: `trade-${trade.id}`,
    marketId: trade.assetId,
    timestamp: trade.createdAt,
    price: trade.price,
    volume: trade.price * trade.quantity,
    quantity: trade.quantity,
    eventType: "price_update" as MarketHistoryEvent,
    transactionId: trade.id,
  }));

  return [createdPoint, ...tradePoints].filter((point) => point.timestamp > 0 && point.price > 0);
}

function buildChartPoints(asset: Asset, historyPoints: MarketHistoryPoint[], assetTrades: Trade[], range: ChartRange, now: number) {
  const start = rangeStart(range, now);
  const sourcePoints = historyPoints.length ? historyPoints : fallbackHistoryFromTrades(asset, assetTrades);

  return dedupeHistoryPoints(sourcePoints)
    .filter((point) => point.timestamp >= start && point.timestamp <= now)
    .map((point) => ({
      ...point,
      value: point.price,
    }));
}

function pointsToPath(points: { x: number; y: number }[]) {
  if (!points.length) return "";

  return points
    .map((point, index) => {
      if (index === 0) {
        return `M ${point.x} ${point.y}`;
      }

      return `L ${point.x} ${point.y}`;
    })
    .join(" ");
}

function MarketLineChart({
  asset,
  history,
  trades,
  range,
  mode,
  now,
  onRangeChange,
  onModeChange,
}: {
  asset: Asset;
  history: MarketHistoryPoint[];
  trades: Trade[];
  range: ChartRange;
  mode: ChartMode;
  now: number;
  onRangeChange: (range: ChartRange) => void;
  onModeChange: (mode: ChartMode) => void;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const rawPoints = buildChartPoints(asset, history, trades, range, now);
  const firstValue = rawPoints[0]?.value ?? asset.lastPrice;
  const chartValues = rawPoints.map((point) => ({
    ...point,
    value: mode === "returns" ? ((point.value - firstValue) / Math.max(1, firstValue)) * 100 : point.value,
  }));
  const values = chartValues.map((point) => point.value);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 1;
  const valueRange = Math.max(1, maxValue - minValue);
  const width = 720;
  const height = 260;
  const padding = 22;
  const minTime = rawPoints[0]?.timestamp ?? rangeStart(range, now);
  const maxTime = rawPoints.at(-1)?.timestamp ?? now;
  const timeRange = Math.max(1, maxTime - minTime);
  const svgPoints = chartValues.map((point) => ({
    x: padding + ((point.timestamp - minTime) / timeRange) * (width - padding * 2),
    y: padding + (1 - (point.value - minValue) / valueRange) * (height - padding * 2),
  }));
  const path = pointsToPath(svgPoints);
  const areaPath = `${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`;
  const activeIndex = hoverIndex ?? chartValues.length - 1;
  const activePoint = chartValues[activeIndex];
  const activeSvgPoint = svgPoints[activeIndex];
  const dailyGain = rawPoints.length > 1 ? rawPoints[rawPoints.length - 1].value - rawPoints[0].value : 0;
  const dailyReturn = rawPoints.length > 1 ? (dailyGain / Math.max(1, rawPoints[0].value)) * 100 : 0;
  const activePrevious = activeIndex > 0 ? rawPoints[activeIndex - 1] : undefined;
  const pointChange = activePoint && activePrevious ? activePoint.price - activePrevious.price : 0;
  const displayValue = activePoint
    ? mode === "returns" ? `${activePoint.value.toFixed(2)}%` : currency(activePoint.price)
    : "No data";
  const ticks = Array.from({ length: 4 }, (_, index) => minTime + (index / 3) * timeRange);

  return (
    <div className="rounded-[2rem] border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Market value</p>
          <p className="mt-2 text-4xl font-black">{currency(rawPoints[rawPoints.length - 1]?.value ?? asset.lastPrice)}</p>
          <p className={`mt-1 text-sm font-bold ${dailyGain >= 0 ? "text-positive" : "text-danger"}`}>
            {dailyGain >= 0 ? "+" : ""}
            {currency(dailyGain)} today ({formatPercent(dailyReturn)})
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-2xl bg-surface-warm p-1">
            {(["value", "returns"] as ChartMode[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onModeChange(option)}
                className={`rounded-xl px-3 py-2 text-xs font-black capitalize transition ${
                  mode === option ? "bg-brand shadow-card" : "text-muted"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap rounded-2xl bg-surface-warm p-1">
            {chartRanges.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onRangeChange(option)}
                className={`rounded-xl px-2.5 py-2 text-xs font-black transition ${
                  range === option ? "bg-foreground text-white shadow-card" : "text-muted"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-3xl border border-border bg-background p-3">
        {rawPoints.length ? (
          <>
        <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-72 w-full touch-none overflow-visible"
            onPointerLeave={() => setHoverIndex(null)}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const pointerTime = minTime + Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * timeRange;
              const nextIndex = rawPoints.reduce((closestIndex, point, index) => {
                const closestDistance = Math.abs(rawPoints[closestIndex].timestamp - pointerTime);
                const pointDistance = Math.abs(point.timestamp - pointerTime);

                return pointDistance < closestDistance ? index : closestIndex;
              }, 0);

              setHoverIndex(nextIndex);
            }}
          >
          <defs>
            <linearGradient id="tradeLineGradient" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#171612" />
              <stop offset="45%" stopColor="#168a4a" />
              <stop offset="100%" stopColor="#f6c945" />
            </linearGradient>
            <linearGradient id="tradeAreaGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#f6c945" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#f6c945" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((line) => (
            <line
              key={line}
              x1={padding}
              x2={width - padding}
              y1={padding + line * ((height - padding * 2) / 3)}
              y2={padding + line * ((height - padding * 2) / 3)}
              stroke="#e6ded0"
              strokeDasharray="4 8"
            />
          ))}
          {rawPoints.length > 1 ? <path d={areaPath} fill="url(#tradeAreaGradient)" /> : null}
          <path d={path} fill="none" stroke="url(#tradeLineGradient)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
          {activePoint && activeSvgPoint ? (
            <>
              <line x1={activeSvgPoint.x} x2={activeSvgPoint.x} y1={padding} y2={height - padding} stroke="#171612" strokeOpacity="0.16" />
              <circle cx={activeSvgPoint.x} cy={activeSvgPoint.y} r="7" fill="#fffdfa" stroke="#171612" strokeWidth="3" />
              <foreignObject x={Math.min(width - 230, Math.max(12, activeSvgPoint.x - 105))} y={Math.max(10, activeSvgPoint.y - 94)} width="218" height="82">
                <div className="rounded-2xl border border-border bg-surface px-3 py-2 text-xs shadow-card">
                  <p className="font-black">{displayValue}</p>
                  <p className={`mt-1 font-bold ${pointChange >= 0 ? "text-positive" : "text-danger"}`}>
                    {pointChange >= 0 ? "+" : ""}
                    {currency(pointChange)}
                  </p>
                  <p className="mt-1 capitalize text-muted">{formatShortDate(activePoint.timestamp)} · {eventLabel(activePoint.eventType)}</p>
                </div>
              </foreignObject>
            </>
          ) : null}
        </svg>
        <div className="grid grid-cols-4 gap-2 px-2 text-xs font-bold text-quiet">
          {ticks.map((tick) => (
            <span key={tick}>{formatChartTick(tick, range)}</span>
          ))}
        </div>
        {rawPoints.length < 2 ? (
          <p className="mt-3 rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">
            Only one real history point exists in this range. The chart will draw movement as new trades arrive.
          </p>
        ) : null}
          </>
        ) : (
          <p className="rounded-2xl bg-surface-warm px-4 py-12 text-center text-sm font-bold text-muted">
            No real price history exists for this market in the selected range.
          </p>
        )}
      </div>
    </div>
  );
}

function PortfolioDonut({ slices }: { slices: PortfolioSlice[] }) {
  let offset = 0;
  const totalValue = slices.reduce((sum, slice) => sum + slice.value, 0);
  const gradient = slices.length
    ? slices
        .map((slice) => {
          const start = offset;
          const end = offset + slice.percent;
          offset = end;

          return `${slice.asset.color} ${start}% ${end}%`;
        })
        .join(", ")
    : "#e6ded0 0% 100%";

  return (
    <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
        <div
          className="grid aspect-square w-full max-w-64 place-items-center rounded-full"
          style={{ background: `conic-gradient(${gradient})` }}
        >
          <div className="grid h-[58%] w-[58%] place-items-center rounded-full bg-surface text-center shadow-card">
            <span>
              <span className="block text-xs font-bold uppercase tracking-[0.12em] text-muted">Total</span>
              <span className="block text-xl font-black">{currency(totalValue)}</span>
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-2xl font-black">Portfolio Breakdown</h2>
            <p className="mt-1 text-sm text-muted">Owned value across markets.</p>
          </div>
          {slices.length ? slices.map((slice) => (
            <div key={slice.asset.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl bg-surface-warm p-3">
              <span className="h-3 w-3 rounded-full" style={{ background: slice.asset.color }} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{slice.asset.name}</span>
                <span className="block text-xs text-muted">{slice.percent.toFixed(1)}% owned</span>
              </span>
              <span className="text-right text-sm font-black">{currency(slice.value)}</span>
            </div>
          )) : (
            <p className="rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">No holdings to visualize yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DropTimerBadge({
  nextDropTime,
  now,
  scheduledCount,
}: {
  nextDropTime: number;
  now: number;
  scheduledCount: number;
}) {
  const remainingMs = Math.max(0, nextDropTime - now);
  const isFinalCountdown = remainingMs > 0 && remainingMs <= 4_000;

  return (
    <button
      type="button"
      className={`w-full rounded-2xl border bg-surface px-4 py-3 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lift sm:w-auto ${
        isFinalCountdown ? "drop-timer-shake border-danger" : "border-brand/70"
      }`}
      title="Drop Timer"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={`text-xs font-black uppercase tracking-[0.14em] ${isFinalCountdown ? "text-danger" : "text-muted"}`}>
            {isFinalCountdown ? "Dropping" : "Drop Timer"}
          </p>
          <p className={`mt-1 font-mono text-2xl font-black ${isFinalCountdown ? "text-danger" : "text-foreground"}`}>
            {formatClock(remainingMs)}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-black ${
          isFinalCountdown ? "bg-danger text-white" : "bg-brand text-foreground"
        }`}>
          {scheduledCount}/{DROP_BATCH_SIZE}
        </span>
      </div>
    </button>
  );
}

function DropTimingCard({
  drop,
  now,
  canRemove,
  onRemove,
}: {
  drop: UpcomingDrop;
  now: number;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const remainingMs = drop.releaseAt - now;

  return (
    <div className="group relative rounded-[2rem] border border-border bg-surface p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand hover:shadow-lift">
      {canRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-sm font-black text-muted opacity-0 shadow-card transition hover:border-danger hover:text-danger group-hover:opacity-100"
          aria-label={`Remove ${drop.title} from this drop cycle`}
          title="Remove from this drop cycle"
        >
          X
        </button>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 pr-9">
            <span className="h-6 w-6 shrink-0 rounded-xl border border-border" style={{ background: drop.color }} />
            <span className="rounded-full bg-brand px-2 py-1 text-xs font-black text-foreground">#{drop.rank}</span>
            <p className="truncate text-xl font-black">{drop.title}</p>
          </div>
          <p className="mt-2 text-sm font-bold text-muted">{drop.category}</p>
        </div>
        <span className="mt-9 shrink-0 rounded-full bg-foreground px-3 py-1 text-xs font-black text-white sm:mt-0">
          {drop.status}
        </span>
      </div>
      <div className="mt-5 rounded-3xl bg-foreground p-4 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">Drop unlocks in</p>
        <p className="mt-2 font-mono text-2xl font-black">{formatClock(remainingMs)}</p>
      </div>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-2xl bg-surface-warm p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-quiet">Votes</p>
          <p className="mt-1 font-bold">{drop.votes}</p>
        </div>
        <div className="rounded-2xl bg-surface-warm p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-quiet">Scheduled</p>
          <p className="mt-1 font-bold">{formatShortDate(drop.releaseAt)}</p>
        </div>
        <div className="rounded-2xl bg-surface-warm p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-quiet">Planned supply</p>
          <p className="mt-1 font-bold">{drop.plannedSupply}</p>
        </div>
        <div className="rounded-2xl bg-surface-warm p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-quiet">Purchase limit</p>
          <p className="mt-1 font-bold">{drop.limit} per user</p>
        </div>
      </div>
    </div>
  );
}

function calculateVolatility(prices: number[]) {
  const cleanPrices = prices.filter((price) => price > 0).slice(-20);

  if (cleanPrices.length < 2) {
    return 0;
  }

  const returns = cleanPrices.slice(1).map((price, index) => price / cleanPrices[index] - 1);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;

  return Math.sqrt(variance);
}

function getOrderBook(orders: Order[], assetId: string, side: Side) {
  return orders
    .filter((order) => order.assetId === assetId && order.side === side && order.remaining > 0)
    .sort((a, b) => {
      if (side === "buy") {
        return b.limitPrice - a.limitPrice || a.createdAt - b.createdAt;
      }

      return a.limitPrice - b.limitPrice || a.createdAt - b.createdAt;
    });
}

function applyTradeToHolding(holding: Holding | undefined, quantity: number, price: number) {
  const current = holding ?? { quantity: 0, averagePrice: 0 };
  const nextQuantity = current.quantity + quantity;

  if (nextQuantity <= 0) {
    return { quantity: 0, averagePrice: 0 };
  }

  return {
    quantity: nextQuantity,
    averagePrice:
      (current.quantity * current.averagePrice + quantity * price) / nextQuantity,
  };
}

function userLabel(user: User) {
  return user.displayName?.trim() || user.email?.split("@")[0] || "You";
}

function userRole(user: User | null): UserRole {
  return user?.email?.toLowerCase() === ADMIN_EMAIL ? "admin" : "user";
}

function AuthScreen({
  authReady,
  authError,
  onSignIn,
}: {
  authReady: boolean;
  authError: string;
  onSignIn: () => void;
}) {
  const configMissing = authReady && !firebaseConfigIsReady;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto grid min-h-screen max-w-7xl items-center gap-8 px-5 py-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <Image src="/beelogo.png" alt="Buzzy logo" width={64} height={64} className="h-16 w-16 rounded-[1.25rem] object-cover shadow-card" />
          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-muted">Buzzy accounts</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-normal text-foreground md:text-6xl">
            Sign in.
          </h1>
        </div>

        <div className="rounded-[1.75rem] border border-border bg-surface p-5 shadow-card md:p-6">
          <div className="rounded-[1.25rem] bg-brand p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">Account access</p>
            <h2 className="mt-2 text-2xl font-bold">Continue with Google</h2>
          </div>

          <button
            onClick={onSignIn}
            disabled={!authReady || configMissing}
            className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-foreground px-4 py-3 font-bold text-white shadow-card transition hover:-translate-y-0.5 disabled:bg-quiet"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-brand text-sm font-bold text-foreground">
              G
            </span>
            {authReady ? "Sign in with Google" : "Loading Firebase"}
          </button>

          {configMissing ? (
            <div className="mt-4 rounded-2xl bg-surface-warm p-3 text-sm font-semibold leading-6 text-foreground">
              Firebase is not configured yet. Add your project values to `.env.local`, then restart the dev server.
            </div>
          ) : null}

          {authError ? (
            <div className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-semibold leading-6 text-danger">
              {authError}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!firebaseConfigIsReady);
  const [authError, setAuthError] = useState("");
  const [coinsReady, setCoinsReady] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [marketHistory, setMarketHistory] = useState<MarketHistoryPoint[]>([]);
  const [holdings, setHoldings] = useState<Record<string, Holding>>({});
  const [publicBalances, setPublicBalances] = useState<Record<string, PublicBalance>>({});
  const [publicHoldings, setPublicHoldings] = useState<Record<string, Holding>>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [savedUserCoins, setSavedUserCoins] = useState<number | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [side, setSide] = useState<Side>("buy");
  const [quantity, setQuantity] = useState<NumericInput>(1);
  const [limitPrice, setLimitPrice] = useState<NumericInput>(1);
  const [coins, setCoins] = useState(STARTING_COINS);
  const [notice, setNotice] = useState("Ready.");
  const [marketName, setMarketName] = useState("");
  const [marketCategory, setMarketCategory] = useState("");
  const [marketLevel, setMarketLevel] = useState<MarketLevel>("community");
  const [marketPrice, setMarketPrice] = useState<NumericInput>(1);
  const [marketSupply, setMarketSupply] = useState<NumericInput>(1000);
  const [marketColor, setMarketColor] = useState("#facc15");
  const [suggestionName, setSuggestionName] = useState("");
  const [suggestionCategory, setSuggestionCategory] = useState("Event");
  const [suggestionReason, setSuggestionReason] = useState("");
  const [suggestionColor, setSuggestionColor] = useState("#facc15");
  const [surveySearch, setSurveySearch] = useState("");
  const [marketSearch, setMarketSearch] = useState("");
  const [dropSearch, setDropSearch] = useState("");
  const [tradeSearch, setTradeSearch] = useState("");
  const [dropQuantity, setDropQuantity] = useState<NumericInput>(1);
  const [activeTab, setActiveTab] = useState<AppTab>("markets");
  const [chartRange, setChartRange] = useState<ChartRange>("1M");
  const [chartMode, setChartMode] = useState<ChartMode>("value");
  const [now, setNow] = useState(() => Date.now());
  const [nextDropTime, setNextDropTime] = useState(() => nextHourlyDropTime(Date.now()));
  const [skippedDropSuggestionIds, setSkippedDropSuggestionIds] = useState<string[]>([]);
  const [processingDropCycle, setProcessingDropCycle] = useState(false);
  const accountName = authUser ? userLabel(authUser) : "You";
  const currentUser = authUser
    ? { id: authUser.uid, email: authUser.email ?? "", role: userRole(authUser) }
    : { id: "", email: "", role: "user" as UserRole };
  const isAdmin = currentUser.role === "admin";
  const visibleTabs = tabs.filter((tab) => isAdmin || tab.id !== "create");

  useEffect(() => {
    const auth = getFirebaseAuth();

    if (!auth) {
      return;
    }

    return onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setCoinsReady(false);
      setSavedUserCoins(null);
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab !== "create" || isAdmin) {
      return;
    }

    setActiveTab("markets");
    setNotice("Not authorized.");
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      return;
    }

    const userRef = doc(db, "users", authUser.uid);

    return onSnapshot(
      userRef,
      async (snapshot) => {
        if (!snapshot.exists()) {
          await setDoc(userRef, {
            coins: STARTING_COINS,
            displayName: authUser.displayName ?? "",
            email: authUser.email ?? "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await setDoc(doc(db, "balances", authUser.uid), {
            coins: STARTING_COINS,
            displayName: authUser.displayName ?? "",
            email: authUser.email ?? "",
            updatedAt: serverTimestamp(),
          });
          return;
        }

        const savedCoins = snapshot.data().coins;
        setSavedUserCoins(typeof savedCoins === "number" ? savedCoins : STARTING_COINS);
        setCoinsReady(true);
      },
      (error) => {
        setAuthError(error.message);
        setCoinsReady(true);
      },
    );
  }, [authUser]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      return;
    }

    const unsubscribeMarkets = onSnapshot(
      query(collection(db, "markets"), orderBy("createdAt", "desc")),
      (snapshot) => {
        const nextAssets = snapshot.docs.map((marketDoc) => {
          const data = marketDoc.data();

          return {
            id: marketDoc.id,
            name: typeof data.name === "string" ? data.name : "",
            category: typeof data.category === "string" ? data.category : "",
            level: ["admin", "community", "private"].includes(data.level) ? data.level : "community",
            volatility: typeof data.volatility === "number" ? data.volatility : 0,
            lastPrice: typeof data.lastPrice === "number" ? data.lastPrice : 1,
            previousPrice: typeof data.previousPrice === "number" ? data.previousPrice : 1,
            volume: typeof data.volume === "number" ? data.volume : 0,
            supply: typeof data.supply === "number" ? data.supply : 0,
            description: typeof data.description === "string" ? data.description : "",
            signal: typeof data.signal === "string" ? data.signal : "",
            color: typeof data.color === "string" ? data.color : "#facc15",
            totalSupply: typeof data.totalSupply === "number" ? data.totalSupply : 0,
            dropPrice: typeof data.dropPrice === "number" ? data.dropPrice : 1,
            soldDropSupply: typeof data.soldDropSupply === "number"
              ? data.soldDropSupply
              : Math.max(
                  0,
                  (typeof data.totalSupply === "number" ? data.totalSupply : 0) -
                    (typeof data.remainingDropSupply === "number" ? data.remainingDropSupply : 0),
                ),
            unsoldDropSupply: typeof data.unsoldDropSupply === "number"
              ? data.unsoldDropSupply
              : Math.max(0, typeof data.remainingDropSupply === "number" ? data.remainingDropSupply : 0),
            activeTradableSupply: typeof data.activeTradableSupply === "number"
              ? data.activeTradableSupply
              : Math.max(
                  0,
                  (typeof data.totalSupply === "number" ? data.totalSupply : 0) -
                    (typeof data.remainingDropSupply === "number" ? data.remainingDropSupply : 0),
                ),
            remainingDropSupply: typeof data.remainingDropSupply === "number" ? data.remainingDropSupply : 0,
            status: data.status === "trading" ? "trading" : "drop",
            source: data.source === "scheduled_drop" ? "scheduled_drop" : "manual",
            createdAt: timestampMillis(data.createdAt),
          } satisfies Asset;
        });

        setAssets(nextAssets);
        setSelectedAssetId((current) => current || nextAssets[0]?.id || "");
      },
      (error) => setNotice(error.message),
    );

    const unsubscribeOrders = onSnapshot(
      query(collection(db, "orders"), orderBy("createdAt", "asc")),
      (snapshot) => {
        setOrders(snapshot.docs.map((orderDoc) => {
          const data = orderDoc.data();

          return {
            id: orderDoc.id,
            assetId: typeof data.assetId === "string" ? data.assetId : "",
            userId: typeof data.userId === "string" ? data.userId : "",
            user: typeof data.user === "string" ? data.user : "",
            ownerCoins: typeof data.ownerCoins === "number" ? data.ownerCoins : 0,
            side: data.side === "sell" ? "sell" : "buy",
            limitPrice: typeof data.limitPrice === "number" ? data.limitPrice : 1,
            quantity: typeof data.quantity === "number" ? data.quantity : 0,
            remaining: typeof data.remaining === "number" ? data.remaining : 0,
            status: ["open", "filled", "partially_filled"].includes(data.status) ? data.status : "open",
            createdAt: timestampMillis(data.createdAt),
          } satisfies Order;
        }));
      },
      (error) => setNotice(error.message),
    );

    const unsubscribeTrades = onSnapshot(
      query(collection(db, "trades"), orderBy("createdAt", "desc")),
      (snapshot) => {
        setTrades(snapshot.docs.map((tradeDoc) => {
          const data = tradeDoc.data();

          return {
            id: tradeDoc.id,
            assetId: typeof data.assetId === "string" ? data.assetId : "",
            buyerId: typeof data.buyerId === "string" ? data.buyerId : "",
            buyer: typeof data.buyer === "string" ? data.buyer : "",
            sellerId: typeof data.sellerId === "string" ? data.sellerId : "",
            seller: typeof data.seller === "string" ? data.seller : "",
            price: typeof data.price === "number" ? data.price : 0,
            quantity: typeof data.quantity === "number" ? data.quantity : 0,
            createdAt: timestampMillis(data.createdAt),
          } satisfies Trade;
        }));
      },
      (error) => setNotice(error.message),
    );

    const unsubscribeMarketHistory = onSnapshot(
      query(collection(db, "marketHistory"), orderBy("timestamp", "asc")),
      (snapshot) => {
        setMarketHistory(snapshot.docs.map((historyDoc) => {
          const data = historyDoc.data();

          return {
            id: historyDoc.id,
            marketId: typeof data.marketId === "string" ? data.marketId : "",
            timestamp: timestampMillis(data.timestamp),
            price: typeof data.price === "number" ? data.price : 0,
            volume: typeof data.volume === "number" ? data.volume : 0,
            quantity: typeof data.quantity === "number" ? data.quantity : 0,
            eventType: typeof data.eventType === "string" ? data.eventType as MarketHistoryEvent : "price_update",
            transactionId: typeof data.transactionId === "string" ? data.transactionId : undefined,
          } satisfies MarketHistoryPoint;
        }));
      },
      (error) => setNotice(error.message),
    );

    const unsubscribeBalances = onSnapshot(
      collection(db, "balances"),
      (snapshot) => {
        const nextBalances = Object.fromEntries(snapshot.docs.map((balanceDoc) => {
          const data = balanceDoc.data();

          return [
            balanceDoc.id,
            {
              coins: typeof data.coins === "number" ? data.coins : 0,
              displayName: typeof data.displayName === "string" ? data.displayName : "",
              email: typeof data.email === "string" ? data.email : "",
            } satisfies PublicBalance,
          ];
        }));

        setPublicBalances(nextBalances);

        const currentBalance = nextBalances[authUser.uid];

        if (currentBalance) {
          setCoins(currentBalance.coins);
          setCoinsReady(true);
        } else if (savedUserCoins !== null) {
          setDoc(doc(db, "balances", authUser.uid), {
            coins: savedUserCoins,
            displayName: authUser.displayName ?? "",
            email: authUser.email ?? "",
            updatedAt: serverTimestamp(),
          });
          setCoins(savedUserCoins);
          setCoinsReady(true);
        }
      },
      (error) => setNotice(error.message),
    );

    const unsubscribePublicHoldings = onSnapshot(
      collection(db, "holdings"),
      (snapshot) => {
        setPublicHoldings(Object.fromEntries(snapshot.docs.map((holdingDoc) => {
          const data = holdingDoc.data();
          const holding = {
            userId: typeof data.userId === "string" ? data.userId : "",
            marketId: typeof data.marketId === "string" ? data.marketId : "",
            quantity: typeof data.quantity === "number" ? data.quantity : 0,
            averagePrice: typeof data.averagePrice === "number" ? data.averagePrice : 0,
          } satisfies PublicHolding;

          return [
            `${holding.userId}_${holding.marketId}`,
            { quantity: holding.quantity, averagePrice: holding.averagePrice } satisfies Holding,
          ];
        })));

        setHoldings(Object.fromEntries(snapshot.docs.flatMap((holdingDoc) => {
          const data = holdingDoc.data();
          const userId = typeof data.userId === "string" ? data.userId : "";
          const marketId = typeof data.marketId === "string" ? data.marketId : "";

          if (userId !== authUser.uid || !marketId) {
            return [];
          }

          return [[
            marketId,
            {
              quantity: typeof data.quantity === "number" ? data.quantity : 0,
              averagePrice: typeof data.averagePrice === "number" ? data.averagePrice : 0,
            } satisfies Holding,
          ]];
        })));
      },
      (error) => setNotice(error.message),
    );

    const unsubscribeSuggestions = onSnapshot(
      query(collection(db, "suggestions"), orderBy("upvotes", "desc")),
      (snapshot) => {
        setSuggestions(snapshot.docs.map((suggestionDoc) => {
          const data = suggestionDoc.data();
          const voters = data.voters && typeof data.voters === "object"
            ? data.voters as Record<string, boolean>
            : {};

          return {
            id: suggestionDoc.id,
            name: typeof data.name === "string" ? data.name : "",
            category: typeof data.category === "string" ? data.category : "",
            reason: typeof data.reason === "string" ? data.reason : "",
            color: typeof data.color === "string" ? data.color : "#facc15",
            suggestedBy: typeof data.suggestedBy === "string" ? data.suggestedBy : "",
            suggestedByName: typeof data.suggestedByName === "string" ? data.suggestedByName : "",
            upvotes: typeof data.upvotes === "number" ? data.upvotes : 0,
            voters,
            createdAt: timestampMillis(data.createdAt),
          } satisfies Suggestion;
        }));
      },
      (error) => setNotice(error.message),
    );

    return () => {
      unsubscribeMarkets();
      unsubscribeOrders();
      unsubscribeTrades();
      unsubscribeMarketHistory();
      unsubscribeBalances();
      unsubscribePublicHoldings();
      unsubscribeSuggestions();
    };
  }, [authUser, savedUserCoins]);

  const saveCoins = useCallback(async (nextCoins: number) => {
    if (!authUser) {
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      return;
    }

    await setDoc(
      doc(db, "users", authUser.uid),
      {
        coins: nextCoins,
        displayName: authUser.displayName ?? "",
        email: authUser.email ?? "",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await setDoc(
      doc(db, "balances", authUser.uid),
      {
        coins: nextCoins,
        displayName: authUser.displayName ?? "",
        email: authUser.email ?? "",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }, [authUser]);

  const saveHolding = useCallback(async (assetId: string, holding: Holding) => {
    if (!authUser) {
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      return;
    }

    await setDoc(
      doc(db, "users", authUser.uid, "holdings", assetId),
      {
        quantity: holding.quantity,
        averagePrice: holding.averagePrice,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await setDoc(
      doc(db, "holdings", `${authUser.uid}_${assetId}`),
      {
        userId: authUser.uid,
        marketId: assetId,
        quantity: holding.quantity,
        averagePrice: holding.averagePrice,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }, [authUser]);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    window.buzzlyAddCoins = async (amount: number) => {
      const nextCoins = Math.max(0, Math.floor(coins + amount));
      setCoins(nextCoins);
      await saveCoins(nextCoins);
      return nextCoins;
    };

    window.buzzlySetCoins = async (amount: number) => {
      const nextCoins = Math.max(0, Math.floor(amount));
      setCoins(nextCoins);
      await saveCoins(nextCoins);
      return nextCoins;
    };

    return () => {
      delete window.buzzlyAddCoins;
      delete window.buzzlySetCoins;
    };
  }, [authUser, coins, saveCoins]);

  async function handleGoogleSignIn() {
    setAuthError("");
    const auth = getFirebaseAuth();

    if (!auth) {
      setAuthError("Firebase is missing configuration values.");
      return;
    }

    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Google sign-in failed.");
    }
  }

  async function handleSignOut() {
    const auth = getFirebaseAuth();

    if (auth) {
      setCoins(STARTING_COINS);
      setCoinsReady(false);
      await signOut(auth);
    }
  }

  async function createMarket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser) {
      return;
    }

    if (!isAdmin) {
      setActiveTab("markets");
      setNotice("Not authorized.");
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    const cleanName = marketName.trim();
    const cleanCategory = marketCategory.trim();
    const cleanPrice = Math.max(1, Math.floor(numericInputValue(marketPrice, 1)));
    const cleanSupply = Math.max(1, Math.floor(numericInputValue(marketSupply, 1)));

    if (!cleanName || !cleanCategory) {
      setNotice("Name and category required.");
      return;
    }

    try {
      const createdAt = Math.floor(performance.timeOrigin + event.timeStamp);
      const marketRef = await addDoc(collection(db, "markets"), {
        name: cleanName,
        category: cleanCategory,
        level: marketLevel,
        volatility: 0,
        lastPrice: cleanPrice,
        previousPrice: cleanPrice,
        volume: 0,
        supply: cleanSupply,
        totalSupply: cleanSupply,
        dropPrice: cleanPrice,
        soldDropSupply: 0,
        unsoldDropSupply: cleanSupply,
        activeTradableSupply: 0,
        remainingDropSupply: cleanSupply,
        status: "drop",
        description: "",
        signal: "",
        color: marketColor,
        source: "manual",
        createdBy: authUser.uid,
        createdByName: accountName,
        createdAt,
        updatedAt: createdAt,
      });
      await addDoc(collection(db, "marketHistory"), {
        marketId: marketRef.id,
        timestamp: createdAt,
        price: cleanPrice,
        volume: 0,
        quantity: 0,
        eventType: "create",
        transactionId: marketRef.id,
      });

      setSelectedAssetId(marketRef.id);
      setLimitPrice(cleanPrice);
      setMarketName("");
      setMarketCategory("");
      setMarketPrice(1);
      setMarketSupply(1000);
      setNotice("Market created.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Market create failed.");
    }
  }

  async function suggestDrop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser) {
      setNotice("Sign in required.");
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    const cleanName = suggestionName.trim();
    const cleanCategory = suggestionCategory.trim();
    const cleanReason = suggestionReason.trim();

    if (!cleanName || !cleanCategory) {
      setNotice("Suggestion needs a name and category.");
      return;
    }

    try {
      await addDoc(collection(db, "suggestions"), {
        name: cleanName,
        category: cleanCategory,
        reason: cleanReason,
        color: suggestionColor,
        suggestedBy: authUser.uid,
        suggestedByName: accountName,
        upvotes: 1,
        voters: { [authUser.uid]: true },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSuggestionName("");
      setSuggestionCategory("Event");
      setSuggestionReason("");
      setSuggestionColor("#facc15");
      setActiveTab("survey");
      setNotice("Suggestion added to voting.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Suggestion failed.");
    }
  }

  async function upvoteSuggestion(suggestion: Suggestion) {
    if (!authUser) {
      setNotice("Sign in required.");
      return;
    }

    if (suggestion.voters[authUser.uid]) {
      setNotice("You already upvoted that suggestion.");
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    try {
      await updateDoc(doc(db, "suggestions", suggestion.id), {
        upvotes: suggestion.upvotes + 1,
        [`voters.${authUser.uid}`]: true,
        updatedAt: serverTimestamp(),
      });

      setSuggestions((current) =>
        current.map((item) =>
          item.id === suggestion.id
            ? {
                ...item,
                upvotes: item.upvotes + 1,
                voters: { ...item.voters, [authUser.uid]: true },
              }
            : item,
        ),
      );
      setNotice(`Upvoted ${suggestion.name}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upvote failed.");
    }
  }

  async function buyFromDrop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser) {
      setNotice("Sign in required.");
      return;
    }

    if (!selectedAsset) {
      setNotice("No market selected.");
      return;
    }

    if (selectedAsset.status !== "drop") {
      setNotice("Drop ended.");
      return;
    }

    if (!coinsReady) {
      setNotice("Loading balance.");
      return;
    }

    const cleanQuantity = Math.max(1, Math.floor(numericInputValue(dropQuantity, 1)));
    const userDropLimit = dropPurchaseLimit(selectedAsset);
    const remainingUserLimit = Math.max(0, userDropLimit - selectedHolding.quantity);
    const buyQuantity = Math.min(cleanQuantity, selectedAsset.remainingDropSupply, remainingUserLimit);
    const totalCost = buyQuantity * selectedAsset.dropPrice;

    if (remainingUserLimit <= 0) {
      setNotice(`Drop limit reached. Max 5% of supply (${userDropLimit}) per user.`);
      return;
    }

    if (buyQuantity <= 0) {
      setNotice("Drop sold out.");
      return;
    }

    if (totalCost > coins) {
      setNotice("Not enough coins.");
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    const nextCoins = coins - totalCost;
    const nextHolding = applyTradeToHolding(selectedHolding, buyQuantity, selectedAsset.dropPrice);
    const nextRemainingSupply = selectedAsset.remainingDropSupply - buyQuantity;
    const nextSoldDropSupply = selectedAsset.soldDropSupply + buyQuantity;
    const nextActiveTradableSupply = selectedAsset.activeTradableSupply + buyQuantity;
    const nextVolume = selectedAsset.volume + totalCost;
    const nextStatus: MarketStatus = nextRemainingSupply <= 0 ? "trading" : "drop";
    const historyTimestamp = Math.floor(performance.timeOrigin + event.timeStamp);
    const historyEvent: MarketHistoryPoint = {
      id: `drop-${historyTimestamp}-${selectedAsset.id}`,
      marketId: selectedAsset.id,
      timestamp: historyTimestamp,
      price: selectedAsset.dropPrice,
      volume: totalCost,
      quantity: buyQuantity,
      eventType: buyQuantity > 1 ? "bulk_drop_buy" : "drop_buy",
      transactionId: `drop-${historyTimestamp}`,
    };

    const batch = writeBatch(db);

    batch.set(
      doc(db, "users", authUser.uid),
      {
        coins: nextCoins,
        displayName: authUser.displayName ?? "",
        email: authUser.email ?? "",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      doc(db, "balances", authUser.uid),
      {
        coins: nextCoins,
        displayName: authUser.displayName ?? "",
        email: authUser.email ?? "",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      doc(db, "users", authUser.uid, "holdings", selectedAsset.id),
      {
        quantity: nextHolding.quantity,
        averagePrice: nextHolding.averagePrice,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.set(
      doc(db, "holdings", `${authUser.uid}_${selectedAsset.id}`),
      {
        userId: authUser.uid,
        marketId: selectedAsset.id,
        quantity: nextHolding.quantity,
        averagePrice: nextHolding.averagePrice,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    batch.update(doc(db, "markets", selectedAsset.id), {
      soldDropSupply: nextSoldDropSupply,
      unsoldDropSupply: nextRemainingSupply,
      activeTradableSupply: nextActiveTradableSupply,
      remainingDropSupply: nextRemainingSupply,
      volume: nextVolume,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(db, "marketHistory")), {
      marketId: historyEvent.marketId,
      timestamp: historyTimestamp,
      price: historyEvent.price,
      volume: historyEvent.volume,
      quantity: historyEvent.quantity,
      eventType: historyEvent.eventType,
      transactionId: historyEvent.transactionId,
    });

    await batch.commit();

    setCoins(nextCoins);
    setHoldings((current) => ({ ...current, [selectedAsset.id]: nextHolding }));
    setMarketHistory((current) => dedupeHistoryPoints([...current, historyEvent]));
    setAssets((currentAssets) =>
      currentAssets.map((asset) =>
        asset.id === selectedAsset.id
          ? {
              ...asset,
              soldDropSupply: nextSoldDropSupply,
              unsoldDropSupply: nextRemainingSupply,
              activeTradableSupply: nextActiveTradableSupply,
              remainingDropSupply: nextRemainingSupply,
              volume: nextVolume,
              status: nextStatus,
            }
          : asset,
      ),
    );
    setDropQuantity(1);
    setNotice(
      nextStatus === "trading"
        ? "Drop sold out. All purchased supply is tradable."
        : `${buyQuantity} bought. ${nextActiveTradableSupply} total units are now tradable.`,
    );
  }

  async function deleteMarket(assetId: string) {
    if (!authUser) {
      setNotice("Sign in required.");
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    const ordersSnapshot = await getDocs(query(collection(db, "orders")));
    const tradesSnapshot = await getDocs(query(collection(db, "trades")));
    const historySnapshot = await getDocs(query(collection(db, "marketHistory")));
    const batch = writeBatch(db);

    ordersSnapshot.docs
      .filter((orderDoc) => orderDoc.data().assetId === assetId)
      .forEach((orderDoc) => batch.delete(doc(db, "orders", orderDoc.id)));

    tradesSnapshot.docs
      .filter((tradeDoc) => tradeDoc.data().assetId === assetId)
      .forEach((tradeDoc) => batch.delete(doc(db, "trades", tradeDoc.id)));
    historySnapshot.docs
      .filter((historyDoc) => historyDoc.data().marketId === assetId)
      .forEach((historyDoc) => batch.delete(doc(db, "marketHistory", historyDoc.id)));

    batch.delete(doc(db, "markets", assetId));
    await batch.commit();

    setSelectedAssetId((current) => (current === assetId ? "" : current));
    setNotice("Market deleted.");
  }

  async function cancelOrder(orderId: string) {
    if (!authUser) {
      setNotice("Sign in required.");
      return;
    }

    const order = orders.find((item) => item.id === orderId);

    if (!order || order.userId !== authUser.uid) {
      setNotice("You can only cancel your own orders.");
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    const batch = writeBatch(db);
    let refundText = "";

    if (order.side === "buy") {
      const refund = order.remaining * order.limitPrice;
      const nextCoins = coins + refund;

      batch.set(
        doc(db, "users", authUser.uid),
        {
          coins: nextCoins,
          displayName: authUser.displayName ?? "",
          email: authUser.email ?? "",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      batch.set(
        doc(db, "balances", authUser.uid),
        {
          coins: nextCoins,
          displayName: authUser.displayName ?? "",
          email: authUser.email ?? "",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setCoins(nextCoins);
      refundText = ` Refunded ${currency(refund)}.`;
    } else {
      const currentHolding = holdings[order.assetId] ?? { quantity: 0, averagePrice: 0 };
      const nextHolding = {
        ...currentHolding,
        quantity: currentHolding.quantity + order.remaining,
      };

      batch.set(
        doc(db, "users", authUser.uid, "holdings", order.assetId),
        {
          quantity: nextHolding.quantity,
          averagePrice: nextHolding.averagePrice,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      batch.set(
        doc(db, "holdings", `${authUser.uid}_${order.assetId}`),
        {
          userId: authUser.uid,
          marketId: order.assetId,
          quantity: nextHolding.quantity,
          averagePrice: nextHolding.averagePrice,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setHoldings((current) => ({ ...current, [order.assetId]: nextHolding }));
      refundText = ` Returned ${order.remaining} shares.`;
    }

    batch.delete(doc(db, "orders", orderId));
    await batch.commit();
    setOrders((current) => current.filter((item) => item.id !== orderId));
    setNotice(`Order cancelled.${refundText}`);
  }

  async function resetEconomy() {
    if (!authUser) {
      setNotice("Sign in required.");
      return;
    }

    if (!isAdmin) {
      setNotice("Not authorized.");
      return;
    }

    if (!window.confirm("Reset all markets, drops, trades, orders, portfolios, coins, and surveys?")) {
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    const [
      marketsSnapshot,
      ordersSnapshot,
      tradesSnapshot,
      holdingsSnapshot,
      balancesSnapshot,
      privateHoldingsSnapshot,
      historySnapshot,
      suggestionsSnapshot,
    ] = await Promise.all([
      getDocs(collection(db, "markets")),
      getDocs(collection(db, "orders")),
      getDocs(collection(db, "trades")),
      getDocs(collection(db, "holdings")),
      getDocs(collection(db, "balances")),
      getDocs(collection(db, "users", authUser.uid, "holdings")),
      getDocs(collection(db, "marketHistory")),
      getDocs(collection(db, "suggestions")),
    ]);
    const batch = writeBatch(db);

    marketsSnapshot.docs.forEach((marketDoc) => batch.delete(doc(db, "markets", marketDoc.id)));
    ordersSnapshot.docs.forEach((orderDoc) => batch.delete(doc(db, "orders", orderDoc.id)));
    tradesSnapshot.docs.forEach((tradeDoc) => batch.delete(doc(db, "trades", tradeDoc.id)));
    historySnapshot.docs.forEach((historyDoc) => batch.delete(doc(db, "marketHistory", historyDoc.id)));
    suggestionsSnapshot.docs.forEach((suggestionDoc) => batch.delete(doc(db, "suggestions", suggestionDoc.id)));
    holdingsSnapshot.docs.forEach((holdingDoc) => batch.delete(doc(db, "holdings", holdingDoc.id)));
    privateHoldingsSnapshot.docs.forEach((holdingDoc) =>
      batch.delete(doc(db, "users", authUser.uid, "holdings", holdingDoc.id)),
    );
    balancesSnapshot.docs.forEach((balanceDoc) => {
      const data = balanceDoc.data();

      batch.set(
        doc(db, "balances", balanceDoc.id),
        {
          coins: 0,
          displayName: typeof data.displayName === "string" ? data.displayName : "",
          email: typeof data.email === "string" ? data.email : "",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    });
    batch.set(
      doc(db, "users", authUser.uid),
      {
        coins: 0,
        displayName: authUser.displayName ?? "",
        email: authUser.email ?? "",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    batch.set(
      doc(db, "balances", authUser.uid),
      {
        coins: 0,
        displayName: authUser.displayName ?? "",
        email: authUser.email ?? "",
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    await batch.commit();

    setAssets([]);
    setOrders([]);
    setTrades([]);
    setMarketHistory([]);
    setSuggestions([]);
    setHoldings({});
    setPublicHoldings({});
    setCoins(0);
    setSelectedAssetId("");
    setNotice("Everything reset.");
  }

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId);
  const activeDrops = assets.filter((asset) => asset.status === "drop" && asset.remainingDropSupply > 0);
  const tradingMarkets = assets.filter((asset) => asset.activeTradableSupply > 0);
  const matchesAssetSearch = (asset: Asset, query: string) => {
    const queryText = query.trim().toLowerCase();

    if (!queryText) {
      return true;
    }

    return [asset.name, asset.category, asset.description, asset.signal, levelCopy[asset.level].label, asset.status]
      .join(" ")
      .toLowerCase()
      .includes(queryText);
  };
  const visibleMarkets = assets.filter((asset) => matchesAssetSearch(asset, marketSearch));
  const visibleActiveDrops = activeDrops.filter((asset) => matchesAssetSearch(asset, dropSearch));
  const visibleTradingMarkets = tradingMarkets.filter((asset) => matchesAssetSearch(asset, tradeSearch));
  const portfolioAssets = assets.filter((asset) => (holdings[asset.id]?.quantity ?? 0) > 0);
  const visibleAsset =
    activeTab === "drop" && selectedAsset && !activeDrops.some((asset) => asset.id === selectedAsset.id)
      ? undefined
      : activeTab === "trading" && (!selectedAsset || selectedAsset.activeTradableSupply <= 0)
      ? undefined
      : selectedAsset;
  const selectedAssetOrderId = selectedAsset?.id ?? "";
  const buyOrders = selectedAsset ? getOrderBook(orders, selectedAssetOrderId, "buy") : [];
  const sellOrders = selectedAsset ? getOrderBook(orders, selectedAssetOrderId, "sell") : [];
  const selectedAssetTrades = trades.filter((trade) => trade.assetId === selectedAssetOrderId);
  const selectedAssetHistory = marketHistory.filter((point) => point.marketId === selectedAssetOrderId);
  const assetTrades = selectedAssetTrades.slice(0, 6);
  const bestBid = buyOrders[0]?.limitPrice;
  const bestAsk = sellOrders[0]?.limitPrice;
  const selectedHolding = selectedAsset ? holdings[selectedAsset.id] ?? { quantity: 0, averagePrice: 0 } : { quantity: 0, averagePrice: 0 };
  const selectedDropLimitRemaining = selectedAsset
    ? Math.max(0, dropPurchaseLimit(selectedAsset) - selectedHolding.quantity)
    : 0;
  const visibleSuggestions = suggestions
    .filter((suggestion) => {
      const queryText = surveySearch.trim().toLowerCase();

      if (!queryText) {
        return true;
      }

      return [suggestion.name, suggestion.category, suggestion.reason, suggestion.suggestedByName]
        .join(" ")
        .toLowerCase()
        .includes(queryText);
    })
    .sort((a, b) => b.upvotes - a.upvotes || b.createdAt - a.createdAt);
  const change = selectedAsset && selectedAsset.previousPrice
    ? ((selectedAsset.lastPrice - selectedAsset.previousPrice) / selectedAsset.previousPrice) * 100
    : 0;
  const dashboardChange = assets.length
    ? assets.reduce((sum, asset) => {
        if (!asset.previousPrice) {
          return sum;
        }

        return sum + ((asset.lastPrice - asset.previousPrice) / asset.previousPrice) * 100;
      }, 0) / assets.length
    : 0;
  const trendingMarkets = [...assets]
    .sort((a, b) => b.volume - a.volume || b.lastPrice - a.lastPrice)
    .slice(0, 4);
  const activePositions = portfolioAssets.slice(0, 3).map((asset) => {
    const holding = holdings[asset.id] ?? { quantity: 0, averagePrice: 0 };
    const gain = holding.quantity * (asset.lastPrice - holding.averagePrice);

    return { asset, holding, gain };
  });
  const recentActivity = [
    ...trades.slice(0, 3).map((trade) => {
      const asset = assets.find((item) => item.id === trade.assetId);

      return {
        id: trade.id,
        label: `${trade.quantity} shares traded`,
        detail: asset?.name ?? "Market trade",
      };
    }),
    ...assets.slice(0, 2).map((asset) => ({
      id: `market-${asset.id}`,
      label: `${asset.status === "drop" ? "Drop live" : "Price updated"}`,
      detail: asset.name,
    })),
  ].slice(0, 4);
  const portfolioTotalValue = portfolioAssets.reduce((sum, asset) => {
    const holding = holdings[asset.id] ?? { quantity: 0, averagePrice: 0 };

    return sum + holding.quantity * asset.lastPrice;
  }, 0);
  const portfolioSlices = portfolioAssets
    .map((asset) => {
      const holding = holdings[asset.id] ?? { quantity: 0, averagePrice: 0 };
      const value = holding.quantity * asset.lastPrice;

      return {
        asset,
        quantity: holding.quantity,
        value,
        percent: portfolioTotalValue ? (value / portfolioTotalValue) * 100 : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
  const rankedDropSuggestions = [...suggestions]
    .filter((suggestion) => suggestion.name.trim())
    .sort((a, b) => b.upvotes - a.upvotes || a.createdAt - b.createdAt);
  const scheduledSuggestions = rankedDropSuggestions
    .filter((suggestion) => !skippedDropSuggestionIds.includes(suggestion.id))
    .slice(0, DROP_BATCH_SIZE);
  const upcomingDrops: UpcomingDrop[] = scheduledSuggestions.map((suggestion, index) => {
    const plannedSupply = plannedDropSupply();

    return {
      id: `scheduled-${suggestion.id}`,
      suggestionId: suggestion.id,
      rank: rankedDropSuggestions.findIndex((item) => item.id === suggestion.id) + 1,
      title: suggestion.name,
      category: suggestion.category,
      color: suggestion.color,
      votes: suggestion.upvotes,
      releaseAt: nextDropTime,
      status: index === 0 ? "Dropping next" : "Scheduled",
      limit: Math.max(1, Math.floor(plannedSupply * DROP_PURCHASE_LIMIT_PERCENT)),
      plannedSupply,
      price: plannedDropPrice(),
    };
  });

  async function launchScheduledDrops(drops: UpcomingDrop[], cycleDropTime: number) {
    if (!authUser || !drops.length || processingDropCycle) {
      return;
    }

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    setProcessingDropCycle(true);

    try {
      const createdMarketIds: string[] = [];

      const launched = await runTransaction(db, async (transaction) => {
        const cycleRef = doc(db, "dropCycles", String(cycleDropTime));
        const cycleSnapshot = await transaction.get(cycleRef);

        if (cycleSnapshot.exists()) {
          return false;
        }

        const lockedDrops = drops.slice(0, DROP_BATCH_SIZE);

        transaction.set(cycleRef, {
          dropTime: cycleDropTime,
          suggestionIds: lockedDrops.map((drop) => drop.suggestionId),
          createdBy: authUser.uid,
          createdByName: accountName,
          createdAt: serverTimestamp(),
        });

        lockedDrops.forEach((drop, index) => {
          const marketRef = doc(db, "markets", `drop_${cycleDropTime}_${index + 1}`);
          const historyRef = doc(db, "marketHistory", `drop_${cycleDropTime}_${index + 1}`);

          createdMarketIds.push(marketRef.id);
          transaction.set(marketRef, {
            name: drop.title,
            category: drop.category,
            level: "community",
            volatility: 0,
            lastPrice: drop.price,
            previousPrice: drop.price,
            volume: 0,
            supply: drop.plannedSupply,
            totalSupply: drop.plannedSupply,
            dropPrice: drop.price,
            soldDropSupply: 0,
            unsoldDropSupply: drop.plannedSupply,
            activeTradableSupply: 0,
            remainingDropSupply: drop.plannedSupply,
            status: "drop",
            description: `Dropped from Vote with ${drop.votes} votes.`,
            signal: "Vote ranked",
            color: drop.color,
            source: "scheduled_drop",
            createdBy: authUser.uid,
            createdByName: accountName,
            createdAt: cycleDropTime,
            updatedAt: cycleDropTime,
          });
          transaction.set(historyRef, {
            marketId: marketRef.id,
            timestamp: cycleDropTime,
            price: drop.price,
            volume: 0,
            quantity: 0,
            eventType: "create",
            transactionId: marketRef.id,
          });
          transaction.delete(doc(db, "suggestions", drop.suggestionId));
        });

        return true;
      });

      if (!launched) {
        setNotice("This drop cycle already launched.");
        return;
      }

      setSkippedDropSuggestionIds([]);
      setSelectedAssetId(createdMarketIds[0] ?? "");
      setLimitPrice(drops[0]?.price ?? 1);
      setNotice(`${Math.min(drops.length, DROP_BATCH_SIZE)} vote drops are live.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Drop launch failed.");
    } finally {
      setProcessingDropCycle(false);
    }
  }

  useEffect(() => {
    if (now < nextDropTime || processingDropCycle) {
      return;
    }

    const dropsToLaunch = upcomingDrops;
    const cycleDropTime = nextDropTime;
    const followingDropTime = nextHourlyDropTime(now);

    setNextDropTime(followingDropTime);
    setSkippedDropSuggestionIds([]);

    if (dropsToLaunch.length) {
      void launchScheduledDrops(dropsToLaunch, cycleDropTime);
    } else {
      setNotice("No eligible survey events for this drop cycle.");
    }
  }, [now, nextDropTime, processingDropCycle, upcomingDrops]);

  async function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!authUser) {
      setNotice("Sign in required.");
      return;
    }

    if (!selectedAsset) {
      setNotice("No market selected.");
      return;
    }

    if (selectedAsset.activeTradableSupply <= 0) {
      setNotice("No purchased supply is tradable yet.");
      return;
    }

    if (!coinsReady) {
      setNotice("Loading balance.");
      return;
    }

    const tradeAssetId = selectedAsset.id;
    const currentUserId = authUser.uid;
    const cleanQuantity = Math.max(1, Math.floor(numericInputValue(quantity, 1)));
    const cleanLimit = Math.max(1, Math.floor(numericInputValue(limitPrice, 1)));
    const createdAt = Math.floor(performance.timeOrigin + event.timeStamp);

    if (side === "buy" && cleanQuantity * cleanLimit > coins) {
      setNotice("Not enough coins.");
      return;
    }

    if (side === "sell" && cleanQuantity > selectedHolding.quantity) {
      setNotice("Not enough shares.");
      return;
    }

    const incoming: Order = {
      id: `user-${createdAt}`,
      assetId: tradeAssetId,
      userId: authUser.uid,
      user: accountName,
      ownerCoins: coins,
      side,
      limitPrice: cleanLimit,
      quantity: cleanQuantity,
      remaining: cleanQuantity,
      status: "open",
      createdAt,
    };

    const nextOrders = [...orders];
    const nextTrades: Trade[] = [];
    const nextHoldings = { ...holdings };
    const matchedOrders: Order[] = [];
    const accountUpdates: Record<string, PublicBalance> = {
      [currentUserId]: {
        coins,
        displayName: authUser.displayName ?? "",
        email: authUser.email ?? "",
      },
    };
    const holdingUpdates: Record<string, PublicHolding> = {};
    let remaining = cleanQuantity;
    let nextCoins = coins;

    function getAccount(userId: string, fallbackName: string, fallbackCoins = 0) {
      accountUpdates[userId] ??= publicBalances[userId] ?? {
        coins: fallbackCoins,
        displayName: fallbackName,
        email: "",
      };

      return accountUpdates[userId];
    }

    function getHolding(userId: string) {
      const key = `${userId}_${tradeAssetId}`;
      const fallback = userId === currentUserId ? selectedHolding : publicHoldings[key];

      holdingUpdates[key] ??= {
        userId,
        marketId: tradeAssetId,
        quantity: fallback?.quantity ?? 0,
        averagePrice: fallback?.averagePrice ?? 0,
      };

      return holdingUpdates[key];
    }

    if (side === "buy") {
      nextCoins -= cleanQuantity * cleanLimit;
      getAccount(authUser.uid, accountName).coins = nextCoins;
      const matches = nextOrders
        .filter((order) => order.assetId === tradeAssetId && order.side === "sell" && order.remaining > 0 && order.limitPrice <= cleanLimit)
        .sort((a, b) => a.limitPrice - b.limitPrice || a.createdAt - b.createdAt);

      for (const match of matches) {
        if (remaining <= 0) break;
        const tradeQuantity = Math.min(remaining, match.remaining);
        const tradePrice = match.limitPrice;
        const total = tradeQuantity * tradePrice;
        const refund = tradeQuantity * (cleanLimit - tradePrice);

        match.remaining -= tradeQuantity;
        match.status = match.remaining === 0 ? "filled" : "partially_filled";
        matchedOrders.push(match);
        remaining -= tradeQuantity;
        nextCoins += refund;
        getAccount(authUser.uid, accountName).coins = nextCoins;
        getAccount(match.userId, match.user, match.ownerCoins).coins += total;
        getHolding(match.userId);
        nextHoldings[tradeAssetId] = applyTradeToHolding(nextHoldings[tradeAssetId], tradeQuantity, tradePrice);
        const buyerHolding = getHolding(authUser.uid);
        buyerHolding.quantity = nextHoldings[tradeAssetId].quantity;
        buyerHolding.averagePrice = nextHoldings[tradeAssetId].averagePrice;
        nextTrades.push({
          id: `trade-${createdAt}-${match.id}`,
          assetId: tradeAssetId,
          buyerId: authUser.uid,
          buyer: accountName,
          sellerId: match.userId,
          seller: match.user,
          price: tradePrice,
          quantity: tradeQuantity,
          createdAt,
        });

        void total;
      }

      incoming.remaining = remaining;
      incoming.status = remaining === 0 ? "filled" : remaining === cleanQuantity ? "open" : "partially_filled";
    } else {
      nextHoldings[tradeAssetId] = {
        ...selectedHolding,
        quantity: selectedHolding.quantity - cleanQuantity,
      };
      const sellerHolding = getHolding(authUser.uid);
      sellerHolding.quantity = nextHoldings[tradeAssetId].quantity;
      sellerHolding.averagePrice = nextHoldings[tradeAssetId].averagePrice;

      const matches = nextOrders
        .filter((order) => order.assetId === tradeAssetId && order.side === "buy" && order.remaining > 0 && order.limitPrice >= cleanLimit)
        .sort((a, b) => b.limitPrice - a.limitPrice || a.createdAt - b.createdAt);

      for (const match of matches) {
        if (remaining <= 0) break;
        const tradeQuantity = Math.min(remaining, match.remaining);
        const tradePrice = match.limitPrice;

        match.remaining -= tradeQuantity;
        match.status = match.remaining === 0 ? "filled" : "partially_filled";
        matchedOrders.push(match);
        remaining -= tradeQuantity;
        nextCoins += tradeQuantity * tradePrice;
        getAccount(authUser.uid, accountName).coins = nextCoins;
        getAccount(match.userId, match.user, match.ownerCoins);
        const buyerHolding = getHolding(match.userId);
        const updatedBuyerHolding = applyTradeToHolding(buyerHolding, tradeQuantity, tradePrice);
        buyerHolding.quantity = updatedBuyerHolding.quantity;
        buyerHolding.averagePrice = updatedBuyerHolding.averagePrice;
        nextTrades.push({
          id: `trade-${createdAt}-${match.id}`,
          assetId: tradeAssetId,
          buyerId: match.userId,
          buyer: match.user,
          sellerId: authUser.uid,
          seller: accountName,
          price: tradePrice,
          quantity: tradeQuantity,
          createdAt,
        });
      }

      incoming.remaining = remaining;
      incoming.status = remaining === 0 ? "filled" : remaining === cleanQuantity ? "open" : "partially_filled";
    }

    if (incoming.remaining > 0) {
      nextOrders.push(incoming);
    }

    const latestTrade = nextTrades.at(-1);
    const matchedQuantity = cleanQuantity - remaining;
    const historyEvent: MarketHistoryPoint | null = latestTrade
      ? {
          id: `history-${createdAt}-${tradeAssetId}`,
          marketId: tradeAssetId,
          timestamp: createdAt,
          price: latestTrade.price,
          volume: nextTrades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0),
          quantity: matchedQuantity,
          eventType: side === "buy"
            ? matchedQuantity > 1 ? "bulk_buy" : "buy"
            : matchedQuantity > 1 ? "bulk_sell" : "sell",
          transactionId: `order-${createdAt}`,
        }
      : null;
    const nextVolume = selectedAsset.volume + nextTrades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0);
    const nextVolatility = latestTrade
      ? calculateVolatility([
          ...trades
            .filter((trade) => trade.assetId === tradeAssetId)
            .map((trade) => trade.price)
            .reverse(),
          ...nextTrades.map((trade) => trade.price),
        ])
      : selectedAsset.volatility;

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    try {
      const batch = writeBatch(db);

      if (incoming.remaining > 0) {
        batch.set(doc(collection(db, "orders")), {
          assetId: incoming.assetId,
          userId: incoming.userId,
          user: incoming.user,
          ownerCoins: incoming.ownerCoins,
          side: incoming.side,
          limitPrice: incoming.limitPrice,
          quantity: incoming.quantity,
          remaining: incoming.remaining,
          status: incoming.status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      for (const order of matchedOrders) {
        batch.update(doc(db, "orders", order.id), {
          remaining: order.remaining,
          status: order.status,
          updatedAt: serverTimestamp(),
        });
      }

      for (const trade of nextTrades) {
        batch.set(doc(collection(db, "trades")), {
          assetId: trade.assetId,
          buyerId: trade.buyerId,
          buyer: trade.buyer,
          sellerId: trade.sellerId,
          seller: trade.seller,
          price: trade.price,
          quantity: trade.quantity,
          createdAt: serverTimestamp(),
        });
      }

      batch.set(
        doc(db, "users", authUser.uid),
        {
          coins: nextCoins,
          displayName: authUser.displayName ?? "",
          email: authUser.email ?? "",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      for (const [userId, account] of Object.entries(accountUpdates)) {
        batch.set(
          doc(db, "balances", userId),
          {
            coins: account.coins,
            displayName: account.displayName,
            email: account.email,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }

      for (const holding of Object.values(holdingUpdates)) {
        batch.set(
          doc(db, "holdings", `${holding.userId}_${holding.marketId}`),
          {
            userId: holding.userId,
            marketId: holding.marketId,
            quantity: holding.quantity,
            averagePrice: holding.averagePrice,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );

        if (holding.userId === authUser.uid) {
          batch.set(
            doc(db, "users", authUser.uid, "holdings", tradeAssetId),
            {
              quantity: holding.quantity,
              averagePrice: holding.averagePrice,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      }

      if (latestTrade) {
        batch.update(doc(db, "markets", tradeAssetId), {
          previousPrice: selectedAsset.lastPrice,
          lastPrice: latestTrade.price,
          volume: nextVolume,
          volatility: nextVolatility,
          updatedAt: serverTimestamp(),
        });
        if (historyEvent) {
          batch.set(doc(collection(db, "marketHistory")), {
            marketId: historyEvent.marketId,
            timestamp: historyEvent.timestamp,
            price: historyEvent.price,
            volume: historyEvent.volume,
            quantity: historyEvent.quantity,
            eventType: historyEvent.eventType,
            transactionId: historyEvent.transactionId,
          });
        }
      }

      await batch.commit();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Trade failed.");
      return;
    }

    setOrders(nextOrders.filter((order) => order.remaining > 0));
    setTrades([...nextTrades.reverse(), ...trades]);
    if (historyEvent) {
      setMarketHistory((current) => dedupeHistoryPoints([...current, historyEvent]));
    }
    setHoldings(nextHoldings);
    setCoins(nextCoins);
    void saveHolding(tradeAssetId, nextHoldings[tradeAssetId] ?? { quantity: 0, averagePrice: 0 });
    setAssets((currentAssets) =>
      currentAssets.map((asset) =>
        asset.id === tradeAssetId && latestTrade
          ? {
              ...asset,
              previousPrice: asset.lastPrice,
              lastPrice: latestTrade.price,
              volume: nextVolume,
              volatility: nextVolatility,
            }
          : asset,
      ),
    );

    if (matchedQuantity > 0 && remaining > 0) {
      setNotice(`${matchedQuantity} matched. ${remaining} open.`);
    } else if (matchedQuantity > 0) {
      setNotice(`${matchedQuantity} matched.`);
    } else {
      setNotice(`${side} order open at ${cleanLimit}.`);
    }
  }

  if (!authUser) {
    return <AuthScreen authReady={authReady} authError={authError} onSignIn={handleGoogleSignIn} />;
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="min-h-screen xl:grid xl:grid-cols-[17rem_minmax(0,1fr)]">
        <nav className="sticky top-0 z-30 border-b border-border bg-surface/95 px-4 py-4 backdrop-blur xl:h-screen xl:border-b-0 xl:border-r xl:px-5">
          <button
            onClick={() => setActiveTab("markets")}
            className="flex items-center gap-3 rounded-3xl px-2 py-2 text-left"
          >
            <Image src="/beelogo.png" alt="Buzzy logo" width={48} height={48} className="h-12 w-12 rounded-2xl object-cover shadow-card" />
            <span>
              <span className="flex items-center gap-2">
                <span className="block text-lg font-black">Buzzy</span>
                {isAdmin ? (
                  <span className="rounded-full border border-danger bg-red-50 px-2 py-0.5 text-xs font-black text-danger">
                    ADMIN
                  </span>
                ) : null}
              </span>
              <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted">Trade the Hype</span>
            </span>
          </button>

          <div className="mt-6 flex gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex min-w-fit items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold transition xl:w-full ${
                  activeTab === tab.id
                    ? "bg-brand text-foreground shadow-card"
                    : "text-muted hover:bg-surface-warm hover:text-foreground"
                }`}
                title={tab.label}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 text-foreground">
                  <TabIcon id={tab.id} />
                </span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className="min-w-0">
          <header className="border-b border-border bg-background px-5 py-6 lg:px-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">Buzzy</p>
                <h1 className="mt-2 text-4xl font-black tracking-normal text-foreground md:text-5xl">
                  Trade the Hype.
                </h1>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <DropTimerBadge nextDropTime={nextDropTime} now={now} scheduledCount={upcomingDrops.length} />
              </div>
            </div>
          </header>

          <section className="grid gap-6 px-5 py-6 lg:px-8 2xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="min-w-0 space-y-5">
          {activeTab === "markets" ? (
          <div className="rounded-[1.75rem] border border-border bg-surface p-5 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Markets</h2>
                <p className="mt-1 text-sm text-muted">Live hype markets, drops, and momentum.</p>
              </div>
              <span className="rounded-full bg-brand px-3 py-1 text-xs font-black">
                {visibleMarkets.length}/{assets.length} listed
              </span>
            </div>
            <div className="mt-5 rounded-3xl bg-surface-warm p-4">
              <label className="text-sm font-bold text-muted">
                Search markets
                <input
                  value={marketSearch}
                  onChange={(event) => setMarketSearch(event.target.value)}
                  placeholder="Search by name, category, or status"
                  className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                />
              </label>
            </div>
            {assets.length ? null : (
              <p className="mt-4 rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">No markets.</p>
            )}
          </div>
          ) : null}

          {activeTab === "create" && isAdmin ? (
          <form onSubmit={createMarket} className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
            <div className="flex flex-col gap-2 border-b border-border pb-5">
              <span className="w-fit rounded-full bg-brand px-3 py-1 text-xs font-black uppercase tracking-[0.12em]">Market studio</span>
              <h2 className="text-3xl font-black">Create Market</h2>
              <p className="text-sm leading-6 text-muted">Launch a new culture market with a drop price, supply, and visibility level.</p>
            </div>
            <div className="mt-6 grid gap-4">
              <label className="text-sm font-bold text-muted">
                Name
                <input
                  value={marketName}
                  onChange={(event) => setMarketName(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                />
              </label>
              <label className="text-sm font-bold text-muted">
                Category
                <input
                  value={marketCategory}
                  onChange={(event) => setMarketCategory(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                />
              </label>
              <label className="text-sm font-bold text-muted">
                Level
                <select
                  value={marketLevel}
                  onChange={(event) => setMarketLevel(event.target.value as MarketLevel)}
                  className="mt-2 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                >
                  {(Object.keys(levelCopy) as MarketLevel[]).map((level) => (
                    <option key={level} value={level}>
                      {levelCopy[level].label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                <label className="text-sm font-bold text-muted">
                  Price
                  <input
                    value={marketPrice}
                    onChange={(event) => setMarketPrice(event.target.value === "" ? "" : Number(event.target.value))}
                    min={1}
                    type="number"
                    className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                  />
                </label>
                <label className="text-sm font-bold text-muted">
                  Supply
                  <input
                    value={marketSupply}
                    onChange={(event) => setMarketSupply(event.target.value === "" ? "" : Number(event.target.value))}
                    min={1}
                    type="number"
                    className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                  />
                </label>
                <label className="text-sm font-bold text-muted">
                  Color
                  <input
                    value={marketColor}
                    onChange={(event) => setMarketColor(event.target.value)}
                    type="color"
                    className="mt-2 h-12 w-16 rounded-2xl border border-border bg-surface p-1"
                  />
                </label>
              </div>
            </div>
            <button className="mt-6 w-full rounded-2xl bg-brand px-4 py-4 font-black text-foreground shadow-card transition hover:-translate-y-0.5 hover:bg-brand-hover hover:shadow-lift">
              Create
            </button>
          </form>
          ) : null}

          {activeTab === "suggest" ? (
          <form onSubmit={suggestDrop} className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
            <h2 className="text-2xl font-black">Suggest a Drop</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Submit a new hype market idea. Popular suggestions can become community verified drops.
            </p>
            <div className="mt-5 grid gap-4">
              <label className="text-sm font-bold text-muted">
                Drop name
                <input
                  value={suggestionName}
                  onChange={(event) => setSuggestionName(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                />
              </label>
              <label className="text-sm font-bold text-muted">
                Category
                <select
                  value={suggestionCategory}
                  onChange={(event) => setSuggestionCategory(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                >
                  {["Event", "Product", "Music", "Public Figure", "Sports", "Meme", "Miscellaneous"].map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-bold text-muted">
                Color
                <input
                  value={suggestionColor}
                  onChange={(event) => setSuggestionColor(event.target.value)}
                  type="color"
                  className="mt-2 h-12 w-16 rounded-2xl border border-border bg-surface p-1"
                />
              </label>
              <label className="text-sm font-bold text-muted">
                Why should this be a drop?
                <textarea
                  value={suggestionReason}
                  onChange={(event) => setSuggestionReason(event.target.value)}
                  rows={4}
                  className="mt-2 w-full resize-none rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                />
              </label>
            </div>
            <button className="mt-5 w-full rounded-2xl bg-brand px-4 py-4 font-black text-foreground shadow-card transition hover:-translate-y-0.5 hover:bg-brand-hover">
              Submit suggestion
            </button>
            <p className="mt-3 rounded-2xl bg-surface-warm p-3 text-sm font-semibold leading-6 text-muted">
              {notice}
            </p>
          </form>
          ) : null}

          {activeTab === "survey" ? (
            <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
              <div>
                <div>
                    <h2 className="text-2xl font-black">Vote Suggestions</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Search community ideas and vote for the drops you want listed next. Results are sorted by popularity.
                  </p>
                </div>
              </div>
              <div className="mt-5 rounded-3xl bg-surface-warm p-4">
                <label className="text-sm font-bold text-muted">
                  Search votes
                  <input
                    value={surveySearch}
                    onChange={(event) => setSurveySearch(event.target.value)}
                    placeholder="Search by name, category, or creator"
                    className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                  />
                </label>
              </div>

              <div className="mt-5 grid gap-3">
                {visibleSuggestions.length ? visibleSuggestions.map((suggestion, index) => {
                  const alreadyVoted = Boolean(authUser && suggestion.voters[authUser.uid]);

                  return (
                    <div key={suggestion.id} className="rounded-3xl border border-border bg-surface-warm p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-brand px-2 py-1 text-xs font-black text-foreground">
                              #{index + 1}
                            </span>
                            <h3 className="truncate text-lg font-bold">{suggestion.name}</h3>
                            <span className="h-6 w-6 rounded-xl border border-border" style={{ background: suggestion.color }} />
                            <span className="rounded-full bg-surface px-2 py-1 text-xs font-bold text-muted">
                              {suggestion.category}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted">
                            {suggestion.reason || "No reason added."}
                          </p>
                          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-quiet">
                            Suggested by {suggestion.suggestedByName || "someone"}
                          </p>
                        </div>
                        <div className="shrink-0 text-left sm:text-right">
                          <p className="text-3xl font-black">{suggestion.upvotes}</p>
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Upvotes</p>
                          <button
                            onClick={() => void upvoteSuggestion(suggestion)}
                            disabled={alreadyVoted}
                            className="mt-3 rounded-2xl bg-brand px-4 py-2 text-sm font-black text-foreground transition hover:bg-brand-hover disabled:bg-surface-soft disabled:text-quiet"
                          >
                            {alreadyVoted ? "Voted" : "Upvote"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <p className="rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">
                    No suggestions found.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "markets" && assets.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {visibleMarkets.length ? visibleMarkets.map((asset) => {
                const assetChange = asset.previousPrice
                  ? ((asset.lastPrice - asset.previousPrice) / asset.previousPrice) * 100
                  : 0;

                return (
                  <button
                    key={asset.id}
                    onClick={() => {
                      setSelectedAssetId(asset.id);
                      setLimitPrice(asset.lastPrice);
                    }}
                    className={`rounded-[1.75rem] border bg-surface p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lift ${
                      selectedAsset?.id === asset.id ? "border-brand ring-4 ring-brand/25" : "border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="h-11 w-11 rounded-2xl border border-border" style={{ background: asset.color }} />
                        <div>
                          <p className="font-bold">{asset.name}</p>
                          <p className="text-sm text-muted">{asset.category}</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-brand px-2 py-1 text-xs font-black text-foreground">
                        {levelCopy[asset.level].badge}
                      </span>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Last price</p>
                        <p className="text-2xl font-bold">{asset.lastPrice}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Status</p>
                        <p className="font-bold capitalize">{asset.status}</p>
                      </div>
                      <p className={`font-bold ${assetChange >= 0 ? "text-positive" : "text-danger"}`}>
                        {formatPercent(assetChange)}
                      </p>
                    </div>
                  </button>
                );
              }) : (
                <p className="rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">
                  No markets match that search.
                </p>
              )}
            </div>
          ) : null}

          {activeTab === "drop" ? (
            <div className="space-y-5">
              <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-3xl font-black">Drops</h2>
                    <p className="mt-1 text-sm text-muted">The top Survey events keep racing until the hourly timer hits zero.</p>
                  </div>
                  <span className="w-fit rounded-full bg-brand px-3 py-1 text-xs font-black">
                    {formatClock(nextDropTime - now)}
                  </span>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {upcomingDrops.length ? upcomingDrops.map((drop) => (
                  <DropTimingCard
                    key={drop.id}
                    drop={drop}
                    now={now}
                    canRemove={isAdmin}
                    onRemove={() => {
                      if (!isAdmin) {
                        setNotice("Not authorized.");
                        return;
                      }

                      setSkippedDropSuggestionIds((current) =>
                        current.includes(drop.suggestionId) ? current : [...current, drop.suggestionId],
                      );
                      setNotice(`${drop.title} skipped for this drop cycle.`);
                    }}
                  />
                )) : (
                  <p className="rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">
                    No eligible survey events yet. Suggestions with votes will fill the next hourly drop batch.
                  </p>
                )}
              </div>
              {activeDrops.length ? (
                <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="text-2xl font-black">Live Drops</h3>
                      <p className="mt-1 text-sm text-muted">Recently launched drops are available to buy below.</p>
                    </div>
                    <span className="w-fit rounded-full bg-brand px-3 py-1 text-xs font-black">
                      {visibleActiveDrops.length}/{activeDrops.length} live
                    </span>
                  </div>
                  <div className="mt-5 rounded-3xl bg-surface-warm p-4">
                    <label className="text-sm font-bold text-muted">
                      Search live drops
                      <input
                        value={dropSearch}
                        onChange={(event) => setDropSearch(event.target.value)}
                        placeholder="Search by name, category, or status"
                        className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                      />
                    </label>
                  </div>
                  <div className="mt-5 grid gap-3 lg:grid-cols-2">
                    {visibleActiveDrops.length ? visibleActiveDrops.map((asset) => (
                      <button
                        key={asset.id}
                        onClick={() => {
                          setSelectedAssetId(asset.id);
                          setLimitPrice(asset.lastPrice);
                        }}
                        className={`rounded-3xl border bg-surface-warm p-4 text-left transition hover:border-brand ${
                          selectedAsset?.id === asset.id ? "border-brand ring-4 ring-brand/25" : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 h-7 w-7 shrink-0 rounded-xl border border-border" style={{ background: asset.color }} />
                            <div className="min-w-0">
                              <p className="truncate font-black">{asset.name}</p>
                              <p className="mt-1 text-sm text-muted">{asset.category}</p>
                            </div>
                          </div>
                          <span className="rounded-full bg-brand px-2 py-1 text-xs font-black">Live</span>
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-quiet">Price</p>
                            <p className="font-bold">{currency(asset.dropPrice)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-quiet">Left</p>
                            <p className="font-bold">{asset.unsoldDropSupply}</p>
                          </div>
                          <div>
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-quiet">Tradable</p>
                            <p className="font-bold">{asset.activeTradableSupply}</p>
                          </div>
                        </div>
                      </button>
                    )) : (
                      <p className="rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">
                        No live drops match that search.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === "trading" ? (
            <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black">Active Trades</h2>
                  <p className="mt-1 text-sm text-muted">Select a live market, then choose buy or sell below.</p>
                </div>
                <span className="w-fit rounded-full bg-brand px-3 py-1 text-xs font-black">
                  {visibleTradingMarkets.length}/{tradingMarkets.length} live
                </span>
              </div>
              <div className="mt-5 rounded-3xl bg-surface-warm p-4">
                <label className="text-sm font-bold text-muted">
                  Search trades
                  <input
                    value={tradeSearch}
                    onChange={(event) => setTradeSearch(event.target.value)}
                    placeholder="Search by name, category, or status"
                    className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                  />
                </label>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {visibleTradingMarkets.length ? visibleTradingMarkets.map((asset) => {
                  const assetChange = asset.previousPrice
                    ? ((asset.lastPrice - asset.previousPrice) / asset.previousPrice) * 100
                    : 0;
                  const assetBuyOrders = getOrderBook(orders, asset.id, "buy");
                  const assetSellOrders = getOrderBook(orders, asset.id, "sell");

                  return (
                    <button
                      key={asset.id}
                      onClick={() => {
                        setSelectedAssetId(asset.id);
                        setLimitPrice(asset.lastPrice);
                      }}
                      className={`rounded-3xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift ${
                        selectedAsset?.id === asset.id ? "border-brand bg-surface-warm ring-4 ring-brand/25" : "border-border bg-background"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-black">{asset.name}</p>
                          <p className="mt-1 text-sm text-muted">{asset.category}</p>
                        </div>
                        <span className={`shrink-0 text-sm font-black ${assetChange >= 0 ? "text-positive" : "text-danger"}`}>
                          {formatPercent(assetChange)}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Last</p>
                          <p className="font-bold">{asset.lastPrice}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Tradable</p>
                          <p className="font-bold">{asset.activeTradableSupply}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Sold</p>
                          <p className="font-bold">
                            {((asset.soldDropSupply / Math.max(1, asset.totalSupply)) * 100).toFixed(0)}%
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                }) : (
                  <p className="rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">
                    {tradingMarkets.length
                      ? "No trade markets match that search."
                      : "No markets are trading yet. Buy from an active drop first to move it into trading."}
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "trading" && visibleAsset ? (
            <MarketLineChart
              asset={visibleAsset}
              history={selectedAssetHistory}
              trades={selectedAssetTrades}
              range={chartRange}
              mode={chartMode}
              now={now}
              onRangeChange={setChartRange}
              onModeChange={setChartMode}
            />
          ) : null}

          {activeTab === "drop" || activeTab === "trading" ? (
          <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
            {visibleAsset ? (
              <>
              <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-3xl font-black">{visibleAsset.name}</h2>
                  <span className="rounded-full bg-brand px-2 py-1 text-xs font-black text-foreground">
                    {levelCopy[visibleAsset.level].label}
                  </span>
                  <span className="rounded-full bg-brand px-2 py-1 text-xs font-black text-foreground">
                    {visibleAsset.status}
                  </span>
                  {isAdmin ? (
                    <button
                      onClick={() => void deleteMarket(visibleAsset.id)}
                      className="rounded-full border border-border px-3 py-1 text-xs font-bold text-danger transition hover:border-danger"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Price</p>
                  <p className="text-2xl font-bold">{visibleAsset.lastPrice}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Move</p>
                  <p className={`text-2xl font-bold ${change >= 0 ? "text-positive" : "text-danger"}`}>
                    {formatPercent(change)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Vol</p>
                  <p className="text-2xl font-bold">{formatVolatility(visibleAsset.volatility)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">
                    {activeTab === "trading" ? "Tradable" : "Unsold"}
                  </p>
                  <p className="text-2xl font-bold">
                    {activeTab === "trading" ? visibleAsset.activeTradableSupply : visibleAsset.unsoldDropSupply}
                  </p>
                </div>
              </div>
            </div>

            {activeTab === "drop" && visibleAsset.status === "drop" ? (
              <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
                <form onSubmit={buyFromDrop} className="rounded-3xl border border-border p-4">
                  <h3 className="font-black">Initial Drop</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-bold text-muted">
                      Quantity
                      <input
                        value={dropQuantity}
                        onChange={(event) => setDropQuantity(event.target.value === "" ? "" : Number(event.target.value))}
                        min={1}
                        max={Math.min(visibleAsset.remainingDropSupply, selectedDropLimitRemaining)}
                        type="number"
                        className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-base outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                      />
                    </label>
                    <div className="rounded-2xl bg-surface-warm p-3 text-sm leading-6 text-muted">
                      <p>Price: {currency(visibleAsset.dropPrice)}</p>
                      <p>Total: {currency(Math.min(numericInputValue(dropQuantity), selectedDropLimitRemaining, visibleAsset.remainingDropSupply) * visibleAsset.dropPrice)}</p>
                      <p>Limit: 5% per user ({dropPurchaseLimit(visibleAsset)} max)</p>
                      <p>Remaining: {visibleAsset.unsoldDropSupply}</p>
                      <p>Tradable after purchase: {visibleAsset.activeTradableSupply + Math.min(numericInputValue(dropQuantity), selectedDropLimitRemaining, visibleAsset.remainingDropSupply)}</p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-border p-3">
                    <div className="flex justify-between text-xs font-bold uppercase tracking-[0.12em] text-quiet">
                      <span>Purchased</span>
                      <span>{((visibleAsset.soldDropSupply / Math.max(1, visibleAsset.totalSupply)) * 100).toFixed(0)}% sold</span>
                    </div>
                    <div className="mt-2 h-3 overflow-hidden rounded-full bg-surface-soft">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${(visibleAsset.soldDropSupply / Math.max(1, visibleAsset.totalSupply)) * 100}%` }}
                      />
                    </div>
                    <p className="mt-2 text-sm font-bold text-muted">
                      You can still buy {selectedDropLimitRemaining} from this drop. Only purchased units become tradable.
                    </p>
                  </div>
                  <button className="mt-4 w-full rounded-2xl bg-brand px-4 py-3 font-black text-foreground transition hover:-translate-y-0.5 hover:bg-brand-hover">
                    Buy from drop
                  </button>
                  <p className="mt-3 min-h-12 rounded-2xl bg-surface-warm p-3 text-sm font-semibold leading-6 text-muted">
                    {notice}
                  </p>
                </form>
                <div className="rounded-3xl border border-border p-4">
                  <h3 className="font-black">Drop Supply</h3>
                  <div className="mt-4 rounded-2xl bg-surface-warm p-3 text-sm leading-6 text-muted">
                    <p>Total drop supply: {visibleAsset.totalSupply}</p>
                    <p>Sold drop supply: {visibleAsset.soldDropSupply}</p>
                    <p>Unsold drop supply: {visibleAsset.unsoldDropSupply}</p>
                    <p>Active tradable supply: {visibleAsset.activeTradableSupply}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "trading" ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
              <form onSubmit={placeOrder} className="rounded-3xl border border-border p-4">
                <div className="flex rounded-2xl bg-surface-warm p-1">
                  {(["buy", "sell"] as Side[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSide(option)}
                      className={`flex-1 rounded-xl px-3 py-2 text-sm font-black capitalize transition ${
                        side === option ? "bg-brand shadow-card" : "text-muted"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-bold text-muted">
                    Quantity
                    <input
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value === "" ? "" : Number(event.target.value))}
                      min={1}
                      type="number"
                      className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-base outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                    />
                  </label>
                  <label className="text-sm font-bold text-muted">
                    Limit price
                    <input
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(event.target.value === "" ? "" : Number(event.target.value))}
                      min={1}
                      type="number"
                      className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-base outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-2xl bg-surface-warm p-3 text-sm leading-6 text-muted">
                  <p>Best bid: {bestBid ? currency(bestBid) : "none"}</p>
                  <p>Best ask: {bestAsk ? currency(bestAsk) : "none"}</p>
                  <p>Active tradable supply: {visibleAsset.activeTradableSupply}</p>
                  <p>Estimated max value: {currency(numericInputValue(quantity) * numericInputValue(limitPrice))}</p>
                  <p>Your shares: {selectedHolding.quantity}</p>
                </div>

                <button className="mt-4 w-full rounded-2xl bg-brand px-4 py-3 font-black text-foreground transition hover:-translate-y-0.5 hover:bg-brand-hover">
                  Place {side} order
                </button>
                <p className="mt-3 min-h-12 rounded-2xl bg-surface-warm p-3 text-sm font-semibold leading-6 text-muted">
                  {notice}
                </p>
              </form>

              <div className="grid gap-4">
                <div className="rounded-3xl border border-border p-4">
                  <h3 className="font-black">Order Book</h3>
                  <div className="mt-3 grid max-h-64 grid-cols-2 gap-3 overflow-y-auto pr-1">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-foreground">Bids</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 px-2 text-xs font-bold uppercase tracking-[0.12em] text-quiet">
                        <span>Price</span>
                        <span className="text-right">Qty</span>
                      </div>
                      <div className="mt-1 space-y-2">
                        {buyOrders.map((order) => (
                          <div key={order.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-2xl bg-surface-warm px-3 py-2 text-sm">
                            <span>{order.limitPrice}</span>
                            <span className="text-right">{order.remaining}</span>
                            {authUser?.uid === order.userId ? (
                              <button
                                onClick={() => void cancelOrder(order.id)}
                                className="rounded-xl border border-border px-2 py-1 text-xs font-bold text-danger hover:border-danger"
                              >
                                Cancel
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-danger">Asks</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 px-2 text-xs font-bold uppercase tracking-[0.12em] text-quiet">
                        <span>Price</span>
                        <span className="text-right">Qty</span>
                      </div>
                      <div className="mt-1 space-y-2">
                        {sellOrders.map((order) => (
                          <div key={order.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-2xl bg-red-50 px-3 py-2 text-sm">
                            <span>{order.limitPrice}</span>
                            <span className="text-right">{order.remaining}</span>
                            {authUser?.uid === order.userId ? (
                              <button
                                onClick={() => void cancelOrder(order.id)}
                                className="rounded-xl border border-border px-2 py-1 text-xs font-bold text-danger hover:border-danger"
                              >
                                Cancel
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-border p-4">
                  <h3 className="font-black">Recent Trades</h3>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs font-bold uppercase tracking-[0.12em] text-quiet">
                    <span>Quantity</span>
                    <span>Price</span>
                    <span>Buyer</span>
                  </div>
                  <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                    {assetTrades.length ? (
                      assetTrades.map((trade) => (
                        <div key={trade.id} className="grid grid-cols-3 items-center gap-3 rounded-2xl bg-surface-warm px-3 py-2 text-sm">
                          <span>{trade.quantity}</span>
                          <span className="font-bold">{trade.price}</span>
                          <span className="truncate text-muted">{trade.buyer}</span>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-2xl bg-surface-warm px-3 py-3 text-sm text-muted">
                        No trades yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            ) : null}
              </>
            ) : (
              <p className="rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">
                {activeTab === "drop" ? "No active drop selected." : "No market selected."}
              </p>
            )}
          </div>
          ) : null}
          {activeTab === "portfolio" ? (
          <>
          <PortfolioDonut slices={portfolioSlices} />
          <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
            <h2 className="text-2xl font-black">Portfolio Holdings</h2>
            <div className="mt-5 space-y-3">
              {portfolioAssets.length ? portfolioAssets.map((asset) => {
                const holding = holdings[asset.id] ?? { quantity: 0, averagePrice: 0 };
                const profit = holding.quantity * (asset.lastPrice - holding.averagePrice);

                return (
                  <div key={asset.id} className="rounded-3xl border border-border bg-surface-warm p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{asset.name}</p>
                        <p className="text-sm text-muted">{holding.quantity} shares at avg {holding.averagePrice.toFixed(0)}</p>
                      </div>
                      <p className={`font-bold ${profit >= 0 ? "text-positive" : "text-danger"}`}>
                        {profit >= 0 ? "+" : ""}
                        {profit.toFixed(0)}
                      </p>
                    </div>
                  </div>
                );
              }) : (
                <p className="rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">No holdings.</p>
              )}
            </div>
          </div>
          </>
          ) : null}

          {activeTab === "account" ? (
            <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
              <h2 className="text-2xl font-black">Account</h2>
              <div className="mt-4 rounded-3xl bg-surface-warm p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Coins</p>
                <p className="mt-1 text-2xl font-bold">{coinsReady ? currency(coins) : "Loading"}</p>
              </div>
              <div className="mt-3 rounded-3xl border border-border p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Signed in as</p>
                <p className="mt-1 truncate font-bold">{accountName}</p>
              </div>
              <button
                onClick={handleSignOut}
                className="mt-4 w-full rounded-2xl bg-brand px-4 py-3 font-black text-foreground transition hover:bg-brand-hover"
              >
                Sign out
              </button>
              {isAdmin ? (
                <button
                  onClick={() => void resetEconomy()}
                  className="mt-3 w-full rounded-2xl border border-danger px-4 py-3 font-bold text-danger transition hover:bg-red-50"
                >
                  Reset everything
                </button>
              ) : null}
            </div>
          ) : null}
            </div>

            <aside className="space-y-5">
              <div className="rounded-[2rem] border border-border bg-surface p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Coins balance</p>
                    <p className="mt-2 text-3xl font-black">{coinsReady ? currency(coins) : "Loading"}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${dashboardChange >= 0 ? "bg-brand text-foreground" : "bg-red-50 text-danger"}`}>
                    {formatPercent(dashboardChange)}
                  </span>
                </div>
                <div className="mt-5 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-muted">Daily change</p>
                    <p className={`text-lg font-black ${dashboardChange >= 0 ? "text-positive" : "text-danger"}`}>{formatPercent(dashboardChange)}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-border bg-surface p-5 shadow-card">
                <div className="flex items-center justify-between">
                  <h2 className="font-black">Trending Markets</h2>
                  <span className="rounded-full bg-brand px-2 py-1 text-xs font-black">Live</span>
                </div>
                <div className="mt-4 space-y-3">
                  {trendingMarkets.length ? trendingMarkets.map((asset) => {
                    const assetChange = asset.previousPrice
                      ? ((asset.lastPrice - asset.previousPrice) / asset.previousPrice) * 100
                      : 0;

                    return (
                      <button
                        key={asset.id}
                        onClick={() => {
                          setSelectedAssetId(asset.id);
                          setActiveTab(asset.status === "drop" ? "drop" : "trading");
                          setLimitPrice(asset.lastPrice);
                        }}
                        className="grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-surface-warm"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold">{asset.name}</span>
                          <span className="block text-xs text-muted">Vol {asset.volume}</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-sm font-black">{asset.lastPrice}</span>
                          <span className={`block text-xs font-bold ${assetChange >= 0 ? "text-positive" : "text-danger"}`}>{formatPercent(assetChange)}</span>
                        </span>
                      </button>
                    );
                  }) : (
                    <p className="rounded-2xl bg-surface-warm p-3 text-sm text-muted">No trending markets yet.</p>
                  )}
                </div>
              </div>

              <div className="rounded-[2rem] border border-border bg-surface p-5 shadow-card">
                <h2 className="font-black">Your Active Positions</h2>
                <div className="mt-4 space-y-3">
                  {activePositions.length ? activePositions.map(({ asset, holding, gain }) => (
                    <div key={asset.id} className="rounded-2xl bg-surface-warm p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">{asset.name}</p>
                          <p className="mt-1 text-xs text-muted">Yes side · {holding.quantity} shares</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black">{currency(holding.quantity * asset.lastPrice)}</p>
                          <p className={`text-xs font-bold ${gain >= 0 ? "text-positive" : "text-danger"}`}>{gain >= 0 ? "+" : ""}{gain.toFixed(0)}</p>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <p className="rounded-2xl bg-surface-warm p-3 text-sm text-muted">No active positions.</p>
                  )}
                </div>
              </div>

              <div className="rounded-[2rem] border border-border bg-surface p-5 shadow-card">
                <h2 className="font-black">Recent Activity</h2>
                <div className="mt-4 space-y-3">
                  {recentActivity.length ? recentActivity.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-surface-warm p-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-sm font-black">B</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">{item.label}</span>
                        <span className="block truncate text-xs text-muted">{item.detail}</span>
                      </span>
                    </div>
                  )) : (
                    <p className="rounded-2xl bg-surface-warm p-3 text-sm text-muted">No activity yet.</p>
                  )}
                </div>
              </div>
            </aside>
          </section>
        </div>
      </div>
    </main>
  );
}
