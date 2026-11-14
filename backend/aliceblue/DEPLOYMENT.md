# IWSM — Alice Blue Live Option Chain: Deployment Notes

This document explains how to run and deploy the Python backend for the live
option-chain feature. It is written for whoever operates the infrastructure; the
beginner guide is in `USER_GUIDE.md`.

## 1. The deployment reality (important)

Your website is currently a **static HTML/CSS/JS site published to Netlify** with
Netlify Functions (Node.js). Netlify's standard static hosting and Node functions
**cannot run the Python FastAPI backend** or hold a persistent broker WebSocket
connection.

The Alice Blue integration must therefore run as a **separate Python service**.
The recommended topology:

```
Netlify (static site + Node functions)   ←  your existing hosting
        │
        │  the site calls /api/aliceblue/* on the same origin
        ▼
Reverse proxy (HTTPS) → Python FastAPI backend (port 4180)
        │
        ▼
Alice Blue ANT A3 API
```

Because the website and the Python backend are on different origins in production,
you either:

- **A.** Put the Python backend behind a reverse proxy **on the same domain**
  (e.g. `api.yourdomain.com` or a path on `yourdomain.com`), so the browser treats
  it as same-origin, **or**
- **B.** Run it on a separate domain and restrict CORS to exactly your website
  origin. A CORS allowlist is **not** authentication — do not rely on it alone.

## 2. Hosting options for the Python service

Choose one that supports Python + persistent connections:

- **Render** (web service), **Railway**, **Fly.io**, or **PythonAnywhere**
  (for a simple always-on service), or
- A small **VPS** (e.g. DigitalOcean droplet) where you manage the process with
  `systemd`.

When the REST flow is verified, you can add the WebSocket (Phase 12 of the brief)
inside this same service.

## 3. Local development

Backend (Terminal 1):

```powershell
cd D:\IWSM WEBSITE
python backend\aliceblue\alice_service.py
```

Web site preview (Terminal 2):

```powershell
node tools\local-preview.cjs
```

Open `http://127.0.0.1:4174/strategy-builder.html`. The Node preview forwards
`/api/aliceblue/*` to the backend on `127.0.0.1:4180`.

Tests:

```powershell
python backend\aliceblue\run_tests.py
```

## 4. Environment variables (secrets)

On the hosting provider, put these in the provider's **secrets / environment
variables** — never in a file committed to Git.

| Variable | Purpose |
|---|---|
| `ALICEBLUE_APP_CODE` | Your Alice Blue app code (ANT login) |
| `ALICEBLUE_API_SECRET` | Your Alice Blue API secret |
| `ALICEBLUE_REDIRECT_URL` | Registered callback URL. In production this must be the **deployed HTTPS callback** (e.g. `https://api.yourdomain.com/api/aliceblue/auth/callback`) — not `127.0.0.1` |
| `ALICEBLUE_CLIENT_ID` | Optional; your client ID if the broker's redirect omits `state` |
| `ALICEBLUE_SESSION_ENCRYPTION_KEY` | Optional; if empty a Fernet key is generated and stored beside the session database on first start |
| `ALICEBLUE_BASE_URL` | `https://a3.aliceblueonline.com` (fixed, trusted) |
| `ALICEBLUE_DEFAULT_EXCHANGE` | `nse_fo` |
| `ALICEBLUE_REFRESH_SECONDS` | `5` |

Private data lives outside the repo so it is never committed. If a secret is ever
leaked, **rotate/regenerate it in the Alice Blue Developer Portal** and update the
hosting secret.

## 5. Persistence

- Encrypted broker sessions are stored in a SQLite file
  (`aliceblue-sessions.sqlite3`) beside the env config, encrypted with the session
  key. In production, point this at a **persistent volume/disk** so sessions
  survive restarts.
- The session encryption key (if auto-generated) is stored next to it; keep it
  safe and include it in your disaster-recovery backup.

## 6. Production start command

```bash
uvicorn alice_service:build --host 127.0.0.1 --port 4180 --workers 1
```

Run behind a reverse proxy; bind to `127.0.0.1`, not the public interface.

Example `systemd` unit (VPS):

```ini
[Unit]
Description=IWSM Alice Blue backend
After=network.target

[Service]
WorkingDirectory=/srv/iwsm/backend/aliceblue
EnvironmentFile=/etc/iwsm/aliceblue.env
ExecStart=/srv/iwsm/backend/aliceblue/.venv/bin/uvicorn alice_service:build --host 127.0.0.1 --port 4180 --workers 1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 7. Reverse proxy + HTTPS

Terminate TLS at your proxy (certbot/Caddy). Forward `/api/aliceblue/*` to the
backend.

Nginx:

```nginx
location /api/aliceblue/ {
    proxy_pass http://127.0.0.1:4180;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Origin $http_origin;
}
```

Caddy:

```
api.yourdomain.com {
    reverse_proxy /api/aliceblue/* 127.0.0.1:4180
}
```

The backend already applies strict security headers (`Cache-Control: no-store`,
`Content-Security-Policy`), validates the `Origin`, and only allows the configured
origin.

## 8. Health check

`GET /api/aliceblue/health` returns:

```json
{ "service": "aliceblue-read-only", "ready": false, "websocket": "not connected" }
```

- `ready: true` means App Code and API Secret are configured.
- `websocket` reflects the optional Phase 12 stage.

Use this in your host's uptime/health checks.

## 9. Public access control

The market-data routes require an authenticated Alice Blue session (an `iwsm_alice`
HTTP-only cookie set by the backend). There is no anonymous broker-data proxy. If
your site itself is public, the "Connect Alice Blue" flow is the gate: a browser
must complete the broker login before it can read market data. Do not unset CORS
or relax the Origin check to allow arbitrary sites.
