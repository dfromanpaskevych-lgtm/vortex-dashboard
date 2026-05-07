# Deploy to Railway

Quick steps to host the dashboard on Railway (https://railway.app).

## 1. Create the project

1. Sign up / log in at railway.app
2. **New Project → Deploy from GitHub repo** → pick `vortex-dashboard`
3. Railway auto-detects `package.json` and builds with Nixpacks (uses `pnpm-lock.yaml` if present, otherwise npm)

## 2. Set environment variables

In Railway → your service → **Variables** → add:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | TiDB Cloud connection string | Same as Manus uses |
| `DISABLE_AUTH` | `true` | Skips OAuth, treats users as admin |
| `NODE_ENV` | `production` | Auto by Railway |
| `PORT` | (auto) | Railway injects this |

Optional (only if you actively use the feature):
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION` — file uploads to S3
- `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY` — Manus LLM helpers (unused in core dashboard)

If you want real OAuth instead of `DISABLE_AUTH`:
- `JWT_SECRET`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, `OWNER_OPEN_ID`

## 3. Public domain

In Railway → service → **Settings → Networking → Generate Domain** — gives a `*.up.railway.app` URL.

## 4. Auto-deploy

Railway watches the connected GitHub branch (default: `main`). Every push triggers a new build + deploy.

## 5. Verify

- Open the Railway URL
- Dashboard should load without a login screen (DISABLE_AUTH bypasses it)
- Sync page should show DB connection working
- Scheduled auto-sync runs at 02:00 Kyiv time (server-internal scheduler — no external cron needed)

## Notes

- Database stays on TiDB Cloud — Railway hosts only the Node app.
- The Vite build outputs static client to `dist/public`, served by Express in production.
- The internal scheduler (`startScheduledSync`) runs inside the Node process; it requires the service to stay always-on (Railway free tier sleeps after inactivity; consider the $5/mo Hobby plan for 24/7 sync).
