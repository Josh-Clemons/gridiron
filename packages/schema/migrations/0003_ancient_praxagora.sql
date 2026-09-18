ALTER TYPE "public"."pick_source" ADD VALUE 'correction';--> statement-breakpoint
CREATE TABLE "pick_corrections" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pick_corrections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"league_id" bigint NOT NULL,
	"actor_member_id" bigint NOT NULL,
	"target_member_id" bigint NOT NULL,
	"season_id" bigint NOT NULL,
	"week" integer NOT NULL,
	"slot" "slot" NOT NULL,
	"from_team_id" bigint,
	"to_team_id" bigint,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pick_corrections_week_positive" CHECK ("pick_corrections"."week" >= 1),
	CONSTRAINT "pick_corrections_from_to_differ" CHECK ("pick_corrections"."from_team_id" is null
          or "pick_corrections"."to_team_id" is null
          or "pick_corrections"."from_team_id" <> "pick_corrections"."to_team_id")
);
--> statement-breakpoint
ALTER TABLE "pick_corrections" ADD CONSTRAINT "pick_corrections_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_corrections" ADD CONSTRAINT "pick_corrections_actor_member_id_league_members_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."league_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_corrections" ADD CONSTRAINT "pick_corrections_target_member_id_league_members_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."league_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_corrections" ADD CONSTRAINT "pick_corrections_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_corrections" ADD CONSTRAINT "pick_corrections_from_team_id_teams_id_fk" FOREIGN KEY ("from_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_corrections" ADD CONSTRAINT "pick_corrections_to_team_id_teams_id_fk" FOREIGN KEY ("to_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pick_corrections_league_season_idx" ON "pick_corrections" USING btree ("league_id","season_id");