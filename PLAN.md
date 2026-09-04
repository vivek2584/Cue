# "Cue", a Smart Market Watchlist — Build Plan

This document is the single source of truth for building the product end-to-end: product framing, architecture, data design, backend, frontend, and a concrete build order. It is written to be handed directly to a coding agent — every interface, schema, and screen is specified precisely enough to implement without further clarification.

---

## 1. Product Vision

A watchlist's job isn't to show numbers — it's to tell you whether you need to look. Most watchlists fail at this: they show the same dense grid whether a stock moved 0.1% or 9%, so users either check obsessively (fatigue) or stop checking (missed moves). Both outcomes are bad for an investing app — disengaged users don't trade, and overwhelmed users churn.

**The core idea: separate "changed" from "meaningfully changed."** A stock that moves 0.5% on a day when it normally moves 0.5% hasn't told you anything. A stock that moves 0.5% on a day when it normally moves 0.05%, on triple its usual volume, has. The product's job is to do that arithmetic so the user doesn't have to.

**The differentiating feature: the Attention Engine.** Every watchlist item is scored, on each visit, against its *own* historical behavior — not a flat percentage threshold — and given a one-line, plain-language reason. The home screen opens with a short "Since you last checked" digest, then a full ledger below it, so the product still functions as a normal watchlist but leads with judgment, not just data.

**Business value:**

- **Retention** — a digest that's worth opening (vs. a static grid) gives users a reason to return daily without needing push-alert spam.
- **Trust/education** — showing *why* something is flagged ("2.3× normal volatility, highest volume in 30 days") teaches retail users to read the market instead of reacting to noise, which fits Groww's positioning toward first-time investors.
- **Reduced noise, more room to upsell** — once "meaningful" is defined well, it's a natural foundation for a future premium alerting/notification product.

---

## 2. Key Product & Engineering Decisions

The brief deliberately leaves these open. Decisions and rationale below — a coding agent should treat these as binding unless a milestone says otherwise.

| Decision                                             | Choice                                                                                                                                                                                                                                                                         | Why                                                                                                                                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What counts as a meaningful change**         | A composite, volatility-normalized **Attention Score** (§5) combining price move relative to the stock's own historical volatility, volume anomaly, and 52-week extremes — not a flat "% moved" threshold.                                                            | Flat thresholds either spam volatile stocks or stay silent on calm ones. Normalizing against each stock's own baseline is the only version of "meaningful" that's fair across a mixed watchlist (a bank stock and a small-cap are not equally noisy). |
| **What information to surface**                | Price, % change since last visit, one-line plain-English reason, a 7-day sparkline, and a freshness timestamp — deliberately not a full options-chain-style data wall.                                                                                                        | The product's thesis is signal over noise; the UI should model that in what it chooses to show, not just in the scoring.                                                                                                                              |
| **State persistence across sessions/devices**  | Server-side, per user account (Postgres), keyed by`(watchlist_id, symbol)`. `last_viewed_at` and a `baseline_price` are stored per item and updated explicitly (not on every page load — see §5.2).                                                                    | Anything client-only (localStorage) breaks the moment a user opens another device, which defeats "return later and see what's changed" as a use case.                                                                                                 |
| **Stale / delayed / conflicting data**         | Every quote carries`source` + `ts`. Redis holds the latest known quote per symbol; the UI always renders *something* (last-known-good) with an explicit freshness badge rather than blocking or showing an error. Out-of-order updates are dropped by timestamp. (§6.4) | In market data, "no data" is worse UX than "slightly old data, clearly labeled." Silent staleness (showing an old price as if it were live) is the failure mode to avoid, not staleness itself.                                                       |
| **Scaling for larger watchlists / more users** | Fan-in: batch quote requests per unique symbol across*all* users (not per-watchlist), cache in Redis, fan out over WebSocket/pub-sub. Heavy stats (30-day σ, 52-week high/low) are precomputed once daily into `symbol_stats_daily`, not recomputed per request. (§6.5)  | The number of*distinct symbols* grows much slower than the number of users/watchlist rows. Designing around unique symbols is what keeps provider calls and compute roughly flat as the user base grows.                                            |
| **Where to keep it simple vs. add complexity** | See §9 (MVP vs. stretch table). In short: one watchlist per user, a single mock data provider with a real-provider seam, polling-interval ingestion (not a full streaming exchange feed), and no ML — a transparent weighted-score model instead.                            | The challenge rewards a working, well-reasoned end-to-end system over a partially-built ambitious one. Every "stretch" item is designed to bolt on without a rewrite.                                                                                 |

