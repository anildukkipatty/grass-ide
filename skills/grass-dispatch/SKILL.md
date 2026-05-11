---
name: grass-dispatch
description: Dispatch tasks to a Grass VM via Claude on the user's behalf. Handles OTP login (email + 6-digit code), stores the resulting JWT locally, and calls POST /api/dispatch with the task.
metadata:
  author: grass-ai
  version: 0.1.0
---

# Grass Dispatch — Skill

Use this skill when the user wants to **dispatch a task to their Grass VM** from inside the agent. The skill walks them through one-time email/OTP login (storing a JWT for future runs), then submits the task to the Grass API. The actual work runs on the user's Grass VM; the user receives a push notification on their phone when it finishes.

> **Never** print, log, or echo the JWT, the OTP, or the contents of `<CONFIG>` to the user. Treat them as secrets.

---

## Constants

- **API base URL**: `https://api.codeongrass.com/v1` (override via `GRASS_API_URL` env var if set)
- **Config file**: see Step 0 below for cross-platform resolution

---

## Step 0 — Resolve `<CONFIG>` (run this first, every invocation)

1. If the env var `GRASS_CONFIG` is set, use its value verbatim as `<CONFIG>`. Done.
2. Otherwise resolve the user's home directory based on OS:
   - **macOS / Linux** (`uname` is `Darwin` or `Linux`): `<CONFIG>` = `$HOME/.grass/config`
   - **Windows** (`$env:OS` is `Windows_NT` or `ver` contains "Windows"): `<CONFIG>` = `%USERPROFILE%\.grass\config`
3. **Preferred resolution method**: run a Node one-liner so home expansion is correct regardless of shell:
   ```bash
   node -e "console.log(require('path').join(process.env.GRASS_CONFIG ? '' : require('os').homedir(), process.env.GRASS_CONFIG ? '' : '.grass', process.env.GRASS_CONFIG ? '' : 'config') || process.env.GRASS_CONFIG)"
   ```
   Or equivalently in Python: `python -c "import os; print(os.environ.get('GRASS_CONFIG') or os.path.expanduser('~/.grass/config'))"`
4. Carry `<CONFIG>` for the rest of the invocation.

---

## Step 1 — Detect auth state

Read `<CONFIG>` as JSON.

- **File exists and parses as `{ token: string, email: string, userId: string }` with non-empty `token`** → skip to **Step 3 (Dispatch)**.
- **File missing, empty, malformed, or `token` empty** → go to **Step 2 (Onboarding)**.

If the file exists but is malformed, do not crash — treat it as missing and proceed to onboarding (this auto-recovers from corrupt state).

---

## Step 2 — Onboarding (OTP login)

### 2a. Suggest an email

Try to auto-detect the user's email:
1. `git config user.email` if inside a git repo.
2. Falls back to `$GIT_AUTHOR_EMAIL` / `$EMAIL` env vars.
3. Falls back to asking the user directly.

Show the suggestion: "Use **`<email>`** for Grass account? (yes / edit)". If the user picks edit, prompt for a fresh email and validate basic format (`a@b.c`).

### 2b. Request the OTP

`POST <API>/auth/request-otp` with JSON body `{ "email": "<email>" }`.

- **200**: tell the user "Code sent to <email>. Check your inbox."
- **429**: cooldown active. Tell the user "Wait 60 seconds before requesting another code" and stop. Do not retry automatically.
- **4xx (other)**: show the response `message` to the user verbatim and stop.

### 2c. Collect the OTP from the user

Prompt: "Enter the 6-digit code from your email". Accept only digits, exactly 6 characters. If the user mistypes, re-prompt — do not re-request OTP.

### 2d. Verify

`POST <API>/auth/agent-token` with `{ "email": "<email>", "otp": "<otp>" }`.

- **200**: response is `{ "token": "<jwt>", "user": { "id": "<userId>", "email": "<email>", "userType": "new" | "old" } }`. Continue.
- **4xx**: tell the user "Invalid or expired code" and offer to retry from step 2b. Do not store anything.

### 2e. Persist the config

1. Compute `<DIR>` = parent directory of `<CONFIG>`.
2. Create `<DIR>` if missing.
3. Write `<CONFIG>` as JSON `{ "token": "<jwt>", "email": "<email>", "userId": "<userId>" }`.
4. **Restrict permissions**:
   - **macOS / Linux**: `chmod 700 <DIR>` then `chmod 600 <CONFIG>`.
   - **Windows**: NTFS uses ACLs, not POSIX modes. The file is already in the user profile (`%USERPROFILE%`), which restricts access to the current user by default — skip `chmod`. If `icacls` is available, optionally harden with:
     ```
     icacls "<CONFIG>" /inheritance:r /grant:r "%USERNAME%:F"
     ```
     If that command fails, log a notice but do not block.
5. Tell the user "Logged in as `<email>`. You're set up." Continue to **Step 3**.

---

## Step 3 — Dispatch a task

### 3a. Gather inputs

Ask the user for (or infer from context):

- **repo** — GitHub repository in `owner/name` format. If running inside a git repo, derive from `git remote get-url origin` and offer it as the default.
- **branch** — default to the current branch (`git rev-parse --abbrev-ref HEAD`) if available; otherwise ask.
- **task** — required, free-form text describing what Claude should do on the VM.
- **context** (optional, see below).

### 3b. Build optional `context`

If the current conversation contains relevant prior turns (e.g. the user has been discussing the bug or feature you're about to dispatch), summarise the **last ~10 user/assistant turns** into a concise paragraph (~1500 characters max). Strip any secrets, file paths the user did not share themselves, or unrelated tangents. Skip this section entirely if the conversation has no relevant context.

### 3c. Send the request

Read the JWT from `<CONFIG>` (just the `token` field — keep it in-memory only).

`POST <API>/api/dispatch` with:
- Header: `Authorization: Bearer <token>`
- Header: `Content-Type: application/json`
- Body: `{ "repo": "...", "branch": "...", "task": "...", "context": "..." }` (omit `context` if empty)

### 3d. Handle the response

- **200**: tell the user "Task dispatched. You'll receive a push notification on your phone when it completes."
- **401**: token is expired or invalid. Delete `<CONFIG>` and restart the entire skill from Step 1 (so the user is onboarded again). After they re-auth, retry the dispatch automatically.
- **400**: a validation error. Show `message` from the response to the user and let them correct their inputs.
- **429** / **5xx** / network errors: tell the user the API is unreachable / overloaded and to try again later. Do not retry automatically more than once.

---

## Failure modes — quick reference

| Symptom | What to do |
|---|---|
| `<CONFIG>` missing | Run onboarding (Step 2). |
| `<CONFIG>` malformed JSON | Run onboarding (Step 2). Don't crash. |
| `request-otp` returns 429 | Tell user to wait, stop. |
| `verify-otp` returns 4xx | "Invalid or expired code." Offer to retry from 2b. |
| `dispatch` returns 401 | Delete `<CONFIG>`, restart from Step 1, then retry dispatch once after re-auth. |
| `dispatch` returns 400 | Show server `message`, let user fix inputs. |
| Network error anywhere | Tell user, do not retry more than once. |

---

## Things this skill must NOT do

- Print, echo, or log the JWT, the OTP, or the full contents of `<CONFIG>`.
- Send the JWT anywhere other than `Authorization: Bearer …` on `<API>/api/dispatch`.
- Modify or delete files outside `<DIR>` (the `.grass` directory).
- Run any command that requires `sudo` / admin elevation.
- Make HTTP requests to any host other than the configured `<API>` base URL.
