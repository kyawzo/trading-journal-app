-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "action_effect_type" AS ENUM ('OPEN', 'CLOSE', 'REDUCE', 'INCREASE', 'REPLACE', 'ROLL', 'EXPIRE', 'ASSIGN', 'EXERCISE', 'ADJUST', 'INCOME', 'EXPENSE', 'NOTE_ONLY');

-- CreateEnum
CREATE TYPE "action_leg_change_type" AS ENUM ('OPEN', 'CLOSE', 'REPLACE', 'REDUCE', 'INCREASE', 'EXPIRE', 'ASSIGN', 'EXERCISE');

-- CreateEnum
CREATE TYPE "asset_class" AS ENUM ('STOCK', 'OPTION', 'MIXED', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "broker_account_type" AS ENUM ('CASH', 'MARGIN', 'PAPER', 'RETIREMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "broker_code" AS ENUM ('MOOMOO', 'TIGER', 'IBKR', 'TASTYTRADE', 'WEBULL', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "cash_txn_type" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'INTEREST', 'FEE', 'COMMISSION', 'TAX', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "direction_bias" AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL', 'INCOME', 'VOLATILITY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "discipline_rating" AS ENUM ('FOLLOWED_PLAN', 'ADJUSTED', 'BROKE_RULES', 'UNRATED');

-- CreateEnum
CREATE TYPE "execution_link_target_type" AS ENUM ('POSITION', 'POSITION_LEG', 'POSITION_ACTION', 'HOLDING', 'HOLDING_EVENT');

-- CreateEnum
CREATE TYPE "execution_open_close" AS ENUM ('OPEN', 'CLOSE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "execution_side" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "holding_event_type" AS ENUM ('ACQUIRED', 'SOLD', 'PARTIAL_SELL', 'CALLED_AWAY', 'DIVIDEND', 'SPLIT', 'MERGER', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'NOTE');

-- CreateEnum
CREATE TYPE "holding_source_type" AS ENUM ('MANUAL_BUY', 'ASSIGNED_FROM_PUT', 'EXERCISED_FROM_CALL', 'TRANSFER_IN', 'CORPORATE_ACTION', 'OTHER');

-- CreateEnum
CREATE TYPE "holding_status" AS ENUM ('OPEN', 'PARTIALLY_SOLD', 'CLOSED', 'CALLED_AWAY', 'TRANSFERRED_OUT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "import_batch_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "import_source_type" AS ENUM ('CSV', 'PDF', 'API', 'MANUAL', 'JSON', 'OTHER');

-- CreateEnum
CREATE TYPE "leg_side" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "leg_status" AS ENUM ('OPEN', 'PARTIALLY_CLOSED', 'CLOSED', 'ROLLED', 'ASSIGNED', 'EXPIRED', 'EXERCISED', 'REPLACED');

-- CreateEnum
CREATE TYPE "leg_type" AS ENUM ('STOCK', 'OPTION', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "option_style" AS ENUM ('AMERICAN', 'EUROPEAN', 'OTHER');

-- CreateEnum
CREATE TYPE "option_type" AS ENUM ('CALL', 'PUT');

-- CreateEnum
CREATE TYPE "position_action_type" AS ENUM ('BTO', 'STO', 'BTC', 'STC', 'ROLL_CREDIT', 'ROLL_DEBIT', 'EXPIRED_WORTHLESS', 'ASSIGNED', 'EXERCISED', 'PARTIAL_CLOSE', 'ADJUSTMENT', 'DIVIDEND', 'INTEREST', 'FEE', 'NOTE');

-- CreateEnum
CREATE TYPE "position_source_type" AS ENUM ('MANUAL', 'IMPORTED', 'HYBRID');

-- CreateEnum
CREATE TYPE "position_status" AS ENUM ('DRAFT', 'OPEN', 'PARTIALLY_CLOSED', 'CLOSED', 'ROLLED', 'ASSIGNED', 'EXPIRED', 'EXERCISED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "raw_transaction_type" AS ENUM ('TRADE', 'ORDER', 'FILL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'INTEREST', 'ASSIGNMENT', 'EXERCISE', 'EXPIRATION', 'TRANSFER', 'CORPORATE_ACTION', 'OTHER');

-- CreateEnum
CREATE TYPE "theme_mode" AS ENUM ('LIGHT', 'DARK');

-- CreateEnum
CREATE TYPE "strategy_type" AS ENUM ('STOCK_LONG', 'STOCK_SHORT', 'CSP', 'CC', 'LEAPS_CALL', 'LEAPS_PUT', 'LONG_CALL', 'LONG_PUT', 'SHORT_CALL', 'SHORT_PUT', 'BULL_CALL_SPREAD', 'BULL_PUT_SPREAD', 'BEAR_CALL_SPREAD', 'BEAR_PUT_SPREAD', 'IRON_CONDOR', 'IRON_BUTTERFLY', 'CALENDAR', 'DIAGONAL', 'STRANGLE', 'STRADDLE', 'WHEEL', 'CUSTOM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "theme_mode" "theme_mode" NOT NULL DEFAULT 'LIGHT',
    "active_broker_account_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "session_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brokers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_code" "broker_code" NOT NULL,
    "broker_name" TEXT NOT NULL,
    "country_code" TEXT,
    "website_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brokers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "broker_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_id" UUID NOT NULL,
    "user_id" UUID,
    "account_name" TEXT NOT NULL,
    "account_type" "broker_account_type" NOT NULL DEFAULT 'OTHER',
    "account_number_masked" TEXT,
    "base_currency" TEXT NOT NULL DEFAULT 'USD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "opened_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broker_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_type" "position_source_type" NOT NULL DEFAULT 'MANUAL',
    "asset_class" "asset_class" NOT NULL,
    "strategy_type" "strategy_type" NOT NULL,
    "direction_bias" "direction_bias",
    "broker_account_id" UUID,
    "underlying_symbol" TEXT NOT NULL,
    "position_title" TEXT,
    "thesis" TEXT,
    "entry_plan" TEXT,
    "exit_plan" TEXT,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "current_status" "position_status" NOT NULL DEFAULT 'OPEN',
    "is_wheel_related" BOOLEAN NOT NULL DEFAULT false,
    "linked_holding_id" UUID,
    "trade_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_legs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "position_id" UUID NOT NULL,
    "leg_type" "leg_type" NOT NULL,
    "leg_side" "leg_side" NOT NULL,
    "option_type" "option_type",
    "option_style" "option_style",
    "underlying_symbol" TEXT NOT NULL,
    "expiry_date" DATE,
    "strike_price" DECIMAL(18,4),
    "quantity" DECIMAL(18,4) NOT NULL,
    "multiplier" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "leg_role" TEXT,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "leg_status" "leg_status" NOT NULL DEFAULT 'OPEN',
    "parent_leg_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "position_id" UUID NOT NULL,
    "action_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "action_type" "position_action_type" NOT NULL,
    "action_effect" "action_effect_type" NOT NULL,
    "amount" DECIMAL(18,4),
    "fee_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "quantity" DECIMAL(18,4),
    "premium_per_unit" DECIMAL(18,4),
    "resulting_status" "position_status",
    "discipline_rating" "discipline_rating" NOT NULL DEFAULT 'UNRATED',
    "notes" TEXT,
    "broker_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_leg_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "position_action_id" UUID NOT NULL,
    "old_leg_id" UUID,
    "new_leg_id" UUID,
    "change_type" "action_leg_change_type" NOT NULL,
    "quantity_changed" DECIMAL(18,4),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_leg_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "position_id" UUID,
    "journal_entry_id" UUID,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT,
    "file_size_bytes" BIGINT,
    "caption" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_account_id" UUID,
    "txn_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "txn_type" "cash_txn_type" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "linked_position_id" UUID,
    "linked_holding_id" UUID,
    "description" TEXT,
    "external_reference" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "execution_id" UUID NOT NULL,
    "target_type" "execution_link_target_type" NOT NULL,
    "position_id" UUID,
    "position_leg_id" UUID,
    "position_action_id" UUID,
    "holding_id" UUID,
    "holding_event_id" UUID,
    "link_notes" TEXT,
    "confidence_score" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_account_id" UUID,
    "import_batch_id" UUID,
    "raw_transaction_id" UUID,
    "order_id" UUID,
    "execution_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "broker_execution_id" TEXT,
    "broker_order_id" TEXT,
    "underlying_symbol" TEXT NOT NULL,
    "instrument_symbol" TEXT,
    "asset_class" "asset_class" NOT NULL,
    "option_type" "option_type",
    "option_style" "option_style",
    "expiry_date" DATE,
    "strike_price" DECIMAL(18,4),
    "side" "execution_side" NOT NULL,
    "open_close" "execution_open_close" NOT NULL DEFAULT 'UNKNOWN',
    "quantity" DECIMAL(18,4) NOT NULL,
    "multiplier" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "price" DECIMAL(18,4),
    "gross_amount" DECIMAL(18,4),
    "fee_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(18,4),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description_text" TEXT,
    "execution_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holding_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "holding_id" UUID NOT NULL,
    "event_timestamp" TIMESTAMPTZ(6) NOT NULL,
    "event_type" "holding_event_type" NOT NULL,
    "quantity" DECIMAL(18,4),
    "price_per_share" DECIMAL(18,4),
    "amount" DECIMAL(18,4),
    "fee_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "linked_position_action_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holdings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_account_id" UUID,
    "source_type" "holding_source_type" NOT NULL,
    "symbol" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "open_quantity" DECIMAL(18,4) NOT NULL,
    "remaining_quantity" DECIMAL(18,4) NOT NULL,
    "cost_basis_per_share" DECIMAL(18,4) NOT NULL,
    "opened_at" TIMESTAMPTZ(6) NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "holding_status" "holding_status" NOT NULL DEFAULT 'OPEN',
    "linked_position_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_account_id" UUID,
    "source_type" "import_source_type" NOT NULL,
    "batch_status" "import_batch_status" NOT NULL DEFAULT 'PENDING',
    "import_label" TEXT,
    "file_name" TEXT,
    "file_hash" TEXT,
    "raw_storage_path" TEXT,
    "parser_version" TEXT,
    "row_count" INTEGER,
    "processed_count" INTEGER,
    "error_count" INTEGER,
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "position_id" UUID NOT NULL,
    "setup_name" TEXT,
    "market_context" TEXT,
    "entry_reason" TEXT,
    "exit_reason" TEXT,
    "mistakes" TEXT,
    "lessons_learned" TEXT,
    "emotions" TEXT,
    "confidence_rating" SMALLINT,
    "execution_rating" SMALLINT,
    "plan_rating" SMALLINT,
    "journal_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "broker_account_id" UUID,
    "import_batch_id" UUID,
    "raw_transaction_id" UUID,
    "broker_order_id" TEXT,
    "broker_parent_order_id" TEXT,
    "placed_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "filled_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "underlying_symbol" TEXT,
    "order_side" "execution_side",
    "order_type" TEXT,
    "time_in_force" TEXT,
    "quantity" DECIMAL(18,4),
    "limit_price" DECIMAL(18,4),
    "stop_price" DECIMAL(18,4),
    "status_text" TEXT,
    "currency" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "position_id" UUID NOT NULL,
    "note_timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note_text" TEXT NOT NULL,
    "note_type" TEXT NOT NULL DEFAULT 'GENERAL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_batch_id" UUID,
    "broker_account_id" UUID,
    "raw_txn_type" "raw_transaction_type" NOT NULL DEFAULT 'OTHER',
    "broker_transaction_id" TEXT,
    "broker_order_id" TEXT,
    "event_timestamp" TIMESTAMPTZ(6),
    "symbol_text" TEXT,
    "description_text" TEXT,
    "amount" DECIMAL(18,4),
    "quantity" DECIMAL(18,4),
    "price" DECIMAL(18,4),
    "fee_amount" DECIMAL(18,4),
    "net_amount" DECIMAL(18,4),
    "currency" TEXT,
    "raw_payload" JSONB NOT NULL,
    "processing_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tag_id" UUID NOT NULL,
    "position_id" UUID,
    "journal_entry_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tag_name" TEXT NOT NULL,
    "tag_category" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_preferences" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "theme_mode" "theme_mode" NOT NULL DEFAULT 'LIGHT',
    "active_broker_account_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_users_email" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "uq_user_preferences_user_id" ON "user_preferences"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_preferences_active_broker_account_id" ON "user_preferences"("active_broker_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sessions_session_token" ON "sessions"("session_token");

-- CreateIndex
CREATE INDEX "idx_sessions_expires_at" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "idx_sessions_user_id" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_brokers_broker_code" ON "brokers"("broker_code");

-- CreateIndex
CREATE INDEX "idx_broker_accounts_active" ON "broker_accounts"("is_active");

-- CreateIndex
CREATE INDEX "idx_broker_accounts_broker_id" ON "broker_accounts"("broker_id");

-- CreateIndex
CREATE INDEX "idx_broker_accounts_user_id" ON "broker_accounts"("user_id");

-- CreateIndex
CREATE INDEX "idx_positions_current_status" ON "positions"("current_status");

-- CreateIndex
CREATE INDEX "idx_positions_opened_at_desc" ON "positions"("opened_at" DESC);

-- CreateIndex
CREATE INDEX "idx_positions_strategy_type" ON "positions"("strategy_type");

-- CreateIndex
CREATE INDEX "idx_positions_underlying_status" ON "positions"("underlying_symbol", "current_status");

-- CreateIndex
CREATE INDEX "idx_positions_underlying_symbol" ON "positions"("underlying_symbol");

-- CreateIndex
CREATE INDEX "idx_position_legs_expiry_strike" ON "position_legs"("expiry_date", "strike_price");

-- CreateIndex
CREATE INDEX "idx_position_legs_position_id" ON "position_legs"("position_id");

-- CreateIndex
CREATE INDEX "idx_position_legs_position_status" ON "position_legs"("position_id", "leg_status");

-- CreateIndex
CREATE INDEX "idx_position_legs_underlying_symbol" ON "position_legs"("underlying_symbol");

-- CreateIndex
CREATE INDEX "idx_position_actions_action_timestamp_desc" ON "position_actions"("action_timestamp" DESC);

-- CreateIndex
CREATE INDEX "idx_position_actions_action_type" ON "position_actions"("action_type");

-- CreateIndex
CREATE INDEX "idx_position_actions_position_id" ON "position_actions"("position_id");

-- CreateIndex
CREATE INDEX "idx_position_actions_position_timestamp" ON "position_actions"("position_id", "action_timestamp");

-- CreateIndex
CREATE INDEX "idx_action_leg_changes_new_leg_id" ON "action_leg_changes"("new_leg_id");

-- CreateIndex
CREATE INDEX "idx_action_leg_changes_old_leg_id" ON "action_leg_changes"("old_leg_id");

-- CreateIndex
CREATE INDEX "idx_action_leg_changes_position_action_id" ON "action_leg_changes"("position_action_id");

-- CreateIndex
CREATE INDEX "idx_attachments_journal_entry_id" ON "attachments"("journal_entry_id");

-- CreateIndex
CREATE INDEX "idx_attachments_position_id" ON "attachments"("position_id");

-- CreateIndex
CREATE INDEX "idx_cash_ledger_broker_account_id" ON "cash_ledger"("broker_account_id");

-- CreateIndex
CREATE INDEX "idx_cash_ledger_linked_holding_id" ON "cash_ledger"("linked_holding_id");

-- CreateIndex
CREATE INDEX "idx_cash_ledger_linked_position_id" ON "cash_ledger"("linked_position_id");

-- CreateIndex
CREATE INDEX "idx_cash_ledger_txn_timestamp_desc" ON "cash_ledger"("txn_timestamp" DESC);

-- CreateIndex
CREATE INDEX "idx_cash_ledger_txn_type" ON "cash_ledger"("txn_type");

-- CreateIndex
CREATE INDEX "idx_execution_links_execution_id" ON "execution_links"("execution_id");

-- CreateIndex
CREATE INDEX "idx_execution_links_holding_event_id" ON "execution_links"("holding_event_id");

-- CreateIndex
CREATE INDEX "idx_execution_links_holding_id" ON "execution_links"("holding_id");

-- CreateIndex
CREATE INDEX "idx_execution_links_position_action_id" ON "execution_links"("position_action_id");

-- CreateIndex
CREATE INDEX "idx_execution_links_position_id" ON "execution_links"("position_id");

-- CreateIndex
CREATE INDEX "idx_execution_links_position_leg_id" ON "execution_links"("position_leg_id");

-- CreateIndex
CREATE INDEX "idx_execution_links_target_type" ON "execution_links"("target_type");

-- CreateIndex
CREATE INDEX "idx_executions_asset_class" ON "executions"("asset_class");

-- CreateIndex
CREATE INDEX "idx_executions_broker_account_id" ON "executions"("broker_account_id");

-- CreateIndex
CREATE INDEX "idx_executions_execution_timestamp_desc" ON "executions"("execution_timestamp" DESC);

-- CreateIndex
CREATE INDEX "idx_executions_expiry_strike" ON "executions"("expiry_date", "strike_price");

-- CreateIndex
CREATE INDEX "idx_executions_import_batch_id" ON "executions"("import_batch_id");

-- CreateIndex
CREATE INDEX "idx_executions_open_close" ON "executions"("open_close");

-- CreateIndex
CREATE INDEX "idx_executions_order_id" ON "executions"("order_id");

-- CreateIndex
CREATE INDEX "idx_executions_raw_transaction_id" ON "executions"("raw_transaction_id");

-- CreateIndex
CREATE INDEX "idx_executions_side" ON "executions"("side");

-- CreateIndex
CREATE INDEX "idx_executions_underlying_symbol" ON "executions"("underlying_symbol");

-- CreateIndex
CREATE UNIQUE INDEX "uq_executions_account_broker_execution" ON "executions"("broker_account_id", "broker_execution_id") WHERE (broker_execution_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_holding_events_event_timestamp_desc" ON "holding_events"("event_timestamp" DESC);

-- CreateIndex
CREATE INDEX "idx_holding_events_event_type" ON "holding_events"("event_type");

-- CreateIndex
CREATE INDEX "idx_holding_events_holding_id" ON "holding_events"("holding_id");

-- CreateIndex
CREATE INDEX "idx_holding_events_linked_position_action_id" ON "holding_events"("linked_position_action_id");

-- CreateIndex
CREATE INDEX "idx_holdings_holding_status" ON "holdings"("holding_status");

-- CreateIndex
CREATE INDEX "idx_holdings_linked_position_id" ON "holdings"("linked_position_id");

-- CreateIndex
CREATE INDEX "idx_holdings_symbol" ON "holdings"("symbol");

-- CreateIndex
CREATE INDEX "idx_holdings_symbol_status" ON "holdings"("symbol", "holding_status");

-- CreateIndex
CREATE INDEX "idx_import_batches_broker_account_id" ON "import_batches"("broker_account_id");

-- CreateIndex
CREATE INDEX "idx_import_batches_imported_at_desc" ON "import_batches"("imported_at" DESC);

-- CreateIndex
CREATE INDEX "idx_import_batches_status" ON "import_batches"("batch_status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_import_batches_file_hash_per_account" ON "import_batches"("broker_account_id", "file_hash") WHERE (file_hash IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_position_id_key" ON "journal_entries"("position_id");

-- CreateIndex
CREATE INDEX "idx_orders_broker_account_id" ON "orders"("broker_account_id");

-- CreateIndex
CREATE INDEX "idx_orders_broker_order_id" ON "orders"("broker_order_id");

-- CreateIndex
CREATE INDEX "idx_orders_import_batch_id" ON "orders"("import_batch_id");

-- CreateIndex
CREATE INDEX "idx_orders_placed_at_desc" ON "orders"("placed_at" DESC);

-- CreateIndex
CREATE INDEX "idx_orders_raw_transaction_id" ON "orders"("raw_transaction_id");

-- CreateIndex
CREATE INDEX "idx_orders_underlying_symbol" ON "orders"("underlying_symbol");

-- CreateIndex
CREATE UNIQUE INDEX "uq_orders_account_broker_order" ON "orders"("broker_account_id", "broker_order_id") WHERE (broker_order_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_position_notes_note_timestamp_desc" ON "position_notes"("note_timestamp" DESC);

-- CreateIndex
CREATE INDEX "idx_position_notes_position_id" ON "position_notes"("position_id");

-- CreateIndex
CREATE INDEX "idx_raw_transactions_broker_account_id" ON "raw_transactions"("broker_account_id");

-- CreateIndex
CREATE INDEX "idx_raw_transactions_broker_transaction_id" ON "raw_transactions"("broker_transaction_id");

-- CreateIndex
CREATE INDEX "idx_raw_transactions_event_timestamp_desc" ON "raw_transactions"("event_timestamp" DESC);

-- CreateIndex
CREATE INDEX "idx_raw_transactions_import_batch_id" ON "raw_transactions"("import_batch_id");

-- CreateIndex
CREATE INDEX "idx_raw_transactions_type" ON "raw_transactions"("raw_txn_type");

-- CreateIndex
CREATE INDEX "idx_tag_links_journal_entry_id" ON "tag_links"("journal_entry_id");

-- CreateIndex
CREATE INDEX "idx_tag_links_position_id" ON "tag_links"("position_id");

-- CreateIndex
CREATE INDEX "idx_tag_links_tag_id" ON "tag_links"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_tag_links_journal_target" ON "tag_links"("tag_id", "journal_entry_id") WHERE (journal_entry_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_tag_links_position_target" ON "tag_links"("tag_id", "position_id") WHERE (position_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "idx_workspace_preferences_active_broker_account_id" ON "workspace_preferences"("active_broker_account_id");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_active_broker_account_id_fkey" FOREIGN KEY ("active_broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "broker_accounts" ADD CONSTRAINT "broker_accounts_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "broker_accounts" ADD CONSTRAINT "broker_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "fk_positions_linked_holding" FOREIGN KEY ("linked_holding_id") REFERENCES "holdings"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "position_legs" ADD CONSTRAINT "position_legs_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "position_legs" ADD CONSTRAINT "position_legs_parent_leg_id_fkey" FOREIGN KEY ("parent_leg_id") REFERENCES "position_legs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "position_actions" ADD CONSTRAINT "position_actions_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "action_leg_changes" ADD CONSTRAINT "action_leg_changes_position_action_id_fkey" FOREIGN KEY ("position_action_id") REFERENCES "position_actions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "action_leg_changes" ADD CONSTRAINT "action_leg_changes_old_leg_id_fkey" FOREIGN KEY ("old_leg_id") REFERENCES "position_legs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "action_leg_changes" ADD CONSTRAINT "action_leg_changes_new_leg_id_fkey" FOREIGN KEY ("new_leg_id") REFERENCES "position_legs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cash_ledger" ADD CONSTRAINT "cash_ledger_linked_holding_id_fkey" FOREIGN KEY ("linked_holding_id") REFERENCES "holdings"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cash_ledger" ADD CONSTRAINT "cash_ledger_linked_position_id_fkey" FOREIGN KEY ("linked_position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "execution_links" ADD CONSTRAINT "execution_links_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "executions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "execution_links" ADD CONSTRAINT "execution_links_holding_event_id_fkey" FOREIGN KEY ("holding_event_id") REFERENCES "holding_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "execution_links" ADD CONSTRAINT "execution_links_holding_id_fkey" FOREIGN KEY ("holding_id") REFERENCES "holdings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "execution_links" ADD CONSTRAINT "execution_links_position_action_id_fkey" FOREIGN KEY ("position_action_id") REFERENCES "position_actions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "execution_links" ADD CONSTRAINT "execution_links_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "execution_links" ADD CONSTRAINT "execution_links_position_leg_id_fkey" FOREIGN KEY ("position_leg_id") REFERENCES "position_legs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_raw_transaction_id_fkey" FOREIGN KEY ("raw_transaction_id") REFERENCES "raw_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "holding_events" ADD CONSTRAINT "holding_events_holding_id_fkey" FOREIGN KEY ("holding_id") REFERENCES "holdings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "holding_events" ADD CONSTRAINT "holding_events_linked_position_action_id_fkey" FOREIGN KEY ("linked_position_action_id") REFERENCES "position_actions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_linked_position_id_fkey" FOREIGN KEY ("linked_position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_raw_transaction_id_fkey" FOREIGN KEY ("raw_transaction_id") REFERENCES "raw_transactions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "position_notes" ADD CONSTRAINT "position_notes_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "raw_transactions" ADD CONSTRAINT "raw_transactions_broker_account_id_fkey" FOREIGN KEY ("broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "raw_transactions" ADD CONSTRAINT "raw_transactions_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tag_links" ADD CONSTRAINT "tag_links_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tag_links" ADD CONSTRAINT "tag_links_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tag_links" ADD CONSTRAINT "tag_links_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "workspace_preferences" ADD CONSTRAINT "workspace_preferences_active_broker_account_id_fkey" FOREIGN KEY ("active_broker_account_id") REFERENCES "broker_accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