---

## 3. System Architecture

```
                        ┌──────────────────────────┐
                        │         Frontend           │
                        │  React + TS + Tailwind     │
                        │  Ledger · Digest · Detail  │
                        └───────────┬───────┬─────────┘
                            REST    │       │ WebSocket
                                    ▼       ▼
                        ┌──────────────────────────┐
                        │        API Gateway         │
                        │   Express + TypeScript     │
                        │ auth · watchlist · search  │
                        │        · ws gateway         │
                        └──────┬───────────┬─────────┘
                               │           │
                  ┌────────────▼─┐   ┌─────▼───────────────┐
                  │ Signal Engine  │   │  Market Data Service  │
                  │ attention score│   │  provider adapter      │
                  │ + digest build │   │  (Mock / Finnhub)       │
                  └───────┬────────┘   └─────────┬────────────┘
                          │                       │
                  ┌───────▼────────┐      ┌───────▼────────┐
                  │   PostgreSQL     │      │  Ingestion Worker│
                  │ users · watch-   │◄─────┤  poll → dedupe →  │
                  │ lists · snapshots│      │  cache → persist   │
                  │ · symbol_stats   │      └───────┬────────┘
                  └───────┬──────────┘              │
                          │                  ┌───────▼────────┐
                          └─────────────────►│      Redis       │
                                              │ latest-quote      │
                                              │ cache · pub/sub   │
                                              │ · digest cache     │
                                              └────────────────┘
```

**Components**

- **API Gateway** — stateless REST + WS server; the only thing the frontend talks to.
- **Signal Engine** — pure functions that turn raw price history + a baseline into an Attention Score, bucket, and human-readable reason. No I/O of its own; it's called by the gateway and by the nightly stats job.
- **Market Data Service** — a provider-agnostic interface (`getQuote`, `getHistory`) with a swappable implementation. Ships with a deterministic mock provider so the whole system runs with zero external API keys.
- **Ingestion Worker** — a scheduled job that polls the provider for every *distinct* symbol currently on any watchlist, writes the latest value to Redis, and conditionally persists to Postgres.
- **Postgres** — system of record: users, watchlists, instruments, price history, and precomputed daily stats.
- **Redis** — hot path: latest quote per symbol, digest cache, and pub/sub fan-out to WebSocket clients.

---

## 4. Tech Stack

| Layer                 | Choice                                                                                           | Notes                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Frontend              | React 18 + TypeScript + Vite                                                                     | Fast local dev, no framework lock-in needed for this scope                                          |
| Styling               | Tailwind CSS, custom design tokens (§8)                                                         | Utility-first keeps the design system enforceable                                                   |
| Data fetching / cache | TanStack Query                                                                                   | Its`staleTime`/`refetchInterval` model maps directly onto the product's own "freshness" concept |
| Charts                | Recharts (sparklines + detail chart)                                                             | Lightweight, composable                                                                             |
| Realtime              | native`WebSocket` client                                                                       | No need for Socket.IO's overhead at this scale                                                      |
| Backend               | Node.js + TypeScript + Express                                                                   | Simple, explicit, easy for an agent to extend                                                       |
| ORM / migrations      | Prisma                                                                                           | Schema-as-code, generates typed client, easy seeding                                                |
| DB                    | PostgreSQL 15                                                                                    | Relational integrity for users/watchlists; native`NUMERIC` for prices                             |
| Cache / pub-sub       | Redis 7 (ioredis)                                                                                | Latest-quote cache, digest cache, WS fan-out channel                                                |
| Jobs                  | node-cron (ingestion tick) + a simple queue table (or BullMQ if Redis-backed queue is preferred) | Ingestion tick + nightly stats rollup                                                               |
| Auth                  | JWT (access token) + bcrypt                                                                      | Stateless, simple to reason about                                                                   |
| Local orchestration   | Docker Compose (postgres, redis, backend, frontend)                                              | One command to run everything                                                                       |

