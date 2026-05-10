# Digital Twin — Project Status

## 61 Files Built | Full-Stack Meeting AI Agent

---

## Complete File Inventory

### Backend — `apps/server/src/` (20 files)

| File | Purpose |
|------|---------|
| `index.ts` | Express + Socket.io server entry, initializes workers + queues |
| `config/env.ts` | Zod-validated environment variables |
| `middleware/auth.ts` | JWT authentication + token generation |
| `middleware/errorHandler.ts` | Global error handling middleware |
| `routes/auth.ts` | Microsoft + Zoom OAuth flows |
| `routes/calendar.ts` | Calendar sync via Microsoft Graph API |
| `routes/meetings.ts` | CRUD for meetings (list, detail, update, delete) |
| `routes/bot.ts` | Bot control (join, leave, status) |
| `routes/actions.ts` | Action items (list, update) |
| `routes/summaries.ts` | Summary read, regenerate, email send |
| `routes/webhooks.ts` | Zoom + Recall.ai webhook receivers |
| `services/zoom-bot.ts` | Zoom meeting join (SDK + Recall.ai dual path) |
| `services/transcription.ts` | Deepgram real-time streaming + persistence |
| `services/summarizer.ts` | Claude API meeting summarization |
| `services/email.ts` | HTML email via Microsoft Graph API |
| `services/calendar-sync.ts` | Calendar polling + Zoom link extraction |
| `jobs/queues.ts` | 4 BullMQ queues + scheduled jobs |
| `jobs/workers.ts` | Pipeline workers (calendar → bot → summary → email) |
| `utils/zoom-url-parser.ts` | Zoom URL extraction, parsing, validation |
| `utils/token-refresh.ts` | OAuth token auto-refresh for Microsoft + Zoom |

### Frontend — `apps/web/src/` (22 files)

| File | Purpose |
|------|---------|
| `main.tsx` | React entry point |
| `App.tsx` | Router + dark mode + layout shell |
| `index.css` | TailwindCSS + ShadCN CSS variables (light + dark) |
| `vite-env.d.ts` | Vite type declarations |
| `lib/utils.ts` | cn() utility (clsx + tailwind-merge) |
| `lib/api.ts` | Full API client for all backend endpoints |
| `hooks/useAuth.ts` | Auth state, token persistence, user profile |
| `hooks/useWebSocket.ts` | Socket.io connection + meeting room events |
| `components/ui/button.tsx` | ShadCN Button component |
| `components/ui/card.tsx` | ShadCN Card component |
| `components/ui/badge.tsx` | ShadCN Badge component |
| `components/layout/Sidebar.tsx` | App sidebar navigation + dark mode toggle |
| `components/layout/AppLayout.tsx` | Layout wrapper with sidebar |
| `components/dashboard/StatsBar.tsx` | 4-stat overview cards |
| `components/dashboard/MeetingCard.tsx` | Meeting card with status + actions |
| `components/meetings/LiveTranscript.tsx` | Real-time WebSocket transcript viewer |
| `components/meetings/SummaryPanel.tsx` | Summary + key points + action items display |
| `pages/Dashboard.tsx` | Main dashboard with stats + today's meetings |
| `pages/MeetingsList.tsx` | Filterable meetings list |
| `pages/MeetingDetail.tsx` | Meeting page: transcript + summary side by side |
| `pages/ActionItems.tsx` | Action items board with filter + toggle |
| `pages/Settings.tsx` | Connected services management |
| `pages/AuthCallback.tsx` | OAuth redirect handler |

### Database — `packages/database/` (3 files)

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | 8 models, 2 enums, full relations + indexes |
| `src/index.ts` | Prisma client singleton + type re-exports |
| `tsconfig.json` | TypeScript config |

### Config + Infrastructure (8 files)

| File | Purpose |
|------|---------|
| `package.json` | Monorepo root with npm workspaces |
| `apps/server/package.json` | Backend dependencies |
| `apps/web/package.json` | Frontend dependencies |
| `packages/database/package.json` | Prisma dependencies |
| `docker-compose.yml` | PostgreSQL 16 + Redis 7 |
| `.env.example` | Documented environment template |
| `.gitignore` | Standard Node + Prisma ignores |
| `apps/web/vite.config.ts` | Vite + API proxy config |
| `apps/web/tailwind.config.ts` | TailwindCSS + ShadCN theme |
| `apps/web/postcss.config.js` | PostCSS pipeline |

### Docs + Tests (3 files)

| File | Purpose |
|------|---------|
| `Digital_Twin_Project_Plan.md` | Full architecture + API + schema + phases |
| `SETUP_GUIDE.md` | Credential setup walkthrough + IT admin email |
| `tests/unit/zoom-url-parser.test.ts` | URL parser unit tests (all passing) |

---

## Architecture Pipeline

```
Microsoft Calendar → Calendar Sync (every 5 min)
        ↓
  Discover Zoom meetings → Store in PostgreSQL
        ↓
  BullMQ schedules bot join (30s before start)
        ↓
  Zoom Bot joins meeting (SDK or Recall.ai)
        ↓
  Audio → Deepgram (real-time) → Transcript segments
        ↓                              ↓
  Socket.io → Dashboard         Save to PostgreSQL
        ↓
  Meeting ends → Claude API summarization
        ↓
  Summary + Action Items → PostgreSQL → Dashboard
        ↓
  Email via Microsoft Graph API → User's inbox
```

## Tech Stack (100% standardized)

- **Frontend:** React 18 + TypeScript + Vite + TailwindCSS + ShadCN/UI
- **Backend:** Node.js + Express + TypeScript (single runtime, zero Python)
- **Database:** PostgreSQL 16 + Prisma ORM
- **Queue:** BullMQ + Redis 7
- **Real-time:** Socket.io
- **External:** Microsoft Graph API, Zoom SDK, Deepgram Nova-2, Claude API

---

*Last updated: May 9, 2026*
