# Firefox profiles & proxy

How this project stores browsers (vs AdsPower / `about:profiles`), and how to use **Mozilla Firefox** + **HTTP/SOCKS5** proxy.

## Two browser modes

| Mode | When | Binary |
|------|------|--------|
| **Playwright Firefox** (default) | `USE_SYSTEM_FIREFOX` unset/false | Nightly from `npx playwright install firefox` |
| **Mozilla Firefox** | `USE_SYSTEM_FIREFOX=true` or `FIREFOX_PATH=...` | System install (`firefox.exe` / `/usr/bin/firefox`) |

Both modes use the **same** profile folders under `.firefox-profiles/ff-<email>/`.

### Enable Mozilla Firefox

In `.env`:

```env
USE_SYSTEM_FIREFOX=true
```

Or pin the path:

```env
# Windows
FIREFOX_PATH=C:\Program Files\Mozilla Firefox\firefox.exe

# macOS
FIREFOX_PATH=/Applications/Firefox.app/Contents/MacOS/firefox
```

Install Firefox from [mozilla.org](https://www.mozilla.org/firefox/) first.

---

## Where profiles live

```text
.firefox-profiles/
  ff-zaniyahclifton28176_outlook.com/
    creation-flow.profile
    user.js                 ← proxy prefs written here
    cookies, storage, …
```

This is **not** AdsPower. It is also **not** always listed in Firefox’s `about:profiles` UI (that list only shows entries registered in Firefox’s own `profiles.ini`).

These folders **are** real Mozilla profile directories. You open them with `-profile`:

### Windows (PowerShell)

```powershell
& "C:\Program Files\Mozilla Firefox\firefox.exe" -no-remote -profile "$PWD\.firefox-profiles\ff-zaniyahclifton28176_outlook.com"
```

### macOS / Linux

```bash
/Applications/Firefox.app/Contents/MacOS/firefox -no-remote -profile "$(pwd)/.firefox-profiles/ff-zaniyahclifton28176_outlook.com"
# or: firefox -no-remote -profile "..."
```

Close the bot’s browser before opening the same folder manually (profile lock).

---

## Proxy (HTTP and SOCKS5)

File: **`proxy details`** in the project root (gitignored).

### HTTP

```text
http
host: 1.2.3.4
port: 8004
username: myuser
password : mypass
```

### SOCKS5

```text
socks5
host: 1.2.3.4
port: 1080
username: myuser
password : mypass
```

Also supported: `socks5h` (DNS through proxy), or a one-line URL:

```text
socks5://user:pass@1.2.3.4:1080
```

`.env`:

```env
PROXY_ENABLED=true
PROXY_FILE=proxy details
```

### How proxy is applied

1. **Playwright launch** — `proxy.server` = `http://…` or `socks5://…` while the bot runs.
2. **`user.js` inside the profile** — Mozilla prefs (`network.proxy.*`) so the **same folder** still uses that host/port when you reopen with `firefox -profile …`.

Note: SOCKS username/password support varies by Firefox build; the bot always passes auth to Playwright. For manual reopen, HTTP auth may need Firefox’s stored proxy credentials.

---

## Vs AdsPower

| | AdsPower | This project |
|--|----------|--------------|
| Open profile | AdsPower UI / API | Bot, or `firefox -profile <dir>` |
| Fingerprint panel | Yes | No (plain Mozilla / Playwright Firefox) |
| Proxy | Per AdsPower profile | `proxy details` + `user.js` + Playwright |
| Profile ID | AdsPower `k1…` | Folder `ff-<email>` |

---

## Reset / clean

```powershell
# Windows — delete one account’s profile
Remove-Item -Recurse -Force .\.firefox-profiles\ff-example_outlook.com
```

Then `npm run create:one` (or `create`) recreates it with fresh proxy prefs.
