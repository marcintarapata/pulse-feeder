# GitHub → Pulse feeder

Feeds the **Repositories** and **Recent activity** tiles on the Pulse "GITHUB" board at <https://pulse.lola.farm> (board 35, Nell Ashby).

The script posts JSON to `POST /api/widget-data/<tile id>` with `Authorization: Bearer <tile token>` and `Content-Type: application/json`.

| Tile | Id | Body |
| --- | --- | --- |
| Repositories | `PULSE_REPOS_TILE` | `{ "repos": [...], "updatedAt": "<ISO time>" }`. Each repo has `name`, `stars`, `openIssues`, `openPullRequests`, `lastPushAt` (ISO), and `ciStatus` (`passing`, `failing`, `running`, or `none`). The whole list is sent every time. |
| Recent activity | `PULSE_ACTIVITY_TILE` | `{ "events": [...] }`, newest first, at most 15. Each event has `type` (`push`, `pr_opened`, `pr_merged`, `issue_opened`, or `release`), `repo`, `title`, `actor`, and `at` (ISO). The list replaces the previous one. |

Recent activity comes from GitHub's public events feed, so activity in private repositories does not appear. With `PULSE_REPOS` unset, Repositories is the 12 repositories most recently pushed to that the token can see.

Logs print a status code and, for Pulse, the tile id. They do not print tokens, repository names, or response bodies.

## Secrets and variables

In **Settings → Secrets and variables → Actions**:

- Secrets: `PULSE_GH_TOKEN` (the PAT below), `PULSE_REPOS_TOKEN`, `PULSE_ACTIVITY_TOKEN`
- Variables: `PULSE_REPOS_TILE`, `PULSE_ACTIVITY_TILE`, and optionally `PULSE_REPOS` (`owner/a,owner/b`)

`PULSE_REPOS_TOKEN`, `PULSE_ACTIVITY_TOKEN`, `PULSE_REPOS_TILE`, and `PULSE_ACTIVITY_TILE` are already set. `PULSE_REPOS` is left unset on purpose. `PULSE_GH_TOKEN` is not set: add it before the first run, or the scheduled job fails.

### Fine-grained PAT for `PULSE_GH_TOKEN`

Create a fine-grained personal access token:

- Resource owner: the account whose repositories should appear
- Repository access: only the repositories that should appear on the board
- Repository permissions, all **Read-only**: **Actions**, **Issues**, **Metadata**, **Pull requests**
- No account permissions and no write permissions

Then add it (the prompt reads the token from stdin and does not print it):

```sh
gh secret set PULSE_GH_TOKEN --repo marcintarapata/pulse-feeder
```

## Schedule

**Actions → Feed Pulse board** runs every 15 minutes, and you can run it by hand. Do not run it until `PULSE_GH_TOKEN` is set. GitHub may delay the schedule.

## Instant updates (optional)

Copy [`examples/notify-pulse.yml`](examples/notify-pulse.yml) into another repository as `.github/workflows/notify-pulse.yml`, and add a `PULSE_DISPATCH_TOKEN` secret there (a fine-grained PAT with Contents read and write on `marcintarapata/pulse-feeder` only). Pushes, pull requests, issues, and releases in that repository then trigger a refresh straight away.

## Run locally

```sh
GH_TOKEN=... PULSE_URL=https://pulse.lola.farm \
PULSE_REPOS_TILE=... PULSE_REPOS_TOKEN=... \
PULSE_ACTIVITY_TILE=... PULSE_ACTIVITY_TOKEN=... \
bun scripts/pulse-feed.ts
```

`GH_TOKEN` for a local run stays in the environment for that command. Do not write it into a file or a GitHub secret of this repo; the Actions secret is the fine-grained PAT above.

## Stocks board

Feeds the four tiles on the Pulse "STOCKS" board (Nell Ashby). **Actions → Feed Pulse stocks board** runs every 15 minutes, and you can run it by hand. The schedule stays at 15 minutes so Twelve Data stays under its free daily credit cap (about 6 credits per run).

The script posts JSON to the same `POST /api/widget-data/<tile id>` endpoint, with `Authorization: Bearer <tile token>`.

| Tile | Id variable | Body |
| --- | --- | --- |
| Watchlist | `PULSE_WATCHLIST_TILE` | `{ "currency": "USD", "symbols": [...] }`. Each symbol has `symbol`, `name`, `price`, `changePct` (percent, so 1.24 means +1.24%), and `spark` (recent prices, oldest first). The whole list is sent every time. |
| Featured stock | `PULSE_FEATURED_TILE` | `{ "symbol", "name", "currency", "price", "previousClose", "points": [{ "t", "price" }] }`. `points` is today's session, oldest first, `t` an ISO time. |
| Portfolio | `PULSE_PORTFOLIO_TILE` | `{ "currency", "totalValue", "dayChange", "dayChangePct", "holdings": [{ "symbol", "value" }] }`. `dayChangePct` is a percent. Values are dollars. |
| Market news | `PULSE_NEWS_TILE` | `{ "articles": [...] }`, newest first, at most 12. Each article has `headline`, `source`, `symbol`, and `publishedAt` (ISO). The list replaces the previous one. |

### Secrets and variables

- Secrets: `FINNHUB_API_KEY`, `TWELVEDATA_API_KEY`, `PULSE_WATCHLIST_TOKEN`, `PULSE_FEATURED_TOKEN`, `PULSE_PORTFOLIO_TOKEN`, `PULSE_NEWS_TOKEN`
- Variables: `PULSE_WATCHLIST_TILE`, `PULSE_FEATURED_TILE`, `PULSE_PORTFOLIO_TILE`, `PULSE_NEWS_TILE`

The tile ids and tokens are set. `FINNHUB_API_KEY` and `TWELVEDATA_API_KEY` are repository secrets too; they are not stored in this repo. Logs print a status code and, for Pulse, the tile id. They do not print keys, tokens, request URLs, or response bodies.

```sh
FINNHUB_API_KEY=... TWELVEDATA_API_KEY=... PULSE_URL=https://pulse.lola.farm \
PULSE_WATCHLIST_TILE=... PULSE_WATCHLIST_TOKEN=... \
PULSE_FEATURED_TILE=... PULSE_FEATURED_TOKEN=... \
PULSE_PORTFOLIO_TILE=... PULSE_PORTFOLIO_TOKEN=... \
PULSE_NEWS_TILE=... PULSE_NEWS_TOKEN=... \
bun scripts/stocks-feed.ts
```
