CREATE TABLE "pick_reminders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pick_reminders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"league_member_id" bigint NOT NULL,
	"season_id" bigint NOT NULL,
	"week" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pick_reminders" ADD CONSTRAINT "pick_reminders_league_member_id_league_members_id_fk" FOREIGN KEY ("league_member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_reminders" ADD CONSTRAINT "pick_reminders_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pick_reminders_member_season_week_key" ON "pick_reminders" USING btree ("league_member_id","season_id","week");--> statement-breakpoint
CREATE INDEX "pick_reminders_season_week_idx" ON "pick_reminders" USING btree ("season_id","week");