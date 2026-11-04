# PrimeSpace IPFM — Build Plan

Source of truth: *PrimeSpace IPFM — MERN Implementation Plan, Requirements & Build Prompt* (FR-x.y IDs below refer to it).

## Goals for this build
1. One MERN app covering all 16 modules, written in **JavaScript** (no TypeScript).
2. **Separate folders**: `backend/` (Express API + scheduler + seed) and `frontend/` (React + Vite).
3. **Usable on day one by someone new**: demo-role quick login, a welcome guide for each role, plain-language help on every page, a Help Center with a glossary and the live-demo script.
4. The slide-14 live demo works end to end on the seeded data.

## Architecture
```
frontend (React 18, Vite, MUI 5, TanStack Query, Zustand, Recharts, Leaflet)
   │  REST /api/v1 (JWT bearer + X-Property-Id)   │  Socket.IO (rooms per property and per user)
backend (Express 4, Mongoose 8, Zod, Socket.IO, node-cron)
   ├─ middleware: auth → RBAC (permission strings) → property scope (AsyncLocalStorage)
   ├─ Mongoose base plugin: orgId/propertyId, createdBy/updatedBy, soft delete, automatic scope filter
   ├─ generic resource engine (lib/crud.js): list/search/filter/sort/paginate/xlsx export,
   │    create/update/soft-delete with audit, state machine transitions, multi-level approvals
   ├─ domain modules: auth, tickets+SLA, work orders+PPM, inventory ledger, attendance+roster,
   │    dashboard/KPIs, Today board, EOD, reports, imports, admin/jobs
   ├─ integrations: signed file links + S3, Web Push, SMS/WhatsApp providers, public API keys,
   │    email-to-ticket webhook, server-side PDF
   └─ scheduler: SLA monitor, PPM + daily-check generator, AMC visits, expiry, reorder, absent marker,
        auto-close, KPI snapshot, scheduled client reports, vendor scores, privacy retention
MongoDB (local 8.0)
```

Approach for keeping the code small: about 45 master and workflow collections run on **one generic engine** on both sides (backend `lib/crud.js` + resource registry, frontend `ResourcePage` + `config/resources.jsx`). Hand-written code is kept for the flows where the rules matter: tickets, SLA, work orders, stock, attendance, dashboard, reports.

## Folder layout
```
backend/
  src/config      env, db
  src/constants   permissions, roles, enums
  src/lib         http, context, crud engine, audit, numbering, sla, socket, notify, excel, approvals
  src/middleware  auth/RBAC, property scope, upload, errors
  src/models      all Mongoose models + base plugin
  src/modules     auth, tickets, workorders, inventory, attendance, dashboard, reports, misc, resources
  src/jobs        scheduler + jobs
  src/seed        Prime Tech Park seed
  tests           demo-flow test (node:test)
frontend/
  src/api src/store src/theme.js src/utils
  src/config      nav, resources (generic pages), demo roles + guides
  src/components  DataTable, ResourceForm, RefSelect, SlaTimer, KpiTile, StatusChip, SignaturePad …
  src/layouts     office sidebar layout + field bottom-tab layout
  src/pages       dashboard, today, tickets, work orders, attendance, roster, stock, reports, help …
docs/  PLAN.md, DECISIONS.md
```

## Phases and status
| Phase | Scope | Status |
|---|---|---|
| 0 | Repo layout, theme, auth + RBAC + scope + audit + numbering + approval engine | ✅ this build |
| 1 | M1 setup, M2 users/roles/approvals, employees, vendors, assets, items, import wizard | ✅ this build |
| 2 | M3 attendance + roster, M5 helpdesk + SLA + Socket.IO + tenant portal, M4 PPM/WOs, M6 inventory/procurement, M7 vendors/AMC, device punch API, payroll export | ✅ this build |
| 3 | M8 HSE, M9 KPI dashboard, M10 Today/EOD, M11 reports, M12 SOPs, M13 notifications/escalations | ✅ this build |
| 4 | Seed data, demo reset, demo-flow test, README | ✅ this build |
| 5a | **Security and privacy**: signed file links, S3 adapter, DPDP retention job for selfies and GPS, real SMS/WhatsApp providers with delivery records | ✅ |
| 5b | **Field and phones**: PWA (installable, service worker), offline queue with photo blobs and sync status, Web Push, in-app QR scanner | ✅ |
| 5c | **Spec gaps**: daily critical-asset log sheets (FR-4.5), report schedules with PDF email attachments and auto-send on sign-off, org chart, quote comparison, return unused parts, ticket merge, comments with @mentions, approval rules on screen, polygon geo-fence editor, public API keys, email-to-ticket, second demo property (Prime Galleria Mall) | ✅ |
| 6 (next) | i18n (Hindi/Telugu), Swagger/OpenAPI, Docker Compose + GitHub Actions, Playwright suite in the repo, unit tests to 70% service coverage, k6/ZAP, native-app wrapper if needed | ⏭ backlog |

## Verification done
- `npm run test:demo` passes 19/19:
  - the slide-11 dashboard figures and the full slide-14 demo;
  - negative-stock protection, 409 on illegal transitions, role denials and property isolation;
  - the 75% / 100% / 150% escalation path;
  - signed links (unsigned or tampered links are refused), the daily log sheet with out-of-range readings, an offline check-out synced late (tap time kept, flagged);
  - approval rules edited and applied, report and PO PDFs, auto-send on sign-off;
  - the public API with key scopes, email-to-ticket, the polygon geo-fence, @mentions and the push key.
- Every list endpoint returns without server errors for 8 roles.
- A headless-browser sweep of the production build signed in as 9 roles (field roles at phone size) and visited about 110 screens, including detail drawers and the new pages. It found no runtime errors, blank pages or failed API calls. The only console output is MUI's DataGrid "0px width" notice when a row click leaves the list.
- Offline end-to-end on the production build, on a phone-sized screen, with the web server stopped:
  - the app shell and the technician's screens open from cache, and check-out is queued;
  - on reconnect "Synced 1 offline action" appears, and the server stores the tap time.

## Definition of done for this build
- `npm run seed` then `npm run dev` in both folders; log in with any demo role (password `Demo@123`).
- Dashboard shows the slide-11 figures (Attendance 94%, SLA 96%, PPM 92%, Open 18, Critical 2, AMC due 3, Inventory alerts 5, HSE incidents 1).
- The live demo passes through tenant → helpdesk → supervisor → technician → storekeeper → supervisor → tenant, and the tiles update live.
- `npm run test:demo` (backend) runs the demo flow through the API and passes.
