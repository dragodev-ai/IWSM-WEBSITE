# IWSM — Alice Blue Live Option Chain: User Guide (plain English)

This page explains, in plain language, what was built and how to use it.
You do **not** need to be a programmer to follow this guide.

---

## 1. What has been built

A **read-only** "live option chain" feature inside your existing Strategy Lab.

- It shows **real** option-chain data (Call/Call and Put options with strike prices,
  last traded price, open interest, previous close, open-interest change) from your
  **Alice Blue ANT A3 API** account.
- Nothing here is fake or pre-recorded. If the broker is not connected, the page
  shows the real problem instead of invented rows.
- It does **not** place orders. It is display + refresh only.

The data moves like this:

```
Alice Blue (your account)  →  Python backend (our code)  →  Your website (the table)
```

The **Python backend** is the only thing that talks to Alice Blue with your secret
credentials. Your website never sees those secrets.

---

## 2. Files you should know about

| What | Where |
|---|---|
| Python backend code | `backend/aliceblue/alice_service.py` |
| Backend settings example | `backend/aliceblue/.env.example` |
| Backend tests | `backend/aliceblue/test_alice_service.py` |
| Test runner helper | `backend/aliceblue/run_tests.py` |
| Website frontend (the live chain inside the Simulator) | `js/aliceblue-live.js` (loaded by `strategy-builder.html`) |
| Local preview server | `tools/local-preview.cjs` (port 4174) |
| Preview → Python proxy | `tools/aliceblue-preview-proxy.cjs` |

---

## 3. Where you put your Alice Blue credentials

The backend reads one file on your computer:

```
%LOCALAPPDATA%\IWSM\aliceblue.env
```

On Windows that resolves to:

```
C:\Users\<YourUser>\AppData\Local\IWSM\aliceblue.env
```

> `%LOCALAPPDATA%` usually equals `C:\Users\<You>\AppData\Local`.

### Step 1 — copy the example file

Open this example file and copy it into that location:

```
backend/aliceblue/.env.example
```

Create the `IWSM` folder if it does not exist.

### Step 2 — fill in your values

Open `aliceblue.env` in Notepad and type your values **only replacing the parts
that are currently empty**:

```env
ALICEBLUE_APP_CODE=your-app-code-here
ALICEBLUE_API_SECRET=your-api-secret-here
ALICEBLUE_REDIRECT_URL=http://127.0.0.1:4174/api/aliceblue/auth/callback
ALICEBLUE_CLIENT_ID=
ALICEBLUE_SESSION_ENCRYPTION_KEY=
ALICEBLUE_BASE_URL=https://a3.aliceblueonline.com
ALICEBLUE_DEFAULT_EXCHANGE=nse_fo
ALICEBLUE_REFRESH_SECONDS=5
```

| Field | What to put | Where to find it |
|---|---|---|
| `ALICEBLUE_APP_CODE` | Your app code (the identifier for the ANT login URL) | Alice Blue Developer Portal → your application |
| `ALICEBLUE_API_SECRET` | Your API secret | Same portal application |
| `ALICEBLUE_REDIRECT_URL` | The exact callback URL you registered with Alice Blue. For testing on this PC, `http://127.0.0.1:4174/api/aliceblue/auth/callback` if Alice Blue accepts local callbacks; in production it must be your deployed HTTPS callback | Alice Blue Developer Portal → registered redirect URL |
| `ALICEBLUE_CLIENT_ID` | Your Alice Blue **client/account ID** — **only** needed if your broker's redirect does not send a `state` value (see note below) | Your Alice Blue account |
| `ALICEBLUE_SESSION_ENCRYPTION_KEY` | Leave empty. A secret key is created automatically on first run and stored next to the session database | — |
| `ALICEBLUE_BASE_URL` | Keep as-is | — |
| `ALICEBLUE_DEFAULT_EXCHANGE` | Default exchange (`nse_fo`, `bse_fo`, or `mcx_fo`) | — |
| `ALICEBLUE_REFRESH_SECONDS` | How often the table auto-refreshes (minimum 5) | — |

**Important security note:** Keep this file **private**. Do not paste its content
into chat, email, or anywhere else. The file is automatically ignored by Git, so
it will not be uploaded to your repository.

---

## 4. Connect your Alice Blue account

1. Start the backend (Section 5).
2. Open your site in a browser:
   `http://127.0.0.1:4174/strategy-builder.html`
3. Open the **Simulator** tab. Inside it, under the replay tools, find the **"Live Option Chain · Alice Blue"** panel and click **Connect Alice Blue**.
4. You are taken to the Alice Blue login page. Sign in there.
5. Alice Blue redirects you back automatically. Your connection is now active.

When connected, the panel shows **Connected** and the dropdowns (Exchange,
Underlying, Expiry, Strike interval) unlock, and real rows appear.

> If you see "Authentication required · Connect Alice Blue", you are simply not
> connected yet — click Connect.

---

## 5. Start / restart the Python backend

Open **PowerShell** in the project folder `D:\IWSM WEBSITE` and run:

```powershell
python backend\aliceblue\alice_service.py
```

The backend starts on `127.0.0.1:4180`. When you see it is running, open the site
(Section 4).

To **stop** the backend: press `Ctrl+C` in that PowerShell window.

To restart: run the same command again.

> The backend reads your credentials from the file in Section 3 at startup. If you
> edit that file, restart the backend.

---

## 6. Run the automatic tests

```powershell
python backend\aliceblue\run_tests.py
```

You should see `Ran 11 tests ... OK`. This checks login math, security, data
parsing, caching and rate limits without touching your real money.

---

## 7. How to check that data is live

- The table shows **Last updated** time. If it keeps changing, data is refreshing.
- **Auto refresh** (checkbox) updates the snapshot every `ALICEBLUE_REFRESH_SECONDS`
  seconds (5 by default). Use **Refresh** to update immediately.
- If data goes stale, the page shows a clear stale/warning message — it never
  pretends old numbers are current.
- Open Alice Blue in another tab to compare a price: they should match.

---

## 8. Troubleshooting

| Problem | What to do |
|---|---|
| "Broker application is not configured" | Fill `ALICEBLUE_APP_CODE` and `ALICEBLUE_API_SECRET` in the env file (Section 3), then restart the backend. |
| "Alice Blue Python service is unavailable" | The backend is not running. Start it (Section 5), then refresh the site. |
| "Origin not allowed" | The website is being opened from a different address than the registered redirect origin. Use `http://127.0.0.1:4174`. |
| Login starts but won't finish | Make sure `ALICEBLUE_REDIRECT_URL` matches the registered redirect **exactly** (including `http`/`https` and any port). |
| "Broker omitted state; configure your expected ALICEBLUE_CLIENT_ID" | Alice Blue's redirect did not include a security `state`, so set `ALICEBLUE_CLIENT_ID` to your client ID so the backend can verify the login belongs to you. |
| "Market-data request limit reached" | You refreshed too quickly. Wait a minute before continuing. |
| Live prices look unchanged on a holiday/closed market | The broker returns the last available snapshot; the data is still correct. |

---

## 9. Important reminders

- This is **read-only**. Nothing you do here trades or orders.
- The broker session token never leaves the backend, never reaches the browser, and
  is stored encrypted.
- If your Alice Blue API application is not yet **activated/approved by the broker**,
  the login will fail. Activate it in the Alice Blue Developer Portal first — do not
  bypass any broker permission.
- Deployment instructions are in `DEPLOYMENT.md`.
