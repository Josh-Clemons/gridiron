CREATE TYPE "public"."game_status" AS ENUM('scheduled', 'final');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."pick_source" AS ENUM('app', 'import');--> statement-breakpoint
CREATE TYPE "public"."pool" AS ENUM('regular', 'playoff');--> statement-breakpoint
CREATE TYPE "public"."slot" AS ENUM('win', 'place', 'show');--> statement-breakpoint
CREATE TABLE "champions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "champions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"league_id" bigint NOT NULL,
	"year" integer NOT NULL,
	"pool" "pool" NOT NULL,
	"member_id" bigint,
	"display_name" text NOT NULL,
	"total_points" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "games_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"season_id" bigint NOT NULL,
	"week" integer NOT NULL,
	"home_team_id" bigint NOT NULL,
	"away_team_id" bigint NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"status" "game_status" DEFAULT 'scheduled' NOT NULL,
	"winner_team_id" bigint,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_teams_differ" CHECK ("games"."home_team_id" <> "games"."away_team_id"),
	CONSTRAINT "games_winner_is_a_participant" CHECK ("games"."winner_team_id" is null
          or "games"."winner_team_id" = "games"."home_team_id"
          or "games"."winner_team_id" = "games"."away_team_id"),
	CONSTRAINT "games_winner_only_when_final" CHECK ("games"."status" = 'final' or "games"."winner_team_id" is null)
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "league_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"league_id" bigint NOT NULL,
	"user_id" bigint,
	"display_name" text NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leagues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "picks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "picks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"league_member_id" bigint NOT NULL,
	"season_id" bigint NOT NULL,
	"week" integer NOT NULL,
	"slot" "slot" NOT NULL,
	"team_id" bigint NOT NULL,
	"source" "pick_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "picks_week_positive" CHECK ("picks"."week" >= 1)
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "seasons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"year" integer NOT NULL,
	"week_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seasons_week_count_sane" CHECK ("seasons"."week_count" between 1 and 25)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_aliases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "team_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"team_id" bigint NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_aliases_alias_normalised" CHECK ("team_aliases"."alias" = upper(btrim("team_aliases"."alias")))
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "teams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_has_at" CHECK (position('@' in "users"."email") > 1)
);
--> statement-breakpoint
ALTER TABLE "champions" ADD CONSTRAINT "champions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champions" ADD CONSTRAINT "champions_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_league_member_id_league_members_id_fk" FOREIGN KEY ("league_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_aliases" ADD CONSTRAINT "team_aliases_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "champions_league_year_pool_key" ON "champions" USING btree ("league_id","year","pool");--> statement-breakpoint
CREATE UNIQUE INDEX "games_season_week_home_key" ON "games" USING btree ("season_id","week","home_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_external_id_key" ON "games" USING btree ("season_id","external_id") WHERE "games"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "games_season_week_idx" ON "games" USING btree ("season_id","week");--> statement-breakpoint
CREATE UNIQUE INDEX "league_members_league_user_key" ON "league_members" USING btree ("league_id","user_id") WHERE "league_members"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "league_members_league_idx" ON "league_members" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "league_members_user_idx" ON "league_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_invite_code_key" ON "leagues" USING btree ("invite_code");--> statement-breakpoint
CREATE UNIQUE INDEX "picks_member_season_week_slot_key" ON "picks" USING btree ("league_member_id","season_id","week","slot") WHERE "picks"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "picks_member_season_slot_team_key" ON "picks" USING btree ("league_member_id","season_id","slot","team_id") WHERE "picks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "picks_member_season_week_idx" ON "picks" USING btree ("league_member_id","season_id","week");--> statement-breakpoint
CREATE INDEX "picks_season_week_idx" ON "picks" USING btree ("season_id","week");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_year_key" ON "seasons" USING btree ("year");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "team_aliases_alias_key" ON "team_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "team_aliases_team_id_idx" ON "team_aliases" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_code_key" ON "teams" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));