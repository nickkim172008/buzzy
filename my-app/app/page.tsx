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

type Suggestion = {
  id: string;
  name: string;
  category: string;
  reason: string;
  suggestedBy: string;
  suggestedByName: string;
  upvotes: number;
  voters: Record<string, boolean>;
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

const tabs: { id: AppTab; label: string; mark: string }[] = [
  { id: "markets", label: "Markets", mark: "M" },
  { id: "suggest", label: "Suggest", mark: "S" },
  { id: "survey", label: "Survey", mark: "V" },
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
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto grid min-h-screen max-w-7xl items-center gap-8 px-5 py-8 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <Image src="/buzzy-logo.svg" alt="Buzzy logo" width={64} height={64} className="h-16 w-16 rounded-[1.25rem] shadow-card" />
          <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-muted">Buzzly accounts</p>
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
  const [holdings, setHoldings] = useState<Record<string, Holding>>({});
  const [publicBalances, setPublicBalances] = useState<Record<string, PublicBalance>>({});
  const [publicHoldings, setPublicHoldings] = useState<Record<string, Holding>>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
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
  const [suggestionName, setSuggestionName] = useState("");
  const [suggestionCategory, setSuggestionCategory] = useState("Event");
  const [suggestionReason, setSuggestionReason] = useState("");
  const [surveySearch, setSurveySearch] = useState("");
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
      setActiveTab("survey");
      setNotice("Suggestion added to the survey.");
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

  async function resetEconomy() {
    if (!authUser) {
      setNotice("Sign in required.");
      return;
    }

    if (!window.confirm("Reset all markets, drops, trades, orders, portfolios, and coins?")) {
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
    ] = await Promise.all([
      getDocs(collection(db, "markets")),
      getDocs(collection(db, "orders")),
      getDocs(collection(db, "trades")),
      getDocs(collection(db, "holdings")),
      getDocs(collection(db, "balances")),
      getDocs(collection(db, "users", authUser.uid, "holdings")),
    ]);
    const batch = writeBatch(db);

    marketsSnapshot.docs.forEach((marketDoc) => batch.delete(doc(db, "markets", marketDoc.id)));
    ordersSnapshot.docs.forEach((orderDoc) => batch.delete(doc(db, "orders", orderDoc.id)));
    tradesSnapshot.docs.forEach((tradeDoc) => batch.delete(doc(db, "trades", tradeDoc.id)));
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
    setHoldings({});
    setPublicHoldings({});
    setCoins(0);
    setSelectedAssetId("");
    setNotice("Everything reset.");
  }

  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId);
  const activeDrops = assets.filter((asset) => asset.status === "drop" && asset.remainingDropSupply > 0);
  const tradingMarkets = assets.filter((asset) => asset.status === "trading");
  const portfolioAssets = assets.filter((asset) => (holdings[asset.id]?.quantity ?? 0) > 0);
  const visibleAsset =
    activeTab === "drop" && selectedAsset && !activeDrops.some((asset) => asset.id === selectedAsset.id)
      ? undefined
      : activeTab === "trading" && selectedAsset?.status !== "trading"
      ? undefined
      : selectedAsset;
  const selectedAssetOrderId = selectedAsset?.id ?? "";
  const buyOrders = selectedAsset ? getOrderBook(orders, selectedAssetOrderId, "buy") : [];
  const sellOrders = selectedAsset ? getOrderBook(orders, selectedAssetOrderId, "sell") : [];
  const assetTrades = trades.filter((trade) => trade.assetId === selectedAssetOrderId).slice(0, 6);
  const bestBid = buyOrders[0]?.limitPrice;
  const bestAsk = sellOrders[0]?.limitPrice;
  const selectedHolding = selectedAsset ? holdings[selectedAsset.id] ?? { quantity: 0, averagePrice: 0 } : { quantity: 0, averagePrice: 0 };
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
    <main className="min-h-screen bg-background text-foreground">
      <div className="min-h-screen xl:grid xl:grid-cols-[17rem_minmax(0,1fr)]">
        <nav className="sticky top-0 z-30 border-b border-border bg-surface/95 px-4 py-4 backdrop-blur xl:h-screen xl:border-b-0 xl:border-r xl:px-5">
          <button
            onClick={() => setActiveTab("markets")}
            className="flex items-center gap-3 rounded-3xl px-2 py-2 text-left"
          >
            <Image src="/buzzy-logo.svg" alt="Buzzy logo" width={48} height={48} className="h-12 w-12 rounded-2xl shadow-card" />
            <span>
              <span className="block text-lg font-black">Buzzy</span>
              <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted">Trade the Hype</span>
            </span>
          </button>

          <div className="mt-6 flex gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-visible">
            {tabs.map((tab) => (
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
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">Buzzly</p>
                <h1 className="mt-2 text-4xl font-black tracking-normal text-foreground md:text-5xl">
                  Trade the Hype.
                </h1>
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
              <span className="rounded-full bg-brand px-3 py-1 text-xs font-black">{assets.length} listed</span>
            </div>
            {assets.length ? null : (
              <p className="mt-4 rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">No markets.</p>
            )}
          </div>
          ) : null}

          {activeTab === "create" ? (
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
                    onChange={(event) => setMarketPrice(Number(event.target.value))}
                    min={1}
                    type="number"
                    className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                  />
                </label>
                <label className="text-sm font-bold text-muted">
                  Supply
                  <input
                    value={marketSupply}
                    onChange={(event) => setMarketSupply(Number(event.target.value))}
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
                  placeholder="GTA 6 trailer hype"
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
                  {["Event", "Product", "Music", "Public Figure", "Sports", "Meme", "Private"].map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-bold text-muted">
                Why should this be a drop?
                <textarea
                  value={suggestionReason}
                  onChange={(event) => setSuggestionReason(event.target.value)}
                  placeholder="People are already talking about it, and the hype could move fast."
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
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-2xl font-black">Survey Suggestions</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    Search community ideas and upvote the drops you want listed next. Results are sorted by popularity.
                  </p>
                </div>
                <label className="w-full text-sm font-bold text-muted md:max-w-sm">
                  Search
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
              })}
            </div>
          ) : null}

          {activeTab === "drop" && activeDrops.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {activeDrops.map((asset) => (
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
                    <div>
                      <p className="font-bold">{asset.name}</p>
                      <p className="text-sm text-muted">{asset.category}</p>
                    </div>
                    <span className="rounded-full bg-brand px-2 py-1 text-xs font-black text-foreground">
                      Drop
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Price</p>
                      <p className="font-bold">{asset.dropPrice}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Left</p>
                      <p className="font-bold">{asset.remainingDropSupply}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Supply</p>
                      <p className="font-bold">{asset.totalSupply}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {activeTab === "trading" ? (
            <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-black">Active Trades</h2>
                  <p className="mt-1 text-sm text-muted">Select a live market, then choose buy or sell below.</p>
                </div>
                <span className="w-fit rounded-full bg-brand px-3 py-1 text-xs font-black">
                  {tradingMarkets.length} live
                </span>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {tradingMarkets.length ? tradingMarkets.map((asset) => {
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
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Bid</p>
                          <p className="font-bold">{assetBuyOrders[0]?.limitPrice ?? "none"}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Ask</p>
                          <p className="font-bold">{assetSellOrders[0]?.limitPrice ?? "none"}</p>
                        </div>
                      </div>
                    </button>
                  );
                }) : (
                  <p className="rounded-2xl bg-surface-warm px-4 py-3 text-sm text-muted">
                    No markets are trading yet. Buy from an active drop first to move it into trading.
                  </p>
                )}
              </div>
            </div>
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
                  <button
                    onClick={() => void deleteMarket(visibleAsset.id)}
                    className="rounded-full border border-border px-3 py-1 text-xs font-bold text-danger transition hover:border-danger"
                  >
                    Delete
                  </button>
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
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-quiet">Supply</p>
                  <p className="text-2xl font-bold">{visibleAsset.remainingDropSupply}</p>
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
                        onChange={(event) => setDropQuantity(Number(event.target.value))}
                        min={1}
                        max={visibleAsset.remainingDropSupply}
                        type="number"
                        className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-base outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                      />
                    </label>
                    <div className="rounded-2xl bg-surface-warm p-3 text-sm leading-6 text-muted">
                      <p>Price: {currency(visibleAsset.dropPrice)}</p>
                      <p>Total: {currency(dropQuantity * visibleAsset.dropPrice)}</p>
                      <p>Remaining: {visibleAsset.remainingDropSupply}</p>
                    </div>
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
                    <p>Total supply: {visibleAsset.totalSupply}</p>
                    <p>Remaining: {visibleAsset.remainingDropSupply}</p>
                    <p>Sold: {visibleAsset.totalSupply - visibleAsset.remainingDropSupply}</p>
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
                      onChange={(event) => setQuantity(Number(event.target.value))}
                      min={1}
                      type="number"
                      className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-base outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                    />
                  </label>
                  <label className="text-sm font-bold text-muted">
                    Limit price
                    <input
                      value={limitPrice}
                      onChange={(event) => setLimitPrice(Number(event.target.value))}
                      min={1}
                      type="number"
                      className="mt-2 w-full rounded-2xl border border-border px-4 py-3 text-base outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/30"
                    />
                  </label>
                </div>

                <div className="mt-4 rounded-2xl bg-surface-warm p-3 text-sm leading-6 text-muted">
                  <p>Best bid: {bestBid ? currency(bestBid) : "none"}</p>
                  <p>Best ask: {bestAsk ? currency(bestAsk) : "none"}</p>
                  <p>Estimated max value: {currency(quantity * limitPrice)}</p>
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
          <div className="rounded-[2rem] border border-border bg-surface p-6 shadow-card">
            <h2 className="text-2xl font-black">Portfolio</h2>
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
              <button
                onClick={() => void resetEconomy()}
                className="mt-3 w-full rounded-2xl border border-danger px-4 py-3 font-bold text-danger transition hover:bg-red-50"
              >
                Reset everything
              </button>
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
                  <button
                    onClick={() => setActiveTab("suggest")}
                    className="rounded-2xl bg-brand px-4 py-2 text-sm font-black text-foreground transition hover:bg-brand-hover"
                  >
                    Get coins
                  </button>
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
