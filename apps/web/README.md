# Grafting — Staff Collaboration & Planning App

**A mobile-first staff operations tool for Visalia Christian Reformed Church**

![Status](https://img.shields.io/badge/status-UI%20Shell%20Complete-teal)
![Stack](https://img.shields.io/badge/stack-React%20%2B%20Vite%20%2B%20Tailwind-blue)

---

## Overview

Grafting centralizes task management, collaborative project tracking, recurring rhythms, facility scheduling, and team messaging into one clean, intuitive app — built exclusively for the paid staff team at Visalia CRC.

## Current State (v0.1 — UI Shell)

The full frontend UI is implemented with mock data across all six sections:

| Section | Status | Description |
|---------|--------|-------------|
| **Dashboard** | ✅ Complete | Overview with stat cards, upcoming tasks, active projects |
| **Tasks** | ✅ Complete | Task list with status badges, assignee avatars, source indicators (manual, Gmail, Planning Center) |
| **Projects** | ✅ Complete | Project cards with progress bars, step counts, next-step preview |
| **Rhythms** | ✅ Complete | Recurring task list (weekly/monthly/annual) with pause toggle |
| **Messages** | ✅ Complete | Direct & project-scoped message threads with unread badges |
| **Facilities** | ✅ Complete | Room/space grid with capacity info and reservation lists |

### What's NOT built yet

- [ ] **Authentication** — Google SSO + email/password login
- [ ] **Database** — All data is currently mock; no persistence
- [ ] **CRUD operations** — No create/edit/delete functionality yet
- [ ] **Real-time sync** — No live updates between users
- [ ] **Integrations** — Gmail and Planning Center connections not wired
- [ ] **Notifications** — No push/email notification system
- [ ] **File attachments** — Not implemented
- [ ] **Search** — Global search UI exists but is non-functional

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript 5 |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 + shadcn/ui components |
| Routing | React Router v6 |
| Animation | Framer Motion |
| State (planned) | TanStack React Query |
| Backend (planned) | Supabase (Lovable Cloud) |

## Project Structure

```
src/
├── components/
│   ├── ui/              # shadcn/ui primitives (Button, Card, Dialog, etc.)
│   ├── AppLayout.tsx     # Main layout wrapper with sidebar
│   ├── AppSidebar.tsx    # Navigation sidebar with mobile support
│   ├── NavLink.tsx       # Active-aware navigation link
│   ├── PageHeader.tsx    # Reusable page title + action bar
│   ├── StatCard.tsx      # Dashboard metric card
│   └── TaskItem.tsx      # Task row component with status/assignee
├── data/
│   └── mockData.ts       # All mock data (tasks, projects, rhythms, messages, facilities)
├── pages/
│   ├── Dashboard.tsx     # Home overview
│   ├── Tasks.tsx         # Task management
│   ├── Projects.tsx      # Project tracking
│   ├── Rhythms.tsx       # Recurring tasks
│   ├── Messages.tsx      # Team messaging
│   └── Facilities.tsx    # Room/space scheduling
├── hooks/                # Custom React hooks
├── lib/                  # Utilities
└── App.tsx               # Route definitions
```

## Design System

- **Primary palette:** Teal (`hsl(174, 62%, 38%)`) on dark navy sidebar (`hsl(220, 35%, 14%)`)
- **Typography:** DM Sans (Google Fonts)
- **Components:** shadcn/ui with custom theming via CSS variables
- **Responsive:** Mobile-first, sidebar collapses to sheet on small screens

## Getting Started

```bash
npm install
npm run dev
```

## API configuration

The web app now reads its API base URL from `VITE_API_BASE_URL`.

- local development default: `http://localhost:4000`
- hosted target: `https://api.vcrcapps.com`

Create a local env file or set a Pages environment variable when deploying:

```bash
cp .env.example .env.local
```

## Next Milestone

Backend integration via Lovable Cloud (Supabase) — authentication, database tables, and real-time CRUD for all six sections.

---

Built with [Lovable](https://lovable.dev)