---

## 5. The Attention Engine (Signal Design)

This is the product's core logic — implement it as a pure, unit-testable module (`signal-engine/`), independent of HTTP/DB concerns.

### 5.1 Inputs, per watchlist item

- `baseline_price`, `baseline_captured_at` — price as of the last time the user acknowledged this item (see §5.2)
- `current_price`, `current_volume` — latest quote
- `stddev_return_30d` — trailing 30-day daily-return standard deviation for the symbol (precomputed)
- `avg_volume_30d` — trailing 30-day average volume (precomputed)
- `high_52w`, `low_52w` — 52-week extremes (precomputed)

### 5.2 The baseline, precisely

`baseline_price` is **not** "price on last page load" — it only updates when the user explicitly acknowledges the item (viewing its detail drawer, or an explicit "Mark reviewed"). This is deliberate: if the baseline reset on every visit, a user who checks the app five times a day would never see a meaningful change accumulate. The baseline is "what the price was, the last time you actually paid attention to this stock" — which is what "meaningfully changed since they last checked" in the brief literally means.

### 5.3 Scoring formula

```
pct_change   = (current_price - baseline_price) / baseline_price
z_score      = pct_change / max(stddev_return_30d, 0.001)      // guards divide-by-zero
vol_ratio    = current_volume / max(avg_volume_30d, 1)
vol_signal   = max(0, vol_ratio - 1)                            // 0 if volume is normal/below-avg
extreme_hit  = 1 if current_price >= high_52w or current_price <= low_52w else 0

score = (1.0 * abs(z_score)) + (0.5 * min(vol_signal, 3)) + (1.5 * extreme_hit)

bucket =
  "needs_attention"  if score >= 2.0
  "notable"          if score >= 0.8
  "quiet"            otherwise
```

Weights are intentionally simple and explainable (not ML-fitted) — a transparent scoring model a user could, in principle, be shown and trust. `min(vol_signal, 3)` caps one noisy input from dominating the score.

### 5.4 Reason text (template-based, not free-text generation)

Build the reason from whichever signals actually fired, in priority order:

```
if extreme_hit:        "Hit a new 52-week {high|low}"
if abs(z_score) >= 2:  "{Up|Down} {pct}% — about {z}× its usual daily move"
if vol_ratio >= 2:     "Trading at {vol_ratio}× normal volume"
if bucket == "quiet":  "No unusual movement since you last checked"
```

Combine up to 2 firing reasons with " · " when more than one is true; otherwise use the single strongest one.

### 5.5 Digest assembly

`GET /api/watchlist` computes this per request (cached in Redis for 30s per watchlist to absorb refresh bursts):

1. Score every item.
2. `digest.items` = items with bucket ∈ {needs_attention, notable}, sorted by score desc, capped at 5.
3. If empty, digest still renders with a calm empty message (see §8.4) — silence is itself a useful signal, not a broken state.
4. The full ledger (`items`) always contains everything, sorted: needs_attention → notable → quiet, alphabetical within each bucket.

---

## 6. Backend Design

### 6.1 Module layout

```
backend/src/
├── modules/
│   ├── auth/            signup, login, JWT middleware
│   ├── watchlist/        CRUD + digest endpoint
│   ├── instruments/       symbol search
│   ├── market-data/
│   │   ├── providers/
│   │   │   ├── MockProvider.ts
│   │   │   └── FinnhubProvider.ts
│   │   └── MarketDataService.ts   (interface + provider selection)
│   ├── signal-engine/
│   │   ├── attentionScore.ts       (§5.3–5.4, pure functions)
│   │   └── digest.ts               (§5.5, orchestration)
│   └── realtime/          WebSocket gateway + Redis pub/sub bridge
├── jobs/
│   ├── ingestQuotes.ts    tick every INGEST_INTERVAL_MS
│   └── computeDailyStats.ts   once/day: σ, avg volume, 52w hi/lo
├── db/
│   ├── prisma/schema.prisma
│   └── seed.ts             demo user + ~15 instruments + 90d mock history
├── routes/, middleware/, config/
└── app.ts / server.ts
```

