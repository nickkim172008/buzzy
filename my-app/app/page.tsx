"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { firebaseConfigIsReady, getFirebaseAuth, getFirebaseDb, googleProvider } from "@/lib/firebase";

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
  userId: string;
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
  buyerId: string;
  buyer: string;
  sellerId: string;
  seller: string;
  price: number;
  quantity: number;
  createdAt: number;
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
    <main className="min-h-screen bg-[#f7f3ea] text-[#1f2933]">
      <section className="mx-auto grid min-h-screen max-w-7xl items-center gap-8 px-5 py-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#8b5d33]">Buzzly accounts</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-normal text-[#16202a] md:text-6xl">
            Sign in.
          </h1>
        </div>

        <div className="rounded-lg border border-[#d9d2c3] bg-white p-5 shadow-sm md:p-6">
          <div className="rounded-md bg-[#faf7ef] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8b5d33]">Account access</p>
            <h2 className="mt-2 text-2xl font-bold">Continue with Google</h2>
          </div>

          <button
            onClick={onSignIn}
            disabled={!authReady || configMissing}
            className="mt-5 flex w-full items-center justify-center gap-3 rounded-md bg-[#1f2933] px-4 py-3 font-bold text-white transition hover:bg-[#354353] disabled:cursor-not-allowed disabled:bg-[#9aa3ad]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded bg-white text-sm font-bold text-[#1f2933]">
              G
            </span>
            {authReady ? "Sign in with Google" : "Loading Firebase"}
          </button>

          {configMissing ? (
            <div className="mt-4 rounded-md bg-[#fff7ed] p-3 text-sm font-semibold leading-6 text-[#9a3412]">
              Firebase is not configured yet. Add your project values to `.env.local`, then restart the dev server.
            </div>
          ) : null}

          {authError ? (
            <div className="mt-4 rounded-md bg-[#fff1ee] p-3 text-sm font-semibold leading-6 text-[#b42318]">
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
  const [holdings, setHoldings] = useState<Record<string, Holding>>({});
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [side, setSide] = useState<Side>("buy");
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState(1);
  const [coins, setCoins] = useState(STARTING_COINS);
  const [notice, setNotice] = useState("Ready.");
  const [marketName, setMarketName] = useState("");
  const [marketCategory, setMarketCategory] = useState("");
  const [marketLevel, setMarketLevel] = useState<MarketLevel>("community");
  const [marketPrice, setMarketPrice] = useState(1);
  const [marketColor, setMarketColor] = useState("#1f2933");
  const accountName = authUser ? userLabel(authUser) : "You";

  useEffect(() => {
    const auth = getFirebaseAuth();

    if (!auth) {
      return;
    }

    return onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setCoinsReady(false);
      setAuthReady(true);
    });
  }, []);

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
          return;
        }

        const savedCoins = snapshot.data().coins;
        setCoins(typeof savedCoins === "number" ? savedCoins : STARTING_COINS);
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
            volatility: typeof data.volatility === "number" ? data.volatility : 1,
            lastPrice: typeof data.lastPrice === "number" ? data.lastPrice : 1,
            previousPrice: typeof data.previousPrice === "number" ? data.previousPrice : 1,
            volume: typeof data.volume === "number" ? data.volume : 0,
            supply: typeof data.supply === "number" ? data.supply : 0,
            description: typeof data.description === "string" ? data.description : "",
            signal: typeof data.signal === "string" ? data.signal : "",
            color: typeof data.color === "string" ? data.color : "#1f2933",
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

    const unsubscribeHoldings = onSnapshot(
      collection(db, "users", authUser.uid, "holdings"),
      (snapshot) => {
        setHoldings(Object.fromEntries(snapshot.docs.map((holdingDoc) => {
          const data = holdingDoc.data();

          return [
            holdingDoc.id,
            {
              quantity: typeof data.quantity === "number" ? data.quantity : 0,
              averagePrice: typeof data.averagePrice === "number" ? data.averagePrice : 0,
            } satisfies Holding,
          ];
        })));
      },
      (error) => setNotice(error.message),
    );

    return () => {
      unsubscribeMarkets();
      unsubscribeOrders();
      unsubscribeTrades();
      unsubscribeHoldings();
    };
  }, [authUser]);

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
  }, [authUser]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !authUser) {
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

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    const cleanName = marketName.trim();
    const cleanCategory = marketCategory.trim();
    const cleanPrice = Math.max(1, Math.floor(marketPrice));

    if (!cleanName || !cleanCategory) {
      setNotice("Name and category required.");
      return;
    }

    const marketRef = await addDoc(collection(db, "markets"), {
      name: cleanName,
      category: cleanCategory,
      level: marketLevel,
      volatility: 1,
      lastPrice: cleanPrice,
      previousPrice: cleanPrice,
      volume: 0,
      supply: 0,
      description: "",
      signal: "",
      color: marketColor,
      createdBy: authUser.uid,
      createdByName: accountName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    setSelectedAssetId(marketRef.id);
    setLimitPrice(cleanPrice);
    setMarketName("");
    setMarketCategory("");
    setMarketPrice(1);
    setNotice("Market created.");
  }

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId);
  const selectedAssetOrderId = selectedAsset?.id ?? "";
  const buyOrders = selectedAsset ? getOrderBook(orders, selectedAssetOrderId, "buy") : [];
  const sellOrders = selectedAsset ? getOrderBook(orders, selectedAssetOrderId, "sell") : [];
  const assetTrades = trades.filter((trade) => trade.assetId === selectedAssetOrderId).slice(0, 6);
  const bestBid = buyOrders[0]?.limitPrice;
  const bestAsk = sellOrders[0]?.limitPrice;
  const selectedHolding = selectedAsset ? holdings[selectedAsset.id] ?? { quantity: 0, averagePrice: 0 } : { quantity: 0, averagePrice: 0 };
  const change = selectedAsset && selectedAsset.previousPrice
    ? ((selectedAsset.lastPrice - selectedAsset.previousPrice) / selectedAsset.previousPrice) * 100
    : 0;

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

    if (!coinsReady) {
      setNotice("Loading balance.");
      return;
    }

    const cleanQuantity = Math.max(1, Math.floor(quantity));
    const cleanLimit = Math.max(1, Math.floor(limitPrice));
    const createdAt = Math.floor(event.timeStamp);

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
      assetId: selectedAsset.id,
      userId: authUser.uid,
      user: accountName,
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
        matchedOrders.push(match);
        remaining -= tradeQuantity;
        nextCoins += refund;
        nextHoldings[selectedAsset.id] = applyTradeToHolding(nextHoldings[selectedAsset.id], tradeQuantity, tradePrice);
        nextTrades.push({
          id: `trade-${createdAt}-${match.id}`,
          assetId: selectedAsset.id,
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
        matchedOrders.push(match);
        remaining -= tradeQuantity;
        nextCoins += tradeQuantity * tradePrice;
        nextTrades.push({
          id: `trade-${createdAt}-${match.id}`,
          assetId: selectedAsset.id,
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

    const db = getFirebaseDb();

    if (db) {
      const batch = writeBatch(db);

      if (incoming.remaining > 0) {
        batch.set(doc(collection(db, "orders")), {
          assetId: incoming.assetId,
          userId: incoming.userId,
          user: incoming.user,
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

      batch.set(
        doc(db, "users", authUser.uid, "holdings", selectedAsset.id),
        {
          quantity: nextHoldings[selectedAsset.id]?.quantity ?? 0,
          averagePrice: nextHoldings[selectedAsset.id]?.averagePrice ?? 0,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      if (latestTrade) {
        batch.update(doc(db, "markets", selectedAsset.id), {
          previousPrice: selectedAsset.lastPrice,
          lastPrice: latestTrade.price,
          volume: selectedAsset.volume + nextTrades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    setOrders(nextOrders.filter((order) => order.remaining > 0));
    setTrades([...nextTrades.reverse(), ...trades]);
    setHoldings(nextHoldings);
    setCoins(nextCoins);
    void saveHolding(selectedAsset.id, nextHoldings[selectedAsset.id] ?? { quantity: 0, averagePrice: 0 });
    setAssets((currentAssets) =>
      currentAssets.map((asset) =>
        asset.id === selectedAsset.id && latestTrade
          ? {
              ...asset,
              previousPrice: asset.lastPrice,
              lastPrice: latestTrade.price,
              volume: asset.volume + nextTrades.reduce((sum, trade) => sum + trade.price * trade.quantity, 0),
            }
          : asset,
      ),
    );

    const matchedQuantity = cleanQuantity - remaining;
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
    <main className="min-h-screen bg-[#f7f3ea] text-[#1f2933]">
      <section className="border-b border-[#d9d2c3] bg-[#faf7ef]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#8b5d33]">Buzzly</p>
            <h1 className="mt-2 text-4xl font-bold tracking-normal text-[#16202a] md:text-5xl">
              Trade the hype.
            </h1>
          </div>
          <div className="grid min-w-64 gap-3 rounded-lg border border-[#d9d2c3] bg-white p-4 shadow-sm sm:grid-cols-2 md:min-w-[22rem]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7d8790]">Coins</p>
              <p className="mt-1 text-2xl font-bold">{coinsReady ? currency(coins) : "Loading"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7d8790]">Account</p>
              <p className="mt-1 truncate text-base font-bold">{accountName}</p>
              <button
                onClick={handleSignOut}
                className="mt-2 rounded-md border border-[#d9d2c3] px-3 py-1.5 text-sm font-bold transition hover:border-[#1f2933]"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[1.1fr_1.6fr_0.95fr]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-[#d9d2c3] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Markets</h2>
            {assets.length ? null : (
              <p className="mt-4 rounded-md bg-[#faf7ef] px-3 py-3 text-sm text-[#606b76]">No markets.</p>
            )}
          </div>

          <form onSubmit={createMarket} className="rounded-lg border border-[#d9d2c3] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Create Market</h2>
            <div className="mt-4 grid gap-3">
              <label className="text-sm font-semibold">
                Name
                <input
                  value={marketName}
                  onChange={(event) => setMarketName(event.target.value)}
                  className="mt-2 w-full rounded-md border border-[#d9d2c3] px-3 py-2 outline-none focus:border-[#1f2933]"
                />
              </label>
              <label className="text-sm font-semibold">
                Category
                <input
                  value={marketCategory}
                  onChange={(event) => setMarketCategory(event.target.value)}
                  className="mt-2 w-full rounded-md border border-[#d9d2c3] px-3 py-2 outline-none focus:border-[#1f2933]"
                />
              </label>
              <label className="text-sm font-semibold">
                Level
                <select
                  value={marketLevel}
                  onChange={(event) => setMarketLevel(event.target.value as MarketLevel)}
                  className="mt-2 w-full rounded-md border border-[#d9d2c3] bg-white px-3 py-2 outline-none focus:border-[#1f2933]"
                >
                  {(Object.keys(levelCopy) as MarketLevel[]).map((level) => (
                    <option key={level} value={level}>
                      {levelCopy[level].label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <label className="text-sm font-semibold">
                  Price
                  <input
                    value={marketPrice}
                    onChange={(event) => setMarketPrice(Number(event.target.value))}
                    min={1}
                    type="number"
                    className="mt-2 w-full rounded-md border border-[#d9d2c3] px-3 py-2 outline-none focus:border-[#1f2933]"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Color
                  <input
                    value={marketColor}
                    onChange={(event) => setMarketColor(event.target.value)}
                    type="color"
                    className="mt-2 h-10 w-12 rounded-md border border-[#d9d2c3] bg-white p-1"
                  />
                </label>
              </div>
            </div>
            <button className="mt-4 w-full rounded-md bg-[#1f2933] px-4 py-3 font-bold text-white transition hover:bg-[#354353]">
              Create
            </button>
          </form>
        </aside>

        <section className="space-y-5">
          {assets.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {assets.map((asset) => {
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
                    className={`rounded-lg border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                      selectedAsset?.id === asset.id ? "border-[#1f2933]" : "border-[#d9d2c3]"
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
          ) : null}

          <div className="rounded-lg border border-[#d9d2c3] bg-white p-5 shadow-sm">
            {selectedAsset ? (
              <>
              <div className="flex flex-col gap-4 border-b border-[#e7dfd0] pb-5 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-3xl font-bold">{selectedAsset.name}</h2>
                  <span className="rounded-full bg-[#edf7f4] px-2 py-1 text-xs font-bold text-[#0f766e]">
                    {levelCopy[selectedAsset.level].label}
                  </span>
                </div>
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
                        No trades yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
              </>
            ) : (
              <p className="rounded-md bg-[#faf7ef] px-3 py-3 text-sm text-[#606b76]">No market selected.</p>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-[#d9d2c3] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Portfolio</h2>
            <div className="mt-4 space-y-3">
              {assets.length ? assets.map((asset) => {
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
              }) : (
                <p className="rounded-md bg-[#faf7ef] px-3 py-3 text-sm text-[#606b76]">No holdings.</p>
              )}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
