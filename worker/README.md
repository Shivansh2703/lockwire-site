# Lockwire assistant (Cloudflare Worker)

Answers visitors' questions about the robot on the demo. Read-only. Uses the Claude API (`claude-haiku-5-5`) and your own key, with a $9.50 monthly cap and 10 questions per visitor per day.

## Owner steps, in order

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up.
2. In this folder: `npm install`, then `npx wrangler login`.
3. Create the KV store: `npx wrangler kv namespace create LIMITS`. Paste the `id` it prints into `wrangler.toml` in place of `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`.
4. In the Anthropic Console (https://console.anthropic.com), create a separate workspace for the site, make an API key in it, and set that workspace's monthly spend limit to $10. That limit is the hard backstop if anything here fails.
5. `npx wrangler secret put ANTHROPIC_API_KEY` and paste the key at the prompt. Never put the key in a file.
6. `npx wrangler deploy`. It prints the Worker URL (`https://lockwire-assistant.<you>.workers.dev`).
7. Tell the site about it: in the GitHub repo, Settings > Secrets and variables > Actions > Variables, add `PUBLIC_ASSISTANT_URL` = the Worker URL. Then add `env: PUBLIC_ASSISTANT_URL: ${{ vars.PUBLIC_ASSISTANT_URL }}` to the `npm run build` step in `.github/workflows/pages.yml` and push. Without the variable the site shows no Ask box.

Local dev: `npm run dev` (Worker) and `PUBLIC_ASSISTANT_URL=http://127.0.0.1:8787 npm run dev` in the site root. Put a test key in `worker/.dev.vars` (git-ignored) as `ANTHROPIC_API_KEY=...`.

## How the limits work

- Spend: after each call the cost is computed from the response's token usage and added to a KV counter `spend:YYYY-MM` (UTC). At or above `MONTHLY_CAP_USD` (9.5) the Worker answers 429 without calling the API. KV is eventually consistent, hence the margin under $10.
- Rate: KV key `rl:<date>:<hash of IP + date>`, 10 per UTC day. The raw IP is never stored.
- Prices live in one block (`PRICE`) in `src/index.ts`; update it if Anthropic changes them.
- The robot data is bundled from `../src/data` at deploy time, so redeploy the Worker when that data changes.

Checks: `npm test`, `npx tsc --noEmit`.