### 6.2 Market Data Provider interface

```ts
interface Quote {
  symbol: string;
  price: number;
  volume: number;
  ts: string;        // ISO timestamp from the provider
  source: string;     // "mock" | "finnhub" | ...
}

interface MarketDataProvider {
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getHistory(symbol: string, days: number): Promise<{ date: string; close: number; volume: number }[]>;
}
```

`MockProvider` generates a deterministic-per-symbol random walk (seeded by symbol string) with realistic intraday drift + noise, so demos are stable and reproducible without any API key. `FinnhubProvider` implements the same interface against Finnhub's free-tier quote endpoint, selected via `MARKET_DATA_PROVIDER=finnhub` + `FINNHUB_API_KEY`. Nothing else in the codebase should know which provider is active — this seam is what makes "swap in a real feed later" a config change, not a rewrite.

### 6.3 API contract

```
POST  /api/auth/signup           { email, password }              → { token, user }
POST  /api/auth/login            { email, password }              → { token, user }

GET   /api/instruments/search    ?q=infy                          → [{ symbol, name, exchange }]

GET   /api/watchlist                                              → {
                                                                        items: WatchlistItemView[],
                                                                        digest: { items: WatchlistItemView[] }
                                                                      }
POST  /api/watchlist/items       { symbol }                       → WatchlistItemView
DELETE /api/watchlist/items/:id                                   → 204
POST  /api/watchlist/items/:id/ack                                → resets baseline_price/baseline_captured_at
                                                                       to current price/now; returns updated item

GET   /api/watchlist/items/:id/detail                             → {
                                                                        history: { date, close, volume }[],
                                                                        reasons: string[],
                                                                        stats: { stddev30d, avgVolume30d, high52w, low52w }
                                                                      }

WS    /ws?token=<jwt>            server → client:
                                    { type: "quote", symbol, price, ts, isStale }
                                    { type: "digest_update", digest }
```

`WatchlistItemView`:

```ts
{
  id: string; symbol: string; name: string;
  price: number; changePct: number; changeAbs: number;
  signal: { bucket: "needs_attention"|"notable"|"quiet"; score: number; reason: string };
  sparkline: number[];              // last 7 daily closes
  lastViewedAt: string; addedAt: string;
  freshness: { asOf: string; isStale: boolean; ageSeconds: number };
}
```

### 6.4 Staleness & conflict handling

- Every cached quote in Redis (`quote:{symbol}`) carries `ts` + `source`.
- **Out-of-order rejection**: the ingestion worker only overwrites the cache if the incoming `ts` is newer than what's cached.
- **Provider failure**: if `getQuotes` throws or times out, serve the last cached value and set `isStale: true`, `ageSeconds = now - ts`. Never block the request or 500 the user's watchlist because one upstream call failed.
- **Staleness thresholds**: `isStale = ageSeconds > 120`. If `ageSeconds > 900` during market hours, surface an explicit "data delayed" banner rather than a quiet badge — past that point, silently labeling it "a bit old" is misleading.
- **Multiple sources (future)**: quotes carry a `source` priority list; a higher-priority source only wins if it's within the staleness threshold, otherwise fall back to the next source and record which one served the value.

### 6.5 Scaling approach

