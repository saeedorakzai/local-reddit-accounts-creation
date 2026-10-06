# creation-flow

Standalone local **Firefox** automation to create Reddit accounts:

1. Log into Outlook (from `email data.txt`)
2. Open Reddit register in the same browser
3. Read the Reddit OTP from the Outlook inbox
4. Finish username / password / onboarding
5. Append credentials to `data/reddit-accounts.csv`

No AdsPower. Runtime code lives under `src/creation/`.

## Quick start

Linux / macOS:

```bash
npm install
npx playwright install firefox
npm run create:accounts
npm run create:one
```

**Windows (PowerShell):** full install from Node.js through first run is in **[WINDOWS.md](WINDOWS.md)**.

```powershell
npm install
npx playwright install firefox
npm run create:accounts
npm run create:one
```


## Scripts

| Script | What it does |
|--------|--------------|
| `npm run create:accounts` | Parse emails → local Firefox profile names (**no browser**) |
| `npm run create:one` | Full create for the **first** email |
| `npm run create` | Full create for **all** emails |
| `npm run create:inspect` | Outlook login diagnostics |
| `npm run create:inspect:safe` | Inspect, stop before password |
| `npm run create:inspect:reddit` | Reddit only (Outlook already logged in) |
| `npm run create:help` | CLI help |

More detail: [SCRIPTS.md](SCRIPTS.md)

## Inputs (gitignored — do not commit)

| Path | Role |
|------|------|
| `email data.txt` | Outlook queue |
| `proxy details` | HTTP proxy for Firefox |
| `.env` | `HEADLESS`, `PROXY_*`, `SLOW_MO`, … |

Copy [`.env.example`](.env.example) to `.env`.

### `email data.txt` formats

```text
# tab-separated
uuid	'Name@outlook.com		password

# comma-separated
email,,password
uuid,''Email@outlook.com,,password,,,,,,,,,,,,
```

## Outputs (gitignored)

| Path | Role |
|------|------|
| `data/reddit-accounts.csv` | Created Reddit usernames / passwords |
| `.firefox-profiles/ff-<email>/` | One persistent Firefox profile per account |
| `reports/`, `diagnostics/`, `screenshots/`, `logs/` | Run artifacts |

## Firefox profiles

Each Outlook email maps to one profile directory:

```text
CarsenLatva53139@outlook.com
  → ff-carsenlatva53139_outlook.com
  → .firefox-profiles/ff-carsenlatva53139_outlook.com/
```

Playwright launches Firefox with `launchPersistentContext` + optional proxy. Cookies stay in that folder so re-runs can reuse Outlook sessions.

On Windows the folder is `.firefox-profiles\ff-<email>\`. Default browser is Playwright Firefox; set `USE_SYSTEM_FIREFOX=true` for installed Mozilla Firefox. Proxy (HTTP/SOCKS5) is documented in [PROFILES.md](PROFILES.md). Full Windows install: [WINDOWS.md](WINDOWS.md).

## Config

- [`config/creation-app.cjs`](config/creation-app.cjs) — batch size, register-after-login, proxy, profiles dir
- Platform selectors / timings under `src/creation/config/platforms/`

## License

MIT
