# Windows install — local Firefox Reddit creation

This is the same pipeline that already runs on Linux and macOS:

Outlook login → Reddit register → OTP from Outlook inbox → `data/reddit-accounts.csv`

On Windows it still uses **Playwright’s Firefox**, not the Mozilla installer from firefox.com. Each Outlook email still gets one folder under `.firefox-profiles\`.

---

## 1. What you need

| Dependency | Version | Why |
|------------|---------|-----|
| Windows 10 or 11 | 64-bit | Persistent Firefox profiles + visible window |
| Node.js | **18.x or 20.x LTS** | Runs `npm run create*` |
| Git for Windows | latest | `git clone` |
| Playwright Firefox | installed via npm (step 4) | The browser the bot actually launches |
| Optional: Microsoft Visual C++ Redistributable | current x64 | Playwright binaries sometimes need it |

Do **not** point `FIREFOX_PATH` at a broken path. Prefer:

```env
USE_SYSTEM_FIREFOX=true
```

or a valid `FIREFOX_PATH` to `firefox.exe`. Leave both unset to use Playwright’s Firefox. Details: [PROFILES.md](PROFILES.md).

---

## 2. Install Node.js

1. Open [https://nodejs.org](https://nodejs.org) and download the **LTS** Windows x64 installer.
2. Run it. Leave **“Add to PATH”** checked.
3. Close any open terminals, then open **PowerShell** or **Windows Terminal**.

```powershell
node -v    # v18+ or v20+
npm -v
```

If `node` is not recognized, sign out/in or reboot so PATH updates.

---

## 3. Install Git and clone

1. Install [Git for Windows](https://git-scm.com/download/win).
2. Clone **your** repo (SSH if you already use a key; otherwise HTTPS):

```powershell
cd $HOME\Downloads
git clone git@github.com:saeedorakzai/local-reddit-accounts-creation.git
cd local-reddit-accounts-creation
```

HTTPS alternative:

```powershell
git clone https://github.com/saeedorakzai/local-reddit-accounts-creation.git
cd local-reddit-accounts-creation
```

---

## 4. Project dependencies + Playwright Firefox

From the project folder:

```powershell
npm install
npx playwright install firefox
```

`npx playwright install firefox` downloads Playwright’s Firefox into a cache under your user folder (not Program Files). First run can take a few minutes; Windows Defender may scan the files.

If install fails with a missing DLL, install [Visual C++ Redistributable x64](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) and retry.

---

## 5. Local files (never commit)

Copy the example env, then add credentials next to `package.json`.

```powershell
copy .env.example .env
```

### `.env` (typical Windows)

Keep these as-is unless you know you need otherwise:

```env
HEADLESS=false
SLOW_MO=0
PROXY_ENABLED=true
PROXY_FILE=proxy details
TEST_USERS_FILE=email data.txt
PROFILES_DIR=.firefox-profiles
```

Leave `FIREFOX_PATH` and `PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH` **empty**.

### `email data.txt`

Create this file in the **project root** (same folder as `package.json`). Notepad is fine; save as UTF-8.

Supported layouts (same as Linux/Mac):

```text
uuid	'Name@outlook.com		password
email,,password
uuid,''Email@outlook.com,,password,,,,,,,,,,,,
```

Windows Excel/Notepad UTF-16 and a leading BOM are accepted.

### `proxy details`

Same folder as `email data.txt`:

```text
http
host: 1.2.3.4
port: 8004
username: yourUser
password : yourPass
```

Spaces around `:` are fine. Extra spaces in the username are trimmed.

To run **without** a proxy, set `PROXY_ENABLED=false` in `.env`.

---

## 6. Windows Defender / firewall (first run)

On the first `npx playwright install firefox` or `npm run create:one`:

- Defender may delay launch while it scans Playwright Firefox.
- If Windows Firewall asks to allow Node or Firefox, allow it on **private** networks (or both, if you use a proxy).
- Antivirus exclusive-lock of `.firefox-profiles\` can make launch fail with “profile already in use”. Exclude the project folder **or** `%USERPROFILE%\AppData\Local\ms-playwright` if that happens often.

---

## 7. Run

Use **PowerShell** from the project folder. Scripts are identical to Linux/Mac (`npm run …`).

```powershell
npm run create:accounts
```

You should see profile names like `ff-name_outlook.com` and **Registry is clean**.

Smoke-test **one** account (opens a visible Firefox window):

```powershell
npm run create:one
```

Full queue:

```powershell
npm run create
```

Other commands: [SCRIPTS.md](SCRIPTS.md).

Optional inspect (PowerShell extra `--` is required so flags reach Node):

```powershell
npm run create:inspect -- --email=someone@outlook.com
```

---

## 8. How it behaves on Windows (vs Linux / Mac)

| Topic | Windows behavior |
|--------|------------------|
| Browser (default) | Playwright Firefox (Nightly). Not listed in system `about:profiles`. |
| Browser (Mozilla) | Set `USE_SYSTEM_FIREFOX=true` after installing Firefox from mozilla.org — see [PROFILES.md](PROFILES.md) |
| Profiles | `.\.firefox-profiles\ff-<email>\` — reopen with `firefox.exe -no-remote -profile "…"` |
| Proxy | HTTP or SOCKS5 via `proxy details` + prefs in profile `user.js` |
| Cookies | Stay in that folder; re-run often skips Outlook login |
| Outlook | Passkeys blocked in-page; password path preferred |
| Reddit | New tab; OTP from Outlook in same browser |
| Output | `data\reddit-accounts.csv` |

---

## 9. Reset one profile

If an account is stuck (lock, bad session, half-finished Reddit):

```powershell
# close any Firefox window from the bot first
Remove-Item -Recurse -Force .\.firefox-profiles\ff-example_outlook.com
```

Then run `npm run create:one` again (or `create` for the full file).

---

## 10. Common Windows failures

| Symptom | Fix |
|---------|-----|
| `'node' is not recognized` | Reinstall Node LTS with PATH; new terminal |
| `Playwright Firefox is not installed` | `npx playwright install firefox` |
| Launch points at `Mozilla Firefox\firefox.exe` | Unset `FIREFOX_PATH` in `.env` |
| Profile locked / already in use | Close leftover Firefox; delete that `.firefox-profiles\ff-…` folder |
| `create:accounts` finds 0 emails | Save `email data.txt` as UTF-8 in the project root; check tabs vs commas |
| Proxy timeout / Outlook never loads | Confirm `PROXY_ENABLED=true` and `proxy details`; test the proxy in a browser |
| Window never appears | `HEADLESS=false`; don’t run as a Windows service |
| Defender “threat” on Playwright Firefox | Allow the `ms-playwright` folder |
| `npm run create:inspect --email=…` ignores the email | In PowerShell use `npm run create:inspect -- --email=…` |

---

## 11. Checklist

- [ ] Node 18+ (`node -v`)
- [ ] `npm install`
- [ ] `npx playwright install firefox`
- [ ] `.env` copied from `.env.example`
- [ ] `email data.txt` in project root
- [ ] `proxy details` if proxy is enabled
- [ ] `npm run create:accounts` lists emails
- [ ] `npm run create:one` opens Firefox and runs Outlook → Reddit
