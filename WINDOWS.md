# Windows install — local Firefox Reddit creation

This is the same pipeline that already runs on Linux and macOS:

Outlook login → Reddit register → OTP from Outlook inbox → `data/reddit-accounts.csv`

Default browser is **Playwright Firefox**. For installed **Mozilla Firefox**, set `USE_SYSTEM_FIREFOX=true` (see [PROFILES.md](PROFILES.md)). Each Outlook email gets one folder under `.firefox-profiles\`.

**Ready-made PowerShell scripts:** `scripts\windows\` — also listed in [SCRIPTS.md](SCRIPTS.md).

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

```env
HEADLESS=false
SLOW_MO=0
PROXY_ENABLED=true
PROXY_FILE=proxy details
TEST_USERS_FILE=email data.txt
PROFILES_DIR=.firefox-profiles
USE_SYSTEM_FIREFOX=false
```

Set `USE_SYSTEM_FIREFOX=true` to use installed Mozilla Firefox. Or set `FIREFOX_PATH` to `firefox.exe`. Leave both off to use Playwright Firefox.

### `proxy details` (HTTP or SOCKS5)

```text
http
host: 1.2.3.4
port: 8004
username: yourUser
password : yourPass
```

SOCKS5: change the first line to `socks5` (and usually port `1080`). Spaces around `:` are fine. Without a proxy: `PROXY_ENABLED=false` in `.env`.

### `email data.txt`

Create this file in the **project root** (same folder as `package.json`). Notepad is fine; save as UTF-8.

Supported layouts (same as Linux/Mac):

```text
uuid	'Name@outlook.com		password
email,,password
uuid,''Email@outlook.com,,password,,,,,,,,,,,,
```

Windows Excel/Notepad UTF-16 and a leading BOM are accepted.

---

## 6. Windows Defender / firewall (first run)

On the first `npx playwright install firefox` or `npm run create:one`:

- Defender may delay launch while it scans Playwright Firefox.
- If Windows Firewall asks to allow Node or Firefox, allow it on **private** networks (or both, if you use a proxy).
- Antivirus exclusive-lock of `.firefox-profiles\` can make launch fail with “profile already in use”. Exclude the project folder **or** `%USERPROFILE%\AppData\Local\ms-playwright` if that happens often.

---

## 7. Run (PowerShell)

From the project folder:

```powershell
# allow .ps1 for this window only
Set-ExecutionPolicy -Scope Process Bypass

# first time / after pull
.\scripts\windows\setup.ps1

# list emails (no browser)
.\scripts\windows\create-accounts.ps1

# smoke test — first email (opens Firefox)
.\scripts\windows\create-one.ps1

# full queue
.\scripts\windows\create-all.ps1
```

Same via npm:

```powershell
npm run create:accounts
npm run create:one
npm run create
```

Inspect / reopen a profile folder:

```powershell
.\scripts\windows\inspect.ps1 -Email someone@outlook.com
.\scripts\windows\open-profile.ps1 -Email someone@outlook.com

# npm form (extra -- required in PowerShell):
npm run create:inspect -- --email=someone@outlook.com
```

More: [SCRIPTS.md](SCRIPTS.md).

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
| Mozilla Firefox launch fails | Install Firefox, or unset `USE_SYSTEM_FIREFOX` / `FIREFOX_PATH` to use Playwright |
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