- **Batch by unique symbol, not by user or watchlist row.** The ingestion worker maintains a Redis set (`tracked_symbols`) updated on add/remove; each tick calls `getQuotes(Array.from(tracked_symbols))` once, regardless of how many users hold those symbols.
- **Write amplification control**: every tick refreshes Redis (cheap), but Postgres `price_snapshots` is only written when the price has moved beyond a small threshold since the last persisted row, or at most once per minute per symbol — keeps the time-series table's growth roughly proportional to real price movement, not polling frequency.
- **Precompute the expensive stats.** `symbol_stats_daily` (σ, avg volume, 52w hi/lo) is computed once nightly per symbol, not per request — request-time scoring is then O(1) arithmetic per watchlist item.
- **Fan-out over fan-in.** WebSocket pushes go through a single Redis pub/sub channel per symbol; the gateway subscribes once per active symbol and relays to every connected client watching it, instead of each client polling independently.
- **Horizontal path (documented, not built for MVP)**: API gateway is stateless and can run behind a load balancer; the ingestion worker is the only component that must run as a singleton (or with distributed-lock coordination) to avoid duplicate provider calls.

---

## 7. Data Design

### 7.1 Entity relationship

```
users ──1:N── watchlists ──1:N── watchlist_items ──N:1── instruments
                                                              │
                                                        1:N   │  1:1 (per date)
                                              price_snapshots │ symbol_stats_daily
```

### 7.2 Schema (PostgreSQL DDL — mirror this in `prisma/schema.prisma`)

```sql
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE instruments (
  symbol     TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  exchange   TEXT NOT NULL,
  sector     TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE watchlists (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'My Watchlist',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE watchlist_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id          UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol                TEXT NOT NULL REFERENCES instruments(symbol),
  added_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  baseline_price        NUMERIC(18,4) NOT NULL,
  baseline_captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_viewed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, symbol)
);

-- Time series of observed prices. Partition by month if data volume grows;
-- for MVP scale a single table with a (symbol, ts) index is sufficient.
CREATE TABLE price_snapshots (
  symbol   TEXT NOT NULL REFERENCES instruments(symbol),
  ts       TIMESTAMPTZ NOT NULL,
  price    NUMERIC(18,4) NOT NULL,
  volume   BIGINT NOT NULL,
  source   TEXT NOT NULL,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX idx_price_snapshots_symbol_ts ON price_snapshots (symbol, ts DESC);

-- Precomputed nightly, read at request time — keeps scoring O(1).
CREATE TABLE symbol_stats_daily (
  symbol             TEXT NOT NULL REFERENCES instruments(symbol),
  date               DATE NOT NULL,
  stddev_return_30d  NUMERIC(10,6) NOT NULL,
  avg_volume_30d     BIGINT NOT NULL,
  high_52w           NUMERIC(18,4) NOT NULL,
  low_52w            NUMERIC(18,4) NOT NULL,
  PRIMARY KEY (symbol, date)
);
```

### 7.3 Redis keyspace

```
quote:{symbol}          → JSON { price, volume, ts, source }         TTL: none (overwritten in place)
digest:{watchlist_id}   → JSON cached digest response                 TTL: 30s
tracked_symbols         → Set of every symbol on any active watchlist
channel:quotes:{symbol} → pub/sub channel, ingestion → WS gateway
```

---

## 8. Frontend Design

### 8.1 Design plan

**Grounding**: this is a data-reading tool, not a marketing page — the design should read like a well-kept ledger, not a dashboard template. The one deliberately expressive choice is the digest strip; everything else stays quiet and gets out of the way of the numbers.

**Color** (named tokens, used consistently — not per-component one-offs):

| Token         | Hex         | Role                                                                                         |
| ------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `--surface` | `#F4F6F4` | App background — a cool, faint sage-white, not stark white or warm cream                    |
| `--ink`     | `#1B2430` | Primary text — deep slate, not pure black                                                   |
| `--muted`   | `#8B93A1` | Secondary text, "quiet" signal dot, dividers                                                 |
| `--accent`  | `#0F8B6C` | Primary actions, links, brand mark                                                           |
| `--rise`    | `#1E9E6B` | Positive price change                                                                        |
| `--fall`    | `#C1443D` | Negative price change (muted brick, not neon alarm-red)                                      |
| `--signal`  | `#C98A2D` | Reserved*only* for "needs attention" badges/digest — this is what makes it mean something |

**Type**:

- Display (`app name`, section headers): **Fraunces** — a serif with enough character to give the brand a point of view without tipping into "editorial blog."
- UI/body (`labels, buttons, paragraphs`): **Inter** — neutral, legible at small sizes.
- Data (`prices, %s, table figures`): **Inter, tabular-nums** — lining, fixed-width figures so columns of prices align visually, which matters for actually scanning a ledger.

**Layout**: left-aligned, single-column-of-content max-width ~880px, ledger rows with 1px hairline dividers (no card shadows, no per-row borders-as-boxes). Small `6px` radius reserved for interactive controls only (buttons, inputs, badges) — the ledger rows themselves stay flat, so radius consistently *means* "you can interact with this."

```
┌────────────────────────────────────────────────────┐
│  Smart Watchlist                          [+ Add]   │
│                                                        │
│  Since you last checked ───────────────────────────  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│  │ ● INFY     │ │ ● TATAMOT │ │ ○ HDFCBANK │  (scroll)│
│  │ new 52w hi │ │ 3.1× vol  │ │ steady     │           │
│  └───────────┘ └───────────┘ └───────────┘           │
│                                                        │
│  Symbol      Price     Change    Signal   7d          │
│  ─────────────────────────────────────────────────── │
│  INFY        1,542.10  +4.2%      ●       ╱‾╲_╱      │
│  TATAMOT       921.35  +2.8%      ●       _╱‾‾╲      │
│  HDFCBANK    1,688.00  +0.3%      ○       ‾‾‾‾‾╲     │
│  ...                                                   │
└────────────────────────────────────────────────────┘
```

**Principles**: (1) the digest is the hero, the ledger is the reference — don't let the ledger visually compete with it; (2) color is reserved for meaning (rise/fall/attention), never decoration; (3) numbers are always tabular and right-aligned so the eye can scan a column, not a paragraph.

### 8.2 Screens / components

