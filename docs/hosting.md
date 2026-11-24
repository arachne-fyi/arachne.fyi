# Hosting

Target: `app.arachne.fyi` for the dashboard and API, `arachne.fyi` for the landing page and
jar download. Both are served by the same container; `LANDING_HOST` decides which page `/`
shows.

## 1. Discord login

1. https://discord.com/developers/applications → **New Application**.
2. **OAuth2** → copy the Client ID and reset/copy the Client Secret.
3. **OAuth2 → Redirects** → add `https://app.arachne.fyi/auth/discord/callback`
   (and `http://localhost:5173/auth/discord/callback` for local testing).
4. In `.env`:
   ```
   PUBLIC_URL=https://app.arachne.fyi
   DISCORD_CLIENT_ID=...
   DISCORD_CLIENT_SECRET=...
   ADMIN_DISCORD_IDS=<your Discord user id>
   DEV_AUTH=0
   ```

The server only asks Discord for the `identify` scope (who you are), and does not keep
Discord's token.

## 2. Cloudflare

1. The domain must use Cloudflare DNS: add `arachne.fyi` to Cloudflare and point the
   registrar's nameservers at the two Cloudflare gives you.
2. **Zero Trust → Networks → Tunnels → Create a tunnel** (type Cloudflared). Copy the token
   into `.env` as `TUNNEL_TOKEN=`.
3. In the tunnel, add two **public hostnames**, both to service `http://app:8787`
   (`app` is the container name from `docker-compose.yml`):
   - `app.arachne.fyi`
   - `arachne.fyi`

No router ports are opened. cloudflared dials out to Cloudflare.

## 3. Run

```bash
docker compose up -d --build
docker compose logs -f app
```

Data lives in `./data` next to `docker-compose.yml`:

| Path               | What                                              | Back up?                |
| ------------------ | ------------------------------------------------- | ----------------------- |
| `events/*.ndjson`  | every event ever received (gzipped after 2 days)  | yes                     |
| `prices/*.ndjson`  | Bazaar snapshots                                  | yes                     |
| `state.db`         | users, tokens, account settings                   | yes                     |
| `index.db`         | derived; `rebuild-index` recreates it             | no                      |
| `downloads/*.jar`  | mod builds served at `/download/latest`           | optional                |

To copy SQLite safely while running, use `sqlite3 data/state.db ".backup state-backup.db"`,
or stop the container first.

Rebuild the index (e.g. after changing a rule):

```bash
docker compose stop app
docker compose run --rm app node --disable-warning=ExperimentalWarning dist/store/rebuild-cli.js
docker compose start app
```

## 4. Publishing a mod build

Either upload the jar on the dashboard's **Admin** page, or copy it straight into
`data/downloads/`. Name it `arachne-fyi-<mod version>+<Minecraft version>.jar`, e.g.
`arachne-fyi-2.0.0+26.2.jar`. The public page at `/download` lists every build grouped by
Minecraft version; `/download/latest` always serves the newest upload.

## Moving to a Raspberry Pi 5 or an old PC

Copy the repo folder including `data/` and `.env`, then `docker compose up -d --build`. The
image has no native modules, so it builds the same on arm64.

## Without Docker

```bash
npm ci && npm run build
NODE_ENV=production WEB_DIR=web/dist npm start
cloudflared tunnel run --token <TUNNEL_TOKEN>    # and point the hostnames at http://localhost:8787
```
