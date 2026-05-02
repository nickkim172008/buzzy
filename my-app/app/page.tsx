"use client";

import { FormEvent, useMemo, useState } from "react";

type MarketLevel = "admin" | "community" | "private";
type Side = "buy" | "sell";
type OrderStatus = "open" | "filled" | "partially_filled";

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
};

type Order = {
  id: string;
  assetId: string;
  user: string;
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
  buyer: string;
  seller: string;
  price: number;
  quantity: number;
  createdAt: number;
};

type Proposal = {
  id: string;
  name: string;
  creator: string;
  level: MarketLevel;
  votes: number;
  status: "approved" | "voting" | "private";
  note: string;
};

const levelCopy: Record<
  MarketLevel,
  { label: string; badge: string; description: string; risk: string }
> = {
  admin: {
    label: "Admin Approved",
    badge: "Stable",
    description: "Curated markets approved by the team with cleaner rules and lower volatility.",
    risk: "Low volatility",
  },
  community: {
    label: "Community Verified",
    badge: "Voted",
    description: "Markets created by users and unlocked after enough community votes.",
    risk: "Medium volatility",
  },
  private: {
    label: "Private",
    badge: "Custom",
    description: "Friend-group markets that anyone can create, with thinner books and higher swings.",
    risk: "High volatility",
  },
};

const initialAssets: Asset[] = [
  {
    id: "coachella",
    name: "Coachella 2026",
    category: "Event",
    level: "admin",
    volatility: 0.8,
    lastPrice: 112,
    previousPrice: 104,
    volume: 18340,
    supply: 10000,
    description: "Hype shares for lineup rumors, resale demand, and festival attention.",
    signal: "Lineup rumor activity is climbing.",
    color: "#e44d26",
  },
  {
    id: "nike-dunk",
    name: "Nike Dunk Restock",
    category: "Product",
    level: "community",
    volatility: 1.35,
    lastPrice: 87,
    previousPrice: 94,
    volume: 9210,
    supply: 8000,
    description: "A community-voted market for sneaker restock hype and resale buzz.",
    signal: "Verified by 182 votes.",
    color: "#0f9f8f",
  },
  {
    id: "drake-album",
    name: "Drake Album Drop",
    category: "Music",
    level: "admin",
    volatility: 0.95,
    lastPrice: 128,
    previousPrice: 119,
    volume: 22480,
    supply: 12000,
    description: "Tracks cultural momentum around a possible major album release.",
    signal: "Mentions up after studio photos.",
    color: "#7c3aed",
  },
  {
    id: "trump-buzz",
    name: "Trump Media Buzz",
    category: "Public Figure",
    level: "community",
    volatility: 1.55,
    lastPrice: 141,
    previousPrice: 132,
    volume: 31750,
    supply: 15000,
    description: "A voted public-interest market for media attention and cultural momentum.",
    signal: "News volume is elevated.",
    color: "#2563eb",
  },
  {
    id: "friend-trip",
    name: "Private: Cabo Trip",
    category: "Private",
    level: "private",
    volatility: 2.15,
    lastPrice: 62,
    previousPrice: 75,
    volume: 1180,
    supply: 1200,
    description: "A friend-created market with lower liquidity and higher price swings.",
    signal: "Only 8 traders in this room.",
    color: "#d97706",
  },
];

