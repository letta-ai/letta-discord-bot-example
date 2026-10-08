# Deploying

The listener is a long-running worker. It keeps one outbound Discord Gateway connection, calls the
Letta API, and stores a small SQLite route index in `DATA_DIR`. It needs no inbound traffic, so
do not give it a public URL.

Every platform below has to meet four requirements:

1. **Exactly one instance.** A second process with the same bot token opens a second Gateway
   session and duplicates replies. Never scale replicas, and use deploys that stop the old
   instance before starting the new one.
2. **Persistent `DATA_DIR`.** If it is lost, existing conversations stay in Letta but Discord
   threads start new ones.
3. **About 30 seconds to stop.** On `SIGTERM` the listener cancels pending approval cards and
   closes sessions, which can take up to 15 seconds.
4. **Health check at `GET /healthz`** on `HEALTH_PORT` (default 8080). It returns 200 once
   Discord is ready and 503 while connecting.

Run `bun run doctor` with the production settings before the first deploy. It validates the token,
Message Content intent, channel permissions, Letta agent, computer, transcription key, and
`DATA_DIR`, without connecting to the Gateway.

| Platform | Fits | Notes |
| --- | --- | --- |
| [systemd](#systemd) | Yes | Any Linux VM. Tested end to end. |
| [Docker Compose](#docker-compose) | Yes | Any Docker host. |
| [Fly.io](#flyio) | Yes | One Machine plus a volume. |
| [Railway](#railway) | Yes | A volume blocks overlapping deploys. |
| [Render](#render) | Yes, paid | A background worker. The disk is mandatory. |
| [Modal](#modal) | No | Built for functions and jobs, not a single persistent socket. |

## systemd

Tested on Debian 12 with systemd 252: the service starts as an unprivileged user under the
sandboxing options in the unit, reports ready, restarts within about 8 seconds after `kill -9`,
and stops cleanly.

```bash
# 1. Runtime and user
curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash   # installs /usr/local/bin/bun
sudo useradd --system --no-create-home --shell /usr/sbin/nologin letta-discord

# 2. Code, owned by root and readable by the service user
sudo git clone https://github.com/letta-ai/letta-discord-bot-example /opt/letta-discord-listener
cd /opt/letta-discord-listener
sudo npm ci --omit=dev --no-audit --no-fund
sudo chmod -R u=rwX,go=rX /opt/letta-discord-listener   # required if your umask is 077

# 3. Settings, readable only by root (systemd reads them before dropping privileges)
sudo install -m 600 .env.example /etc/letta-discord-listener.env
sudoedit /etc/letta-discord-listener.env

# 4. Service
sudo cp deploy/systemd/letta-discord-listener.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now letta-discord-listener
journalctl -u letta-discord-listener -f
```

The unit stores state in `/var/lib/letta-discord-listener` via `StateDirectory=` and pins
`DATA_DIR` there, so the `DATA_DIR=./data` line from `.env.example` cannot point it at the
read-only `/opt` tree. To run doctor against the same settings:

```bash
sudo bash -c 'set -a; . /etc/letta-discord-listener.env; set +a; cd /opt/letta-discord-listener; DATA_DIR=/var/lib/letta-discord-listener bun run doctor'
```

Update with `git pull`, `npm ci --omit=dev`, then `systemctl restart letta-discord-listener`.

## Docker Compose

```bash
cp .env.example .env    # fill in the required values
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml logs -f
```

The Compose file publishes no ports, overrides `DATA_DIR` to the named volume, and allows 30
seconds to stop. With plain `docker run`, set the same things yourself:

```bash
docker build -t letta-discord-listener .
docker run -d --name listener --restart unless-stopped --stop-timeout 30 \
  --env-file .env -e DATA_DIR=/app/data -v listener-data:/app/data letta-discord-listener
```

The image installs dependencies with `npm ci`, runs as the unprivileged `bun` user, and has a
`HEALTHCHECK` on `/healthz` that `docker ps` reports.

### Routing tables in containers

The image copies only `src/`, `package.json`, and `tsconfig.json` into `/app`. Setting
`ROUTES_FILE=./routes.json` does not make a host file appear in the container. Mount the file and
set its in-container path. For Compose, add this to the service:

```yaml
environment:
  ROUTES_FILE: /app/config/routes.json
volumes:
  - ./routes.json:/app/config/routes.json:ro
```

The equivalent `docker run` arguments are:

```bash
-e ROUTES_FILE=/app/config/routes.json \
-v "$PWD/routes.json:/app/config/routes.json:ro"
```

You can instead bake a table into a custom image with `COPY routes.json /app/config/routes.json`.
The repository `.dockerignore` does not exclude JSON files, so a file inside the build context is
available to that instruction. Do not put secrets in the routing table.

On Fly.io, either bake the table with a Dockerfile `COPY` or place it on a mounted volume and set
`ROUTES_FILE` to that volume path. On Railway and Render, bake it into the image or mount it from
persistent storage. In every case, run `bun run doctor` with the same path before relying on the
routing rules.

## Fly.io

```bash
cp fly.toml.example fly.toml          # change `app` and `primary_region`
fly launch --no-deploy --copy-config
fly volumes create listener_data --size 1 --region <primary_region>
fly secrets set DISCORD_BOT_TOKEN=... LETTA_API_KEY=... LETTA_AGENT_ID=...
fly deploy
fly scale count 1
```

The example config has no `[http_service]`. The `[checks]` block monitors `/healthz` inside
Fly's network without opening a public port. With one Machine and a volume, the default `rolling`
strategy updates that Machine in place, so two bots never run at once. Fly does not allow
`canary` or `bluegreen` with volumes. `kill_timeout = "30s"` replaces Fly's 5-second default.
Fly sets the mount's ownership to the image's `USER` (`bun`).

`fly launch` can offer to create extra Machines for availability. Keep the count at one.

## Railway

Configure Railway in the dashboard. The repo ships no `railway.json`: Railway's config-as-code
format is deprecated, stopped applying to services in new projects on 2026-08-28, and is no
longer read after 2026-12-01.

1. Create a service from the GitHub repo. Railway builds the `Dockerfile` automatically.
2. Add a volume to the service mounted at `/app/data`.
3. Set variables: the three required keys plus any optional ones, then:
   - `RAILWAY_RUN_UID=0`. Railway volumes are root-owned, and the image runs as `bun`.
   - `PORT=8080`, so Railway's deploy health check targets the health server.
4. Under Deploy, set the health check path to `/healthz` and keep replicas at 1. Railway only
   checks it during a deploy, waiting up to 300 seconds for a 200.
5. Do not generate a public domain.

A service with a volume cannot have replicas, and Railway stops the old deployment before
starting the new one. Expect a few seconds without the bot on each deploy.

## Render

Use a **Background Worker** (not a Web Service) with a persistent disk. Disks need a paid plan.

1. New Background Worker from the repo, runtime Docker.
2. Add a disk mounted at `/app/data`.
3. Add the required environment variables.

The disk is required, not optional. Without one, Render deploys workers with zero downtime: the
new instance starts while the old one keeps running for 60 seconds, so two bots answer at once.
With a disk, Render limits the service to one instance and stops the old one first.

Render's `healthCheckPath` applies only to web services, so the worker is not health checked.
Not yet verified: whether the disk is writable by the image's non-root `bun` user. If startup
fails with a `DATA_DIR` error, run `bun run doctor` in the Render shell.

## Modal

Not recommended. Modal is designed for functions, jobs, and web endpoints that scale with
demand. The listener needs one process that stays connected indefinitely, never runs twice, and
keeps local state. You can approximate this with a long-timeout function and a Volume, but it
fights the platform's restart and concurrency model. Use a VM, Fly.io, Railway, or Render.

## Execution backends

Where the bot runs is separate from where the agent's tools run. When `LETTA_COMPUTER` is unset,
the SDK creates a managed Cloud sandbox for each conversation. Set `LETTA_COMPUTER` to route tools
to a connected computer, which doctor verifies is online.

If every turn fails with "Letta rejected this bot's credentials", check `LETTA_API_KEY` first. If
the key is valid and only the managed sandbox rejects it, set `LETTA_COMPUTER` to run tools on a
connected computer instead.
