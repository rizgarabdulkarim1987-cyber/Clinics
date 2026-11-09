-- The exchange rate a movement was typed in with (whole dinars for one dollar); empty before any rate was set.
ALTER TABLE "AccountEntry" ADD COLUMN "rate" INTEGER;
