# Data directory (creation-flow)

This folder belongs to **this** project only.

- **Do not copy** real credentials or CSVs from `reddit-accounts/` here.
- Runtime files (`logins.csv`, `reddit-accounts.csv`, `processed.csv`, `adspower.json`) start **empty** (header / `[]` only) and are gitignored.
- Safe templates to commit: `*.example.csv`, `adspower.example.json`, `proxy.example.txt`, `test-users.txt`.

### Inputs for local Firefox creation

| File | Role |
|------|------|
| `../email data.txt` (project root) | Outlook queue — tabs or commas (see [SCRIPTS.md](../SCRIPTS.md)) |
| `../proxy details` (project root) | Proxy for Firefox launches |
| `reddit-accounts.csv` | **Output** of successful Reddit creates (starts empty) |
| `../.firefox-profiles/ff-<email>/` | One persistent Firefox profile per email |

The old AdsPower `reddit-accounts` tree is **not part of this repo**.
All runtime code is under `src/creation/`. This `data/` folder must never hold real secrets in git.
