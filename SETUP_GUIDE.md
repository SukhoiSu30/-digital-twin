# Digital Twin — Credential Setup Guide

This guide walks you through setting up every external account and credential needed to run the Digital Twin. Steps are ordered so you can do the quick ones yourself first while your IT admin handles the Azure registration.

**Time estimate:** ~30 minutes for your part, Azure may take longer depending on IT response time.

---

## What's Needed (Summary)

| Service | Who Sets It Up | Time | Cost |
|---------|---------------|------|------|
| PostgreSQL + Redis (Docker) | You | 2 min | Free |
| Deepgram API Key | You | 3 min | Free ($200 credit) |
| Anthropic Claude API Key | You | 3 min | Pay-as-you-go |
| Zoom Developer Account | You | 10 min | Free |
| Azure App Registration | IT Admin | 10-15 min | Free |

---

## STEP 1: Start PostgreSQL + Redis (Do This First)

You already have Docker, so this is the fastest step.

**Open a terminal in the `digital-twin` folder and run:**

```bash
docker compose up -d
```

That's it. This starts:
- PostgreSQL 16 on port `5432` (username: `postgres`, password: `password`, database: `digital_twin`)
- Redis 7 on port `6379`

**Verify they're running:**

```bash
docker compose ps
```

You should see both containers with status "Up" or "running".

**If port 5432 or 6379 is already in use** (maybe you have PostgreSQL/Redis installed locally), either stop the local service or edit `docker-compose.yml` to change the port mapping (e.g., `"5433:5432"`).

---

## STEP 2: Get a Deepgram API Key (3 minutes)

Deepgram handles real-time speech-to-text transcription during meetings.

1. Go to **https://deepgram.com**
2. Click **"Get Started Free"** or **"Sign Up"**
3. Create an account (email + password, or sign in with Google/GitHub)
4. After signing in, you'll land on the Deepgram Console
5. In the left sidebar, click **"API Keys"**
6. Click **"Create a New API Key"**
7. Settings:
   - **Comment/Name:** `Digital Twin`
   - **Permissions:** Select **"Member"** (this gives transcription access)
   - **Expiration:** "Never" or set a date