const initialOrders: Order[] = [
  { id: "o1", assetId: "coachella", user: "Maya", side: "sell", limitPrice: 115, quantity: 20, remaining: 20, status: "open", createdAt: 1 },
  { id: "o2", assetId: "coachella", user: "Noah", side: "sell", limitPrice: 121, quantity: 35, remaining: 35, status: "open", createdAt: 2 },
  { id: "o3", assetId: "coachella", user: "Ari", side: "buy", limitPrice: 108, quantity: 18, remaining: 18, status: "open", createdAt: 3 },
  { id: "o4", assetId: "coachella", user: "Kai", side: "buy", limitPrice: 102, quantity: 42, remaining: 42, status: "open", createdAt: 4 },
  { id: "o5", assetId: "nike-dunk", user: "Maya", side: "sell", limitPrice: 91, quantity: 30, remaining: 30, status: "open", createdAt: 5 },
  { id: "o6", assetId: "nike-dunk", user: "Leo", side: "buy", limitPrice: 82, quantity: 25, remaining: 25, status: "open", createdAt: 6 },
  { id: "o7", assetId: "drake-album", user: "Sam", side: "sell", limitPrice: 132, quantity: 14, remaining: 14, status: "open", createdAt: 7 },
  { id: "o8", assetId: "drake-album", user: "Ivy", side: "buy", limitPrice: 125, quantity: 24, remaining: 24, status: "open", createdAt: 8 },
  { id: "o9", assetId: "trump-buzz", user: "Zara", side: "sell", limitPrice: 148, quantity: 16, remaining: 16, status: "open", createdAt: 9 },
  { id: "o10", assetId: "trump-buzz", user: "Owen", side: "buy", limitPrice: 137, quantity: 31, remaining: 31, status: "open", createdAt: 10 },
  { id: "o11", assetId: "friend-trip", user: "Nico", side: "sell", limitPrice: 70, quantity: 8, remaining: 8, status: "open", createdAt: 11 },
  { id: "o12", assetId: "friend-trip", user: "Tess", side: "buy", limitPrice: 58, quantity: 12, remaining: 12, status: "open", createdAt: 12 },
];

const initialHoldings: Record<string, Holding> = {
  coachella: { quantity: 16, averagePrice: 101 },
  "nike-dunk": { quantity: 24, averagePrice: 92 },
  "drake-album": { quantity: 8, averagePrice: 117 },
  "trump-buzz": { quantity: 10, averagePrice: 130 },
  "friend-trip": { quantity: 18, averagePrice: 68 },
};

const proposals: Proposal[] = [
  {
    id: "p1",
    name: "GTA 6 Trailer Hype",
    creator: "Admin",
    level: "admin",
    votes: 0,
    status: "approved",
    note: "Clean public source signals and broad interest.",
  },
  {
    id: "p2",
    name: "iPhone Fold Rumors",
    creator: "Community",
    level: "community",
    votes: 236,
    status: "voting",
    note: "Needs 300 votes to become verified.",
  },
  {
    id: "p3",
    name: "Dorm Formal Afterparty",
    creator: "Private room",
    level: "private",
    votes: 12,
    status: "private",
    note: "Only visible to invited traders.",
  },
];

