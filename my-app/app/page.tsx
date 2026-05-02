"use client";

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
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { firebaseConfigIsReady, getFirebaseAuth, getFirebaseDb, googleProvider } from "@/lib/firebase";

type MarketLevel = "admin" | "community" | "private";
type MarketStatus = "drop" | "trading";
type Side = "buy" | "sell";
type OrderStatus = "open" | "filled" | "partially_filled";
type AppTab = "markets" | "create" | "drop" | "trading" | "portfolio" | "account";

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
  remainingDropSupply: number;
  status: MarketStatus;
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

const tabs: { id: AppTab; label: string; mark: string }[] = [
  { id: "markets", label: "Markets", mark: "M" },
  { id: "create", label: "Create", mark: "+" },
  { id: "drop", label: "Drop", mark: "D" },
  { id: "trading", label: "Trade", mark: "T" },
  { id: "portfolio", label: "Portfolio", mark: "P" },
  { id: "account", label: "Account", mark: "A" },
];

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
    <main className="min-h-screen bg-[#f8fafc] text-[#0a0a0a]">
      <section className="mx-auto grid min-h-screen max-w-7xl items-center gap-8 px-5 py-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#ca8a04]">Buzzly accounts</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-bold tracking-normal text-[#0a0a0a] md:text-6xl">
            Sign in.
          </h1>
        </div>

        <div className="rounded-lg border border-[#e5e7eb] bg-white p-5 shadow-sm md:p-6">
          <div className="rounded-md bg-[#fefce8] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#ca8a04]">Account access</p>
            <h2 className="mt-2 text-2xl font-bold">Continue with Google</h2>
          </div>

          <button
            onClick={onSignIn}
            disabled={!authReady || configMissing}
            className="mt-5 flex w-full items-center justify-center gap-3 rounded-md bg-[#0a0a0a] px-4 py-3 font-bold text-white transition hover:bg-[#18181b] disabled:cursor-not-allowed disabled:bg-[#d4d4d8]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded bg-white text-sm font-bold text-[#0a0a0a]">
              G
            </span>
            {authReady ? "Sign in with Google" : "Loading Firebase"}
          </button>

          {configMissing ? (
            <div className="mt-4 rounded-md bg-[#fef3c7] p-3 text-sm font-semibold leading-6 text-[#713f12]">
              Firebase is not configured yet. Add your project values to `.env.local`, then restart the dev server.
            </div>
          ) : null}

          {authError ? (
            <div className="mt-4 rounded-md bg-[#fef2f2] p-3 text-sm font-semibold leading-6 text-[#dc2626]">
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
  const [publicBalances, setPublicBalances] = useState<Record<string, PublicBalance>>({});
  const [publicHoldings, setPublicHoldings] = useState<Record<string, Holding>>({});
  const [savedUserCoins, setSavedUserCoins] = useState<number | null>(null);
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
  const [marketSupply, setMarketSupply] = useState(1000);
  const [marketColor, setMarketColor] = useState("#facc15");
  const [dropQuantity, setDropQuantity] = useState(1);
  const [activeTab, setActiveTab] = useState<AppTab>("markets");
  const accountName = authUser ? userLabel(authUser) : "You";

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
            remainingDropSupply: typeof data.remainingDropSupply === "number" ? data.remainingDropSupply : 0,
            status: data.status === "trading" ? "trading" : "drop",
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
      },
      (error) => setNotice(error.message),
    );

    return () => {
      unsubscribeMarkets();
      unsubscribeOrders();
      unsubscribeTrades();
      unsubscribeHoldings();
      unsubscribeBalances();
      unsubscribePublicHoldings();
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

    const db = getFirebaseDb();

    if (!db) {
      setNotice("Database unavailable.");
      return;
    }

    const cleanName = marketName.trim();
    const cleanCategory = marketCategory.trim();
    const cleanPrice = Math.max(1, Math.floor(marketPrice));
    const cleanSupply = Math.max(1, Math.floor(marketSupply));

    if (!cleanName || !cleanCategory) {
      setNotice("Name and category required.");
      return;
    }

    try {
      const createdAt = Math.floor(event.timeStamp);
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
        remainingDropSupply: cleanSupply,
        status: "drop",
        description: "",
        signal: "",
        color: marketColor,
        createdBy: authUser.uid,
        createdByName: accountName,
        createdAt,
        updatedAt: createdAt,
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

    const cleanQuantity = Math.max(1, Math.floor(dropQuantity));
    const buyQuantity = Math.min(cleanQuantity, selectedAsset.remainingDropSupply);
    const totalCost = buyQuantity * selectedAsset.dropPrice;

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
    const nextStatus: MarketStatus = nextRemainingSupply <= 0 ? "trading" : "drop";

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
      remainingDropSupply: nextRemainingSupply,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    setCoins(nextCoins);
    setHoldings((current) => ({ ...current, [selectedAsset.id]: nextHolding }));
    setDropQuantity(1);
    setNotice(nextStatus === "trading" ? "Drop sold out." : `${buyQuantity} bought.`);
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
    const batch = writeBatch(db);

    ordersSnapshot.docs
      .filter((orderDoc) => orderDoc.data().assetId === assetId)
      .forEach((orderDoc) => batch.delete(doc(db, "orders", orderDoc.id)));

    tradesSnapshot.docs
      .filter((tradeDoc) => tradeDoc.data().assetId === assetId)
      .forEach((tradeDoc) => batch.delete(doc(db, "trades", tradeDoc.id)));

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

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId);
  const activeDrops = assets.filter((asset) => asset.status === "drop" && asset.remainingDropSupply > 0);
  const portfolioAssets = assets.filter((asset) => (holdings[asset.id]?.quantity ?? 0) > 0);
  const visibleAsset =
    activeTab === "drop" && selectedAsset && !activeDrops.some((asset) => asset.id === selectedAsset.id)
      ? undefined
      : selectedAsset;
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

    const tradeAssetId = selectedAsset.id;
    const currentUserId = authUser.uid;
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

    if (db) {
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
      }

      await batch.commit();
    }

    setOrders(nextOrders.filter((order) => order.remaining > 0));
    setTrades([...nextTrades.reverse(), ...trades]);
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
    <main className="min-h-screen bg-[#f8fafc] text-[#0a0a0a]">
      <div className="min-h-screen md:grid md:grid-cols-[5.5rem_1fr]">
        <nav className="sticky top-0 z-10 flex gap-2 border-b border-[#e5e7eb] bg-white px-3 py-3 md:h-screen md:flex-col md:items-center md:border-b-0 md:border-r">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-3 rounded-full px-2 py-2 text-sm font-bold transition md:flex-col md:gap-1 ${
                activeTab === tab.id ? "bg-[#0a0a0a] text-white" : "text-[#52525b] hover:bg-[#fefce8]"
              }`}
              title={tab.label}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full text-base font-black ${
                  activeTab === tab.id ? "bg-[#facc15] text-[#0a0a0a]" : "bg-[#fef08a] text-[#713f12]"
                }`}
              >
                {tab.mark}
              </span>
              <span className="hidden text-xs md:block">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div>
      <section className="border-b border-[#e5e7eb] bg-[#fefce8]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#ca8a04]">Buzzly</p>
            <h1 className="mt-2 text-4xl font-bold tracking-normal text-[#0a0a0a] md:text-5xl">
              Trade the Hype.
            </h1>
          </div>
          <div className="grid min-w-64 gap-3 rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm sm:grid-cols-2 md:min-w-[22rem]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Coins</p>
              <p className="mt-1 text-2xl font-bold">{coinsReady ? currency(coins) : "Loading"}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Account</p>
              <p className="mt-1 truncate text-base font-bold">{accountName}</p>
              <button
                onClick={handleSignOut}
                className="mt-2 rounded-md border border-[#e5e7eb] px-3 py-1.5 text-sm font-bold transition hover:border-[#0a0a0a]"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-5 py-6 lg:grid-cols-1">
        <aside className="space-y-4">
          {activeTab === "markets" ? (
          <div className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Markets</h2>
            {assets.length ? null : (
              <p className="mt-4 rounded-md bg-[#fefce8] px-3 py-3 text-sm text-[#52525b]">No markets.</p>
            )}
          </div>
          ) : null}

          {activeTab === "create" ? (
          <form onSubmit={createMarket} className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Create Market</h2>
            <div className="mt-4 grid gap-3">
              <label className="text-sm font-semibold">
                Name
                <input
                  value={marketName}
                  onChange={(event) => setMarketName(event.target.value)}
                  className="mt-2 w-full rounded-md border border-[#e5e7eb] px-3 py-2 outline-none focus:border-[#0a0a0a]"
                />
              </label>
              <label className="text-sm font-semibold">
                Category
                <input
                  value={marketCategory}
                  onChange={(event) => setMarketCategory(event.target.value)}
                  className="mt-2 w-full rounded-md border border-[#e5e7eb] px-3 py-2 outline-none focus:border-[#0a0a0a]"
                />
              </label>
              <label className="text-sm font-semibold">
                Level
                <select
                  value={marketLevel}
                  onChange={(event) => setMarketLevel(event.target.value as MarketLevel)}
                  className="mt-2 w-full rounded-md border border-[#e5e7eb] bg-white px-3 py-2 outline-none focus:border-[#0a0a0a]"
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
                    className="mt-2 w-full rounded-md border border-[#e5e7eb] px-3 py-2 outline-none focus:border-[#0a0a0a]"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Supply
                  <input
                    value={marketSupply}
                    onChange={(event) => setMarketSupply(Number(event.target.value))}
                    min={1}
                    type="number"
                    className="mt-2 w-full rounded-md border border-[#e5e7eb] px-3 py-2 outline-none focus:border-[#0a0a0a]"
                  />
                </label>
                <label className="text-sm font-semibold">
                  Color
                  <input
                    value={marketColor}
                    onChange={(event) => setMarketColor(event.target.value)}
                    type="color"
                    className="mt-2 h-10 w-12 rounded-md border border-[#e5e7eb] bg-white p-1"
                  />
                </label>
              </div>
            </div>
            <button className="mt-4 w-full rounded-md bg-[#0a0a0a] px-4 py-3 font-bold text-white transition hover:bg-[#18181b]">
              Create
            </button>
          </form>
          ) : null}
        </aside>

        <section className="space-y-5">
          {activeTab === "markets" && assets.length ? (
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
                      selectedAsset?.id === asset.id ? "border-[#0a0a0a]" : "border-[#e5e7eb]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="h-10 w-10 rounded-md" style={{ background: asset.color }} />
                        <div>
                          <p className="font-bold">{asset.name}</p>
                          <p className="text-sm text-[#52525b]">{asset.category}</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-[#fef08a] px-2 py-1 text-xs font-bold text-[#713f12]">
                        {levelCopy[asset.level].badge}
                      </span>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Last price</p>
                        <p className="text-2xl font-bold">{asset.lastPrice}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Status</p>
                        <p className="font-bold capitalize">{asset.status}</p>
                      </div>
                      <p className={`font-bold ${assetChange >= 0 ? "text-[#0a0a0a]" : "text-[#dc2626]"}`}>
                        {formatPercent(assetChange)}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}

          {activeTab === "drop" && activeDrops.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {activeDrops.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => {
                    setSelectedAssetId(asset.id);
                    setLimitPrice(asset.lastPrice);
                  }}
                  className={`rounded-lg border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    selectedAsset?.id === asset.id ? "border-[#0a0a0a]" : "border-[#e5e7eb]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{asset.name}</p>
                      <p className="text-sm text-[#52525b]">{asset.category}</p>
                    </div>
                    <span className="rounded-full bg-[#fef08a] px-2 py-1 text-xs font-bold text-[#713f12]">
                      Drop
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Price</p>
                      <p className="font-bold">{asset.dropPrice}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Left</p>
                      <p className="font-bold">{asset.remainingDropSupply}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Supply</p>
                      <p className="font-bold">{asset.totalSupply}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {activeTab === "drop" || activeTab === "trading" ? (
          <div className="rounded-lg border border-[#e5e7eb] bg-white p-5 shadow-sm">
            {visibleAsset ? (
              <>
              <div className="flex flex-col gap-4 border-b border-[#e5e7eb] pb-5 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-3xl font-bold">{visibleAsset.name}</h2>
                  <span className="rounded-full bg-[#fef9c3] px-2 py-1 text-xs font-bold text-[#0a0a0a]">
                    {levelCopy[visibleAsset.level].label}
                  </span>
                  <span className="rounded-full bg-[#fef08a] px-2 py-1 text-xs font-bold text-[#713f12]">
                    {visibleAsset.status}
                  </span>
                  <button
                    onClick={() => void deleteMarket(visibleAsset.id)}
                    className="rounded-full border border-[#e5e7eb] px-3 py-1 text-xs font-bold text-[#dc2626] transition hover:border-[#dc2626]"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3 text-right">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Price</p>
                  <p className="text-2xl font-bold">{visibleAsset.lastPrice}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Move</p>
                  <p className={`text-2xl font-bold ${change >= 0 ? "text-[#0a0a0a]" : "text-[#dc2626]"}`}>
                    {formatPercent(change)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Vol</p>
                  <p className="text-2xl font-bold">{formatVolatility(visibleAsset.volatility)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Supply</p>
                  <p className="text-2xl font-bold">{visibleAsset.remainingDropSupply}</p>
                </div>
              </div>
            </div>

            {activeTab === "drop" && visibleAsset.status === "drop" ? (
              <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
                <form onSubmit={buyFromDrop} className="rounded-md border border-[#e5e7eb] p-4">
                  <h3 className="font-bold">Initial Drop</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold">
                      Quantity
                      <input
                        value={dropQuantity}
                        onChange={(event) => setDropQuantity(Number(event.target.value))}
                        min={1}
                        max={visibleAsset.remainingDropSupply}
                        type="number"
                        className="mt-2 w-full rounded-md border border-[#e5e7eb] px-3 py-3 text-base outline-none focus:border-[#0a0a0a]"
                      />
                    </label>
                    <div className="rounded-md bg-[#fefce8] p-3 text-sm leading-6 text-[#52525b]">
                      <p>Price: {currency(visibleAsset.dropPrice)}</p>
                      <p>Total: {currency(dropQuantity * visibleAsset.dropPrice)}</p>
                      <p>Remaining: {visibleAsset.remainingDropSupply}</p>
                    </div>
                  </div>
                  <button className="mt-4 w-full rounded-md bg-[#0a0a0a] px-4 py-3 font-bold text-white transition hover:bg-[#18181b]">
                    Buy from drop
                  </button>
                  <p className="mt-3 min-h-12 rounded-md bg-[#fef9c3] p-3 text-sm font-semibold leading-6 text-[#713f12]">
                    {notice}
                  </p>
                </form>
                <div className="rounded-md border border-[#e5e7eb] p-4">
                  <h3 className="font-bold">Drop Supply</h3>
                  <div className="mt-4 rounded-md bg-[#fefce8] p-3 text-sm leading-6 text-[#52525b]">
                    <p>Total supply: {visibleAsset.totalSupply}</p>
                    <p>Remaining: {visibleAsset.remainingDropSupply}</p>
                    <p>Sold: {visibleAsset.totalSupply - visibleAsset.remainingDropSupply}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "trading" ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
              <form onSubmit={placeOrder} className="rounded-md border border-[#e5e7eb] p-4">
                <div className="flex rounded-md bg-[#fef08a] p-1">
                  {(["buy", "sell"] as Side[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSide(option)}
                      className={`flex-1 rounded px-3 py-2 text-sm font-bold capitalize transition ${
                        side === option ? "bg-white shadow-sm" : "text-[#71717a]"
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
                      className="mt-2 w-full rounded-md border border-[#e5e7eb] px-3 py-3 text-base outline-none focus:border-[#0a0a0a]"
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Limit price
                    <input
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(Number(event.target.value))}
                      min={1}
                      type="number"
                      className="mt-2 w-full rounded-md border border-[#e5e7eb] px-3 py-3 text-base outline-none focus:border-[#0a0a0a]"
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-md bg-[#fefce8] p-3 text-sm leading-6 text-[#52525b]">
                  <p>Best bid: {bestBid ? currency(bestBid) : "none"}</p>
                  <p>Best ask: {bestAsk ? currency(bestAsk) : "none"}</p>
                  <p>Estimated max value: {currency(quantity * limitPrice)}</p>
                  <p>Your shares: {selectedHolding.quantity}</p>
                </div>

                <button className="mt-4 w-full rounded-md bg-[#0a0a0a] px-4 py-3 font-bold text-white transition hover:bg-[#18181b]">
                  Place {side} order
                </button>
                <p className="mt-3 min-h-12 rounded-md bg-[#fef9c3] p-3 text-sm font-semibold leading-6 text-[#713f12]">
                  {notice}
                </p>
              </form>

              <div className="grid gap-4">
                <div className="rounded-md border border-[#e5e7eb] p-4">
                  <h3 className="font-bold">Order Book</h3>
                  <div className="mt-3 grid max-h-64 grid-cols-2 gap-3 overflow-y-auto pr-1">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#0a0a0a]">Bids</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 px-2 text-xs font-bold uppercase tracking-[0.12em] text-[#71717a]">
                        <span>Price</span>
                        <span className="text-right">Qty</span>
                      </div>
                      <div className="mt-1 space-y-2">
                        {buyOrders.map((order) => (
                          <div key={order.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded bg-[#fef9c3] px-3 py-2 text-sm">
                            <span>{order.limitPrice}</span>
                            <span className="text-right">{order.remaining}</span>
                            {authUser?.uid === order.userId ? (
                              <button
                                onClick={() => void cancelOrder(order.id)}
                                className="rounded border border-[#e5e7eb] px-2 py-1 text-xs font-bold text-[#dc2626] hover:border-[#dc2626]"
                              >
                                Cancel
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#dc2626]">Asks</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 px-2 text-xs font-bold uppercase tracking-[0.12em] text-[#71717a]">
                        <span>Price</span>
                        <span className="text-right">Qty</span>
                      </div>
                      <div className="mt-1 space-y-2">
                        {sellOrders.map((order) => (
                          <div key={order.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded bg-[#fef2f2] px-3 py-2 text-sm">
                            <span>{order.limitPrice}</span>
                            <span className="text-right">{order.remaining}</span>
                            {authUser?.uid === order.userId ? (
                              <button
                                onClick={() => void cancelOrder(order.id)}
                                className="rounded border border-[#e5e7eb] px-2 py-1 text-xs font-bold text-[#dc2626] hover:border-[#dc2626]"
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

                <div className="rounded-md border border-[#e5e7eb] p-4">
                  <h3 className="font-bold">Recent Trades</h3>
                  <div className="mt-3 grid grid-cols-3 gap-3 text-xs font-bold uppercase tracking-[0.12em] text-[#71717a]">
                    <span>Quantity</span>
                    <span>Price</span>
                    <span>Buyer</span>
                  </div>
                  <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                    {assetTrades.length ? (
                      assetTrades.map((trade) => (
                        <div key={trade.id} className="grid grid-cols-3 items-center gap-3 rounded bg-[#fefce8] px-3 py-2 text-sm">
                          <span>{trade.quantity}</span>
                          <span className="font-bold">{trade.price}</span>
                          <span className="truncate text-[#52525b]">{trade.buyer}</span>
                        </div>
                      ))
                    ) : (
                      <p className="rounded bg-[#fefce8] px-3 py-3 text-sm text-[#52525b]">
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
              <p className="rounded-md bg-[#fefce8] px-3 py-3 text-sm text-[#52525b]">
                {activeTab === "drop" ? "No active drop selected." : "No market selected."}
              </p>
            )}
          </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          {activeTab === "portfolio" ? (
          <div className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Portfolio</h2>
            <div className="mt-4 space-y-3">
              {portfolioAssets.length ? portfolioAssets.map((asset) => {
                const holding = holdings[asset.id] ?? { quantity: 0, averagePrice: 0 };
                const profit = holding.quantity * (asset.lastPrice - holding.averagePrice);

                return (
                  <div key={asset.id} className="rounded-md border border-[#e5e7eb] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{asset.name}</p>
                        <p className="text-sm text-[#52525b]">{holding.quantity} shares at avg {holding.averagePrice.toFixed(0)}</p>
                      </div>
                      <p className={`font-bold ${profit >= 0 ? "text-[#0a0a0a]" : "text-[#dc2626]"}`}>
                        {profit >= 0 ? "+" : ""}
                        {profit.toFixed(0)}
                      </p>
                    </div>
                  </div>
                );
              }) : (
                <p className="rounded-md bg-[#fefce8] px-3 py-3 text-sm text-[#52525b]">No holdings.</p>
              )}
            </div>
          </div>
          ) : null}

          {activeTab === "account" ? (
            <div className="rounded-lg border border-[#e5e7eb] bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold">Account</h2>
              <div className="mt-4 rounded-md bg-[#fefce8] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Coins</p>
                <p className="mt-1 text-2xl font-bold">{coinsReady ? currency(coins) : "Loading"}</p>
              </div>
              <div className="mt-3 rounded-md border border-[#e5e7eb] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">Signed in as</p>
                <p className="mt-1 truncate font-bold">{accountName}</p>
              </div>
              <button
                onClick={handleSignOut}
                className="mt-4 w-full rounded-md bg-[#0a0a0a] px-4 py-3 font-bold text-white transition hover:bg-[#18181b]"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </aside>
      </section>
        </div>
      </div>
    </main>
  );
}