8. Click **"Create Key"**
9. **COPY THE KEY IMMEDIATELY** — it's only shown once
10. Save it somewhere safe (you'll paste it into `.env` later)

**Free tier includes:** $200 in credits, which covers roughly 100+ hours of transcription. More than enough for development and testing.

---

## STEP 3: Get an Anthropic Claude API Key (3 minutes)

Claude handles meeting summarization and action item extraction.

1. Go to **https://console.anthropic.com**
2. Click **"Sign Up"** if you don't have an account, or **"Log In"**
3. Create an account with your email
4. After signing in, you'll see the Anthropic Console dashboard
5. In the left sidebar, click **"API Keys"**
6. Click **"Create Key"**
7. Give it a name: `Digital Twin`
8. **COPY THE KEY** — starts with `sk-ant-...`
9. Save it somewhere safe

**Billing:** You'll need to add a payment method under **"Plans & Billing"** in the sidebar. Claude API is pay-per-use:
- Claude Sonnet (what we use): ~$3 per million input tokens, ~$15 per million output tokens
- A typical meeting summary costs about $0.01–$0.05
- So 100 meetings ≈ $1–$5 total

---

## STEP 4: Set Up a Zoom Developer Account (10 minutes)

This lets the Digital Twin bot join Zoom meetings programmatically.

### 4a. Create the Account

1. Go to **https://marketplace.zoom.us**
2. Click **"Sign In"** (use your regular Zoom account credentials)
3. If you don't have a Zoom account, create one at zoom.us first, then come back

### 4b. Create an App

1. After signing in, click **"Develop"** in the top navigation → **"Build App"**
2. You'll see a list of app types. Choose **"General App"** and click **"Create"**
3. Fill in the basic info:
   - **App Name:** `Digital Twin Bot`
   - **App Type:** Select **"User-managed app"**
   - **Description:** `AI meeting bot that joins Zoom meetings for transcription and notes`
4. Click **"Create"**

### 4c. Configure the App

After creating, you'll be on the app configuration page with tabs.

**App Credentials tab:**
- You'll see **Client ID** and **Client Secret** — copy both and save them
- Under **OAuth Redirect URL**, add:
  ```
  http://localhost:3001/api/auth/zoom/callback
  ```
- Under **Add Allow List**, add:
  ```
  http://localhost:3001
  ```

**Scopes tab:**
- Click **"Add Scopes"**
- Search for and add these scopes:
  - `meeting:read` — Read meeting details
  - `meeting:write` — Join meetings
  - `user:read` — Read user info
- Click **"Done"**

**Surface tab (optional, skip for now):**
- No changes needed

### 4d. Get SDK Credentials (for Meeting SDK)

1. Go back to **https://marketplace.zoom.us** → **"Develop"** → **"Build App"**
2. This time, choose **"Meeting SDK"** and click **"Create"**
3. **App Name:** `Digital Twin Meeting SDK`
4. After creating, you'll see:
   - **SDK Key** (also called Client ID)
   - **SDK Secret** (also called Client Secret)
5. Copy both — these are different from the OAuth credentials above

**You should now have 4 Zoom values:**
- `ZOOM_CLIENT_ID` (from the General App)
- `ZOOM_CLIENT_SECRET` (from the General App)
- `ZOOM_SDK_KEY` (from the Meeting SDK app)
- `ZOOM_SDK_SECRET` (from the Meeting SDK app)

---

## STEP 5: Azure App Registration (Send to IT Admin)

Since you don't have Azure admin access, you'll need your IT admin to do this. Below is a **ready-to-forward email/message** you can send them, plus the technical details they'll need.

### Copy-Paste Message for Your IT Admin:

---

**Subject: Request — Azure App Registration for Internal Meeting Bot Tool**

Hi [IT Admin Name],

I'm building an internal tool that needs to read calendar events and send emails via Microsoft Graph API. Could you register an Azure AD app for me? Here's what's needed:

**App Registration:**
1. Go to portal.azure.com → Azure Active Directory → App Registrations → New Registration
2. Name: `Digital Twin Bot`
3. Supported account types: "Accounts in this organizational directory only" (single tenant)
4. Redirect URI: Web — `http://localhost:3001/api/auth/microsoft/callback`

**API Permissions (Delegated, NOT Application):**
- `Microsoft Graph` → `Calendars.Read`
- `Microsoft Graph` → `Mail.Read`
- `Microsoft Graph` → `Mail.Send`
- `Microsoft Graph` → `User.Read`
- Click "Grant admin consent" for all permissions

**Client Secret:**
- Go to "Certificates & Secrets" → New Client Secret
- Description: `Digital Twin Dev`
- Expiry: 12 months (or 24)

**What I need back (3 values):**
1. **Application (client) ID** — found on the app's Overview page
2. **Directory (tenant) ID** — found on the app's Overview page
3. **Client Secret Value** — shown once when you create it (NOT the Secret ID)

This is for local development only (localhost). No production deployment yet. The app only reads the user's own calendar and sends emails on their behalf — it requires user sign-in (delegated permissions, not daemon/background).

Thanks!

---

### What the IT Admin Will Give You Back:

Three values:
- `MICROSOFT_CLIENT_ID` — looks like: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- `MICROSOFT_TENANT_ID` — looks like: `f1e2d3c4-b5a6-7890-abcd-ef1234567890`
- `MICROSOFT_CLIENT_SECRET` — looks like: `abc~DEF123_xyz.456-789`

---

## STEP 6: Create Your .env File

Once you have all the credentials, create the `.env` file.

**In the `digital-twin` folder, copy the example:**

```bash
cp .env.example .env
```

**Then open `.env` in any text editor and fill in your values:**

```env
# ─── READY RIGHT AWAY ────────────────────────────────

# App (no changes needed)
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:5173

# Database (matches docker-compose.yml, no changes needed)
DATABASE_URL=postgresql://postgres:password@localhost:5432/digital_twin

# Redis (matches docker-compose.yml, no changes needed)
REDIS_URL=redis://localhost:6379

# ─── PASTE YOUR KEYS HERE ────────────────────────────

# Deepgram (from Step 2)
DEEPGRAM_API_KEY=paste_your_deepgram_key_here

# Claude API (from Step 3)
CLAUDE_API_KEY=sk-ant-paste_your_key_here

# ─── ZOOM (from Step 4) ──────────────────────────────

ZOOM_CLIENT_ID=paste_from_general_app
ZOOM_CLIENT_SECRET=paste_from_general_app
ZOOM_SDK_KEY=paste_from_meeting_sdk
ZOOM_SDK_SECRET=paste_from_meeting_sdk
ZOOM_REDIRECT_URI=http://localhost:3001/api/auth/zoom/callback

# ─── MICROSOFT (from Step 5 — when IT admin replies) ─

MICROSOFT_CLIENT_ID=paste_from_it_admin
MICROSOFT_CLIENT_SECRET=paste_from_it_admin
MICROSOFT_TENANT_ID=paste_from_it_admin
MICROSOFT_REDIRECT_URI=http://localhost:3001/api/auth/microsoft/callback

# ─── AUTH SECRETS (change these to random strings) ────

JWT_SECRET=change-this-to-a-random-string-abc123
SESSION_SECRET=change-this-to-another-random-string-xyz789
```

---

## STEP 7: First Run

Once your `.env` file has at least the database, Redis, Deepgram, and Claude keys filled in, you can start the project:

**Terminal 1 — Make sure Docker services are running:**
```bash
cd digital-twin
docker compose up -d
```

**Terminal 2 — Install dependencies and set up database:**
```bash
cd digital-twin
npm install
npm run db:generate
npm run db:migrate
```

When prompted for a migration name, type: `init`

**Terminal 3 — Start the backend:**
```bash
cd digital-twin
npm run dev:server
```

You should see:
```
╔══════════════════════════════════════════╗
║       Digital Twin — API Server          ║
║                                          ║
║  HTTP:      http://localhost:3001        ║
║  WebSocket: ws://localhost:3001          ║
║  Environment: development               ║
╚══════════════════════════════════════════╝
```

**Terminal 4 — Start the frontend:**
```bash
cd digital-twin
npm run dev:web
```

**Open your browser to: http://localhost:5173**

You should see the Digital Twin dashboard with sample meeting cards.

---

## What Works Without Microsoft Credentials?

While waiting for your IT admin, you can still:

- **See the dashboard UI** — runs fully with placeholder data
- **Test the backend API** — health check at http://localhost:3001/api/health
- **Set up and test Zoom OAuth** — connect your Zoom account
- **Verify database** — run `npm run db:studio` to open Prisma Studio (database viewer) at http://localhost:5555

**What you CAN'T do until Microsoft credentials arrive:**
- Sync your calendar (calendar sync will error)
- Sign in with Microsoft (OAuth redirect will fail)
- Send summary emails

---

## Troubleshooting

### "Cannot connect to PostgreSQL"
```bash
docker compose ps   # Check if postgres container is running
docker compose logs postgres   # Check for errors
```

### "npm install fails"
Make sure you have Node.js 18+ installed:
```bash
node --version   # Should be 18.x or higher
```

### "Prisma generate fails"
```bash
cd packages/database
npx prisma generate
```

### "Port 3001 already in use"
Change `PORT` in `.env` to another port (e.g., 3002) and update `ZOOM_REDIRECT_URI` and `MICROSOFT_REDIRECT_URI` accordingly.

### "Redis connection error" on server start
This is a warning, not a blocker. The server runs fine without Redis — you just won't have automatic job scheduling. Start Redis via Docker to fix it.

---

## Credential Checklist

Use this to track your progress:

- [ ] Docker: PostgreSQL + Redis running (`docker compose up -d`)
- [ ] Deepgram: API key obtained and added to .env
- [ ] Anthropic: Claude API key obtained and added to .env
- [ ] Zoom: Developer account created, General App + Meeting SDK set up, 4 values added to .env
- [ ] Microsoft: IT admin request sent
- [ ] Microsoft: Credentials received and added to .env
- [ ] .env: JWT_SECRET and SESSION_SECRET set to random strings
- [ ] First run: `npm install` → `db:generate` → `db:migrate` → `dev:server` → `dev:web`
- [ ] Dashboard loads at http://localhost:5173

---

*Guide created: May 9, 2026*
*Project: Digital Twin — AI Meeting Agent*
