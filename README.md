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
