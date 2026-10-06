# Scripts

## Independence

This repo is standalone. The old AdsPower `reddit-accounts` tree lives outside
this project and is **not required**.

---

## Windows PowerShell (copy-paste)

Open PowerShell in the project folder (or `cd` there).

### First time / after git pull

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd $HOME\Downloads\local-reddit-accounts-creation
git pull
npm install
npx playwright install firefox
.\scripts\windows\fix-env.ps1
notepad .\.env
```

`.env` must include `USE_SYSTEM_FIREFOX=true` and `PROXY_ENABLED=true`.  
`fix-env.ps1` renames `.env.txt` → `.env` and `proxy details.txt` → `proxy details`.

Put `email data.txt` and `proxy details` in the project root.

### Daily run

```powershell
cd $HOME\Downloads\local-reddit-accounts-creation

.\scripts\windows\create-accounts.ps1   # list emails (no browser)
.\scripts\windows\create-one.ps1        # smoke test first email (Mozilla)
.\scripts\windows\create-all.ps1        # full queue
```

Expect: `Using Mozilla Firefox: C:\Program Files\Mozilla Firefox\firefox.exe`

Or plain npm (same thing):

```powershell
npm run create:accounts
npm run create:one
npm run create
```

### Inspect / open profile

```powershell
.\scripts\windows\inspect.ps1 -Email someone@outlook.com
.\scripts\windows\inspect.ps1 -Email someone@outlook.com -Safe
.\scripts\windows\open-profile.ps1 -Email someone@outlook.com
```

npm equivalent (extra `--` required in PowerShell):

```powershell
npm run create:inspect -- --email=someone@outlook.com
```

Full Windows guide: [WINDOWS.md](WINDOWS.md) · Profiles/proxy: [PROFILES.md](PROFILES.md)

---

## Run (Linux / macOS / any shell)

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

---

## Email file formats (`email data.txt`)

```text
uuid	'CarsenLatva53139@outlook.com		xqngo39438
email,,password
uuid,''Email@outlook.com,,password,,,,,,,,,,,,
```

Leading `'` on the email is stripped.

---

## Firefox profiles

```text
email data.txt
    └─ CarsenLatva53139@outlook.com
           └─ profileId: ff-carsenlatva53139_outlook.com
                  └─ .firefox-profiles/ff-carsenlatva53139_outlook.com/
                         ├─ creation-flow.profile
                         ├─ user.js          (proxy prefs)
                         └─ cookies / storage…
```

| Step | What happens |
|------|----------------|
| First `create` for an email | Create folder, launch Firefox + proxy |
| Outlook / Reddit | Same browser; Reddit in a **new tab** |
| Later re-run same email | Reuses folder → often still logged into Outlook |
| Success | Row in `data/reddit-accounts.csv` |

Default browser = Playwright Firefox. Set `USE_SYSTEM_FIREFOX=true` for Mozilla.

Reset one profile (PowerShell):

```powershell
Remove-Item -Recurse -Force .\.firefox-profiles\ff-carsenlatva53139_outlook.com
```

---

## Staging workflow (old test site — not Reddit)

| Script | What it does |
|--------|--------------|
| `npm run test:server` | Fake register site `:3456` |
| `npm run workflow:test` | One staging registration |

## Config

- `config/creation-app.cjs` — batch size, proxy, profiles dir  
- `.env` — `HEADLESS`, `PROXY_ENABLED`, `USE_SYSTEM_FIREFOX`, `TEST_USERS_FILE`
