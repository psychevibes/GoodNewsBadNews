# GoodNewsBadNews

News sentiment across the web. The site in `docs/` is static. `fetcher.py` writes the JSON those pages read. The scheduled workflow runs `tests/test_fetcher.py`, then the fetcher, then commits the data files. Feature pull requests leave those data files alone so the next run can rewrite them.

## How a headline is scored

The public pages describe this in plain language. The field names live here.

The label is chosen before the cap. Positive is an adjusted value ≥ 0.05, negative is ≤ −0.05, and anything between is neutral.

- `vader` is the raw VADER compound for the title and RSS summary. It stays on −1…+1 and is stored to 3 decimal places.
- Matching keyword patterns then add or subtract 0.1. The label uses that adjusted value, still uncapped.
- `score` is the adjusted value clamped to [−1, 1]. Rows that would have gone further sit at ±1.00. In a recent 24-hour window that was about 7% of rows.
- `id` is a stable hash of the title and URL. Published headlines keep it.
- `latest.json` also has `fetched_at` and `next_run_at`, both UTC. `next_run_at` is the next :00 or :30 after the fetch. The workflow cron is every 30 minutes.

Outlets are mapped to a home region. Unknown outlets, including Brazil News (that feed is CNN Americas, not a Brazilian newsroom), are Global. Global is left off the region bars. When the count is above zero, the page says how many headlines from international outlets are not counted in a region. When the count is zero, that note is hidden.
