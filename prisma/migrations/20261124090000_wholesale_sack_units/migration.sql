-- Bag sizes for wholesale items (5, 10, 15, 25 kg), sold and bought as their own units next to kilo, ton and carton.
ALTER TYPE "WhUnit" ADD VALUE IF NOT EXISTS 'SACK_5';
ALTER TYPE "WhUnit" ADD VALUE IF NOT EXISTS 'SACK_10';
ALTER TYPE "WhUnit" ADD VALUE IF NOT EXISTS 'SACK_15';
ALTER TYPE "WhUnit" ADD VALUE IF NOT EXISTS 'SACK_25';
