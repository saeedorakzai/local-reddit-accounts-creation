# Scripts

## Independence

This repo is standalone. The old AdsPower `reddit-accounts` tree lives outside
this project (e.g. `~/Downloads/reddit-accounts`) and is **not required**.


## Run (local Firefox Reddit creation)

```bash
npm run create:accounts   # parse email data.txt — no browser
npm run create:one        # first email only (smoke test)
npm run create            # full queue
```

| Script | What it does |
|--------|--------------|
| `npm run create:accounts` | List emails → `ff-…` profile names |
| `npm run create:one` | Outlook → Reddit → OTP → onboarding → CSV (first row) |
| `npm run create` | Same for every row in `email data.txt` |
| `npm run create:inspect` | Outlook diagnostics only |
| `npm run create:inspect:safe` | Stop before typing password |
| `npm run create:inspect:reddit` | Reddit register only |
| `npm run create:help` | Help |

```bash
npm run create:inspect -- --email=someone@outlook.com
```

On Windows PowerShell the extra `--` is required so `--email` reaches Node.

## Email file formats (`email data.txt`)

```text
uuid	'CarsenLatva53139@outlook.com		xqngo39438
email,,password
uuid,''Email@outlook.com,,password,,,,,,,,,,,,
```

Leading `'` on the email is stripped.

## Firefox profiles — how they work

```text
email data.txt
    └─ CarsenLatva53139@outlook.com
           └─ profileId: ff-carsenlatva53139_outlook.com
                  └─ .firefox-profiles/ff-carsenlatva53139_outlook.com/
                         ├─ creation-flow.profile   (marker)
                         └─ (Firefox cookies, storage, cache…)
```

| Step | What happens |
|------|----------------|
| First `create` for an email | Create folder under `.firefox-profiles/`, launch Playwright Firefox with that dir + proxy |
| Outlook / Reddit | Same browser context; Reddit opens in a **new tab** |
| Later re-run same email | Reuses the same folder → often still logged into Outlook |
| Success output | Row appended to `data/reddit-accounts.csv` |

Profiles are **not** AdsPower instances. They are local Playwright persistent contexts. Isolation = one directory per email (cookies don’t mix).

To force a clean browser for one account, delete its folder:

Linux / macOS:

```bash
rm -rf .firefox-profiles/ff-carsenlatva53139_outlook.com
```

Windows PowerShell:

```powershell
Remove-Item -Recurse -Force .\.firefox-profiles\ff-carsenlatva53139_outlook.com
```

## Staging workflow (old test site — not Reddit)

| Script | What it does |
|--------|--------------|
| `npm run test:server` | Fake register site `:3456` |
| `npm run workflow:test` | One staging registration |

## Config knobs

- `config/creation-app.cjs` — `batchSize`, `registerAfterLogin`, proxy, profiles dir  
- `.env` — `HEADLESS`, `SLOW_MO`, `PROXY_ENABLED`, `TEST_USERS_FILE`
- Windows install: [WINDOWS.md](WINDOWS.md)  