function currency(value: number) {
  return `${Math.round(value).toLocaleString()} coins`;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
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

export default function Home() {
  const [assets, setAssets] = useState(initialAssets);
  const [orders, setOrders] = useState(initialOrders);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [holdings, setHoldings] = useState(initialHoldings);
  const [selectedAssetId, setSelectedAssetId] = useState("coachella");
  const [side, setSide] = useState<Side>("buy");
  const [quantity, setQuantity] = useState(10);
  const [limitPrice, setLimitPrice] = useState(116);
  const [coins, setCoins] = useState(10000);
  const [notice, setNotice] = useState("Ready: place a buy above the best ask or a sell below the best bid to match.");

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) ?? assets[0];
  const buyOrders = useMemo(() => getOrderBook(orders, selectedAsset.id, "buy"), [orders, selectedAsset.id]);
  const sellOrders = useMemo(() => getOrderBook(orders, selectedAsset.id, "sell"), [orders, selectedAsset.id]);
  const assetTrades = trades.filter((trade) => trade.assetId === selectedAsset.id).slice(0, 6);
  const bestBid = buyOrders[0]?.limitPrice;
  const bestAsk = sellOrders[0]?.limitPrice;
  const selectedHolding = holdings[selectedAsset.id] ?? { quantity: 0, averagePrice: 0 };
  const change = ((selectedAsset.lastPrice - selectedAsset.previousPrice) / selectedAsset.previousPrice) * 100;

  const netWorth = useMemo(() => {
    return Object.entries(holdings).reduce((total, [assetId, holding]) => {
      const asset = assets.find((item) => item.id === assetId);
      return total + (asset ? holding.quantity * asset.lastPrice : 0);
    }, coins);
  }, [assets, coins, holdings]);

  function placeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanQuantity = Math.max(1, Math.floor(quantity));
    const cleanLimit = Math.max(1, Math.floor(limitPrice));

    if (side === "buy" && cleanQuantity * cleanLimit > coins) {
      setNotice("Not enough coins for that max bid. Lower the quantity or limit price.");
      return;
    }

    if (side === "sell" && cleanQuantity > selectedHolding.quantity) {
      setNotice("Not enough shares to sell. Private and community markets still need real holdings.");
      return;
    }

    const incoming: Order = {
      id: `user-${Date.now()}`,
      assetId: selectedAsset.id,
      user: "You",
      side,
      limitPrice: cleanLimit,
      quantity: cleanQuantity,
      remaining: cleanQuantity,
      status: "open",
      createdAt: Date.now(),
    };

    const nextOrders = [...orders];
    const nextTrades: Trade[] = [];
    const nextHoldings = { ...holdings };
    let remaining = cleanQuantity;
    let nextCoins = coins;

    if (side === "buy") {
      nextCoins -= cleanQuantity * cleanLimit;
      const matches = nextOrders
        .filter((order) => order.assetId === selectedAsset.id && order.side === "sell" && order.remaining > 0 && order.limitPrice <= cleanLimit)
        .sort((a, b) => a.limitPrice - b.limitPrice || a.createdAt - b.createdAt);

      for (const match of matches) {
        if (remaining <= 0) break;
        const tradeQuantity = Math.min(remaining, match.remaining);
        const tradePrice = match.limitPrice;
        const total = tradeQuantity * tradePrice;
        const refund = tradeQuantity * (cleanLimit - tradePrice);

        match.remaining -= tradeQuantity;
        match.status = match.remaining === 0 ? "filled" : "partially_filled";
        remaining -= tradeQuantity;
        nextCoins += refund;
        nextHoldings[selectedAsset.id] = applyTradeToHolding(nextHoldings[selectedAsset.id], tradeQuantity, tradePrice);
        nextTrades.push({
          id: `trade-${Date.now()}-${match.id}`,
          assetId: selectedAsset.id,
          buyer: "You",
          seller: match.user,
          price: tradePrice,
          quantity: tradeQuantity,
          createdAt: Date.now(),
        });

        void total;
      }

      incoming.remaining = remaining;
      incoming.status = remaining === 0 ? "filled" : remaining === cleanQuantity ? "open" : "partially_filled";
    } else {
      nextHoldings[selectedAsset.id] = {
        ...selectedHolding,
        quantity: selectedHolding.quantity - cleanQuantity,
      };

      const matches = nextOrders
        .filter((order) => order.assetId === selectedAsset.id && order.side === "buy" && order.remaining > 0 && order.limitPrice >= cleanLimit)
        .sort((a, b) => b.limitPrice - a.limitPrice || a.createdAt - b.createdAt);

      for (const match of matches) {
        if (remaining <= 0) break;
        const tradeQuantity = Math.min(remaining, match.remaining);
        const tradePrice = match.limitPrice;

        match.remaining -= tradeQuantity;
        match.status = match.remaining === 0 ? "filled" : "partially_filled";
        remaining -= tradeQuantity;
        nextCoins += tradeQuantity * tradePrice;
        nextTrades.push({
          id: `trade-${Date.now()}-${match.id}`,
          assetId: selectedAsset.id,
          buyer: match.user,
          seller: "You",
          price: tradePrice,
          quantity: tradeQuantity,
          createdAt: Date.now(),
        });
      }

      incoming.remaining = remaining;
      incoming.status = remaining === 0 ? "filled" : remaining === cleanQuantity ? "open" : "partially_filled";
    }

    if (incoming.remaining > 0) {
      nextOrders.push(incoming);
    }

    const latestTrade = nextTrades.at(-1);
    const volatilityMove = latestTrade ? Math.round(latestTrade.price * selectedAsset.volatility) / 100 : 0;

    setOrders(nextOrders.filter((order) => order.remaining > 0));
    setTrades([...nextTrades.reverse(), ...trades]);
    setHoldings(nextHoldings);
    setCoins(nextCoins);
    setAssets((currentAssets) =>
      currentAssets.map((asset) =>
        asset.id === selectedAsset.id && latestTrade
          ? {
              ...asset,
              previousPrice: asset.lastPrice,
              lastPrice: latestTrade.price,
              volume: asset.volume + nextTrades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0),
              signal: `${levelCopy[asset.level].risk}: last matched trade moved ${volatilityMove.toFixed(2)}x sentiment weight.`,
            }
          : asset,
      ),
    );

    const matchedQuantity = cleanQuantity - remaining;
    if (matchedQuantity > 0 && remaining > 0) {
      setNotice(`${matchedQuantity} shares matched by overlap. ${remaining} shares stayed open at ${cleanLimit}.`);
    } else if (matchedQuantity > 0) {
      setNotice(`${matchedQuantity} shares matched instantly. Price came from the resting order.`);
    } else {
      setNotice(`No overlap yet. Your ${side} order is now open at ${cleanLimit}.`);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f3ea] text-[#1f2933]">
      <section className="border-b border-[#d9d2c3] bg-[#faf7ef]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#8b5d33]">Buzzly</p>
            <h1 className="mt-2 text-4xl font-bold tracking-normal text-[#16202a] md:text-5xl">
              Trade the hype with real order overlap.
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[#5a6470]">
              Admin markets are calmer, community markets are vote-verified, and private markets are higher-volatility rooms. Prices only update after matching buy and sell orders.
            </p>
          </div>
          <div className="grid min-w-64 grid-cols-2 gap-3 rounded-lg border border-[#d9d2c3] bg-white p-4 shadow-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7d8790]">Coins</p>
              <p className="mt-1 text-2xl font-bold">{currency(coins)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7d8790]">Net worth</p>
              <p className="mt-1 text-2xl font-bold">{currency(netWorth)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[1.1fr_1.6fr_0.95fr]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-[#d9d2c3] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Market Levels</h2>
            <div className="mt-4 space-y-3">
              {(Object.keys(levelCopy) as MarketLevel[]).map((level) => (
                <div key={level} className="rounded-md border border-[#e7dfd0] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{levelCopy[level].label}</p>
                    <span className="rounded-full bg-[#f1eadc] px-2 py-1 text-xs font-bold text-[#7a552d]">
                      {levelCopy[level].badge}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#606b76]">{levelCopy[level].description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#d9d2c3] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Proposed Trades</h2>
            <div className="mt-4 space-y-3">
              {proposals.map((proposal) => (
                <div key={proposal.id} className="rounded-md border border-[#e7dfd0] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{proposal.name}</p>
                      <p className="text-sm text-[#606b76]">{levelCopy[proposal.level].label}</p>
                    </div>
                    <span className="rounded-full bg-[#edf7f4] px-2 py-1 text-xs font-bold text-[#0f766e]">
                      {proposal.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#606b76]">{proposal.note}</p>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#8b5d33]">
                    {proposal.votes ? `${proposal.votes} votes` : proposal.creator}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            {assets.map((asset) => {
              const assetChange = ((asset.lastPrice - asset.previousPrice) / asset.previousPrice) * 100;

              return (
                <button
                  key={asset.id}
                  onClick={() => {
                    setSelectedAssetId(asset.id);
                    setLimitPrice(asset.lastPrice);
                  }}
                  className={`rounded-lg border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    selectedAsset.id === asset.id ? "border-[#1f2933]" : "border-[#d9d2c3]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="h-10 w-10 rounded-md" style={{ background: asset.color }} />
                      <div>
                        <p className="font-bold">{asset.name}</p>
                        <p className="text-sm text-[#606b76]">{asset.category}</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-[#f1eadc] px-2 py-1 text-xs font-bold text-[#7a552d]">
                      {levelCopy[asset.level].badge}
                    </span>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7d8790]">Last price</p>
                      <p className="text-2xl font-bold">{asset.lastPrice}</p>
                    </div>
                    <p className={`font-bold ${assetChange >= 0 ? "text-[#0f766e]" : "text-[#b42318]"}`}>
                      {formatPercent(assetChange)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-[#d9d2c3] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 border-b border-[#e7dfd0] pb-5 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-3xl font-bold">{selectedAsset.name}</h2>
                  <span className="rounded-full bg-[#edf7f4] px-2 py-1 text-xs font-bold text-[#0f766e]">
                    {levelCopy[selectedAsset.level].label}
                  </span>
                </div>
                <p className="mt-2 max-w-2xl leading-7 text-[#606b76]">{selectedAsset.description}</p>
                <p className="mt-2 text-sm font-semibold text-[#8b5d33]">{selectedAsset.signal}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-right">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7d8790]">Price</p>
                  <p className="text-2xl font-bold">{selectedAsset.lastPrice}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7d8790]">Move</p>
                  <p className={`text-2xl font-bold ${change >= 0 ? "text-[#0f766e]" : "text-[#b42318]"}`}>
                    {formatPercent(change)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7d8790]">Vol</p>
                  <p className="text-2xl font-bold">{selectedAsset.volatility.toFixed(2)}x</p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
              <form onSubmit={placeOrder} className="rounded-md border border-[#e7dfd0] p-4">
                <div className="flex rounded-md bg-[#f1eadc] p-1">
                  {(["buy", "sell"] as Side[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSide(option)}
                      className={`flex-1 rounded px-3 py-2 text-sm font-bold capitalize transition ${
                        side === option ? "bg-white shadow-sm" : "text-[#66717c]"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Quantity
                    <input
                      value={quantity}
                      onChange={(event) => setQuantity(Number(event.target.value))}
                      min={1}
                      type="number"
                      className="mt-2 w-full rounded-md border border-[#d9d2c3] px-3 py-3 text-base outline-none focus:border-[#1f2933]"
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Limit price
                    <input
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(Number(event.target.value))}
                      min={1}
                      type="number"
                      className="mt-2 w-full rounded-md border border-[#d9d2c3] px-3 py-3 text-base outline-none focus:border-[#1f2933]"
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-md bg-[#faf7ef] p-3 text-sm leading-6 text-[#606b76]">
                  <p>Best bid: {bestBid ? currency(bestBid) : "none"}</p>
                  <p>Best ask: {bestAsk ? currency(bestAsk) : "none"}</p>
                  <p>Estimated max value: {currency(quantity * limitPrice)}</p>
                  <p>Your shares: {selectedHolding.quantity}</p>
                </div>

                <button className="mt-4 w-full rounded-md bg-[#1f2933] px-4 py-3 font-bold text-white transition hover:bg-[#354353]">
                  Place {side} order
                </button>
                <p className="mt-3 min-h-12 rounded-md bg-[#edf7f4] p-3 text-sm font-semibold leading-6 text-[#0f5f59]">
                  {notice}
                </p>
              </form>

              <div className="grid gap-4">
                <div className="rounded-md border border-[#e7dfd0] p-4">
                  <h3 className="font-bold">Order Book</h3>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#0f766e]">Bids</p>
                      <div className="mt-2 space-y-2">
                        {buyOrders.slice(0, 5).map((order) => (
                          <div key={order.id} className="flex justify-between rounded bg-[#edf7f4] px-3 py-2 text-sm">
                            <span>{order.limitPrice}</span>
                            <span>{order.remaining}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#b42318]">Asks</p>
                      <div className="mt-2 space-y-2">
                        {sellOrders.slice(0, 5).map((order) => (
                          <div key={order.id} className="flex justify-between rounded bg-[#fff1ee] px-3 py-2 text-sm">
                            <span>{order.limitPrice}</span>
                            <span>{order.remaining}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-[#e7dfd0] p-4">
                  <h3 className="font-bold">Recent Trades</h3>
                  <div className="mt-3 space-y-2">
                    {assetTrades.length ? (
                      assetTrades.map((trade) => (
                        <div key={trade.id} className="flex items-center justify-between rounded bg-[#faf7ef] px-3 py-2 text-sm">
                          <span>{trade.quantity} shares</span>
                          <span className="font-bold">{trade.price}</span>
                          <span className="text-[#606b76]">{trade.buyer} bought</span>
                        </div>
                      ))
                    ) : (
                      <p className="rounded bg-[#faf7ef] px-3 py-3 text-sm text-[#606b76]">
                        No trades yet. Cross the spread to create the first match.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-[#d9d2c3] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Portfolio</h2>
            <div className="mt-4 space-y-3">
              {assets.map((asset) => {
                const holding = holdings[asset.id] ?? { quantity: 0, averagePrice: 0 };
                const profit = holding.quantity * (asset.lastPrice - holding.averagePrice);

                return (
                  <div key={asset.id} className="rounded-md border border-[#e7dfd0] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{asset.name}</p>
                        <p className="text-sm text-[#606b76]">{holding.quantity} shares at avg {holding.averagePrice.toFixed(0)}</p>
                      </div>
                      <p className={`font-bold ${profit >= 0 ? "text-[#0f766e]" : "text-[#b42318]"}`}>
                        {profit >= 0 ? "+" : ""}
                        {profit.toFixed(0)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-[#d9d2c3] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Matching Rule</h2>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[#606b76]">
              <p>Buy orders match when the bid is greater than or equal to the lowest ask.</p>
              <p>Sell orders match when the ask is less than or equal to the highest bid.</p>
              <p>The resting order sets the trade price, so users get the best available overlap.</p>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
