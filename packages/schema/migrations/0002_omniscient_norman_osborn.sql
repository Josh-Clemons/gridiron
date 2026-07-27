DROP INDEX "champions_league_year_pool_key";--> statement-breakpoint
CREATE UNIQUE INDEX "champions_league_year_pool_name_key" ON "champions" USING btree ("league_id","year","pool","display_name");--> statement-breakpoint
CREATE INDEX "champions_league_year_idx" ON "champions" USING btree ("league_id","year");