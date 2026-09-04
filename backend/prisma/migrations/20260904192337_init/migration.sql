-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "sector" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "watchlists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My Watchlist',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "watchlist_id" UUID NOT NULL,
    "symbol" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "baseline_price" DECIMAL(18,4) NOT NULL,
    "baseline_captured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "symbol" TEXT NOT NULL,
    "ts" TIMESTAMPTZ NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "volume" BIGINT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("symbol","ts")
);

-- CreateTable
CREATE TABLE "symbol_stats_daily" (
    "symbol" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "stddev_return_30d" DECIMAL(10,6) NOT NULL,
    "avg_volume_30d" BIGINT NOT NULL,
    "high_52w" DECIMAL(18,4) NOT NULL,
    "low_52w" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "symbol_stats_daily_pkey" PRIMARY KEY ("symbol","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_watchlist_id_symbol_key" ON "watchlist_items"("watchlist_id", "symbol");

-- CreateIndex
CREATE INDEX "price_snapshots_symbol_ts_idx" ON "price_snapshots"("symbol", "ts" DESC);

-- AddForeignKey
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "instruments"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "instruments"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "symbol_stats_daily" ADD CONSTRAINT "symbol_stats_daily_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "instruments"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;