- **Watchlist Home** — digest strip + ledger table (§8.1 wireframe). Empty state (§8.4) when the watchlist has zero items.
- **Add Symbol** — a modal/panel with a debounced search box hitting `/api/instruments/search`, results list, add button per row.
- **Stock Detail Drawer** (opens on row click) — price chart (30d), the fired reasons as a short bullet list, key stats (σ, avg volume, 52w range), "Mark as reviewed" button (calls `/ack`, which resets that item's baseline — the drawer visibly updates to `bucket: quiet` on success).
- **Auth** — minimal email/password login + signup, no unnecessary chrome.

### 8.3 State & data flow

- TanStack Query owns all server state; `GET /api/watchlist` is the single query the home screen depends on, refetched on WS `digest_update` events rather than polled aggressively.
- A thin WS hook (`useQuotesSocket`) subscribes to the currently-visible symbols and patches the React Query cache in place on `quote` messages — no separate client-side store duplicating server state.
- Local UI state (which row's drawer is open, search input value) stays in component state — no need for a global client store at this scope.

### 8.4 Empty / zero-signal states (write these deliberately, not as filler)

- Empty watchlist: *"Nothing here yet. Add a stock to start tracking what matters."*
- Digest with nothing notable: *"Nothing worth interrupting you for — your picks are steady."*
- Stale data banner: *"Prices are a few minutes behind — reconnecting."*

---

## 9. MVP vs. Stretch Scope

| Area              | MVP (build this)               | Stretch (design allows for it, don't block on it)     |
| ----------------- | ------------------------------ | ----------------------------------------------------- |
| Watchlists        | One per user                   | Multiple named watchlists                             |
| Data provider     | Mock provider only             | Real provider (Finnhub) behind the same interface     |
| Alerts            | In-app digest only             | Push/email notifications for`needs_attention` items |
| Scoring           | Fixed weighted formula (§5.3) | User-tunable weights / thresholds                     |
| Realtime          | WebSocket price + digest push  | Presence, multi-tab sync indicators                   |
| Auth              | Email/password + JWT           | OAuth, 2FA                                            |
| Ingestion cadence | Fixed interval polling         | Adaptive interval (faster during market hours)        |

---

## 10. Non-Functional Concerns

- **Security**: bcrypt password hashing, JWT with short expiry + refresh, input validation (zod) on every endpoint, parameterized queries via Prisma (no raw SQL string interpolation), CORS locked to the frontend origin.
- **Testing**: unit tests for `signal-engine/` (pure functions — table-driven tests over score/bucket/reason given fixture inputs), integration tests for the watchlist API against a test DB.
- **Observability**: structured JSON logs (request id, latency, symbol counts per ingestion tick); a `/health` endpoint checking DB + Redis connectivity.
- **Accessibility**: color is never the *only* signal — the bucket dot is paired with the reason text; visible focus states on all interactive elements; sufficient contrast on `--muted` text against `--surface`.

---

## 11. Repo Layout

```
groww-smart-watchlist/
├── PLAN.md
├── docker-compose.yml
├── .env.example
├── README.md
├── backend/
│   ├── src/  (see §6.1)
│   ├── package.json
│   └── tsconfig.json
└── frontend/
    ├── src/
    │   ├── components/{ledger,digest,stock-detail,auth,ui}/
    │   ├── pages/
    │   ├── hooks/          useWatchlist.ts, useQuotesSocket.ts
    │   ├── lib/             api.ts, ws.ts
    │   ├── styles/           tokens.css
    │   └── App.tsx
    ├── package.json
    └── tailwind.config.ts
```

---

## 12. Environment Variables

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/watchlist
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me
MARKET_DATA_PROVIDER=mock          # mock | finnhub
FINNHUB_API_KEY=                    # only needed if provider=finnhub
INGEST_INTERVAL_MS=10000
PORT=4000
VITE_API_URL=http://localhost:4000
VITE_WS_URL=ws://localhost:4000/ws
```

---

## 13. Build Order (for the implementing agent)

Work through these in order; each step should leave the system runnable.

1. **Scaffold** the repo layout above, `docker-compose.yml` (postgres + redis), `.env.example`.
2. **Schema & seed**: write `prisma/schema.prisma` matching §7.2, run initial migration, write `seed.ts` — ~15 real-sounding instruments, 90 days of mock daily history per symbol (feeds `symbol_stats_daily` and sparklines immediately), one demo user with a pre-populated watchlist.
3. **Market Data Service**: `MarketDataProvider` interface + `MockProvider` (seeded random walk per symbol); leave `FinnhubProvider` as a stub implementing the same interface.
4. **Auth module**: signup/login, bcrypt, JWT middleware.
5. **Watchlist CRUD**: add/remove item, list, instrument search.
6. **Signal Engine**: `attentionScore.ts` + `digest.ts` per §5, with unit tests against fixture inputs (e.g., "flat price, low volume → quiet"; "small move, high σ, high volume → needs_attention").
7. **Daily stats job**: computes `symbol_stats_daily` from `price_snapshots` (seed data makes this immediately meaningful).
8. **Ingestion worker + WS gateway**: poll tracked symbols → Redis → conditional Postgres write → pub/sub → WS push (§6.4, §6.5).
9. **Frontend scaffold**: Vite + React + TS + Tailwind, wire design tokens (§8.1) into `tailwind.config.ts` / `tokens.css`.
10. **Auth pages** + API client + TanStack Query setup.
11. **Ledger table** + row + sparkline components.
12. **Digest strip** + Stock Detail Drawer (including the `ack` / "Mark as reviewed" flow).
13. **WS wiring** (`useQuotesSocket`) patching the React Query cache live.
14. **Polish pass**: empty/loading/stale states (§8.4), responsive check down to mobile width, keyboard focus states, README with exact run instructions (`docker compose up`, migrate, seed, start both apps).

---

## 14. Demo Script (for judges)

1. Log in as the seeded demo user — watchlist already has items with a range of buckets (`needs_attention`, `notable`, `quiet`) so the digest is populated on first load.
2. Point out the digest strip vs. the full ledger, and read one reason string aloud — it should be self-explanatory.
3. Open a `needs_attention` row's detail drawer, show the chart + reasons, click "Mark as reviewed," show the bucket flip to `quiet`.
4. Add a new symbol via search, show it appear with a live price a few seconds later (ingestion tick + WS push).
5. Kill the mock provider briefly (or note the code path) to show the staleness badge rather than a broken UI.
