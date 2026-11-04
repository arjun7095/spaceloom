# PrimeSpace IPFM

Integrated Property & Facility Management for PrimeSpace Property Services. One web app for manpower, attendance, assets and PPM, helpdesk with SLA, inventory and procurement, vendors and AMC, HSE, the KPI dashboard, daily workflow and client reporting. It also works on phones for technicians, guards, tenants and vendors.

Built with MongoDB, Express, React and Node.js in plain JavaScript, with separate `backend/` and `frontend/` folders.

## Quick start

You need **Node.js 20+** and **MongoDB 6+** running on `localhost:27017`.

```bash
# 1. API (http://localhost:5080)
cd backend
cp .env.example .env        # defaults work for local use
npm install
npm run seed                # builds the two demo properties (~40 s)
npm run dev

# 2. Web app (http://localhost:5173), in a second terminal
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. On the sign-in page, click any **demo role card** to sign in as that person. Every demo account uses the password `Demo@123`.

| Role | Login | Try this |
|---|---|---|
| Property Manager | pm@primespace.demo | Dashboard, approvals, client report sign-off |
| Engineering Supervisor | eng.supervisor@primespace.demo | Assign tickets, verify work, roster |
| Helpdesk Executive | helpdesk@primespace.demo | Raise tickets for callers, watch SLA timers |
| HVAC Technician (phone layout) | hvac.tech@primespace.demo | Check in, do jobs with checklist, photos and signature |
| Tenant (phone layout) | tenant@primespace.demo | Report a problem, track it, confirm and rate |
| Storekeeper | store@primespace.demo | Issue parts, reorder alerts, goods receipts |
| HSE Officer | hse@primespace.demo | Incidents, inspections, CAPA, permits |
| Client / Owner | owner@primespace.demo | Portfolio table across both properties, high-value approvals |
| Mall Property Manager | pm.mall@primespace.demo | The second property, Prime Galleria Mall (also mall.supervisor@) |
| Procurement / Vendor / Super Admin / Auditor | procurement@, vendor@, admin@, auditor@ | |

New users get a short welcome guide for their role on first sign-in. The **Help center** (the ? icon) has the step-by-step live demo, a glossary and FAQs.

The seed has two properties. **Prime Tech Park** has the slide-11 figures and the live demo. **Prime Galleria Mall** has its own staff, assets, tickets and 30 days of KPI history. The owner, admin and auditor can switch between them with the property picker in the top bar.

## The live demo (deck slide 14)

1. **Tenant** reports "AHU not cooling" at Tower A / Floor 05 and picks asset AHU-A-05. The app suggests P2 and starts the SLA clock.
2. **Engineering Supervisor** opens it from *Today* and assigns Ravi Kumar (HVAC, on shift).
3. **HVAC Technician** acknowledges, starts work, and requests an AHU pre-filter and a V-belt.
4. **Storekeeper** issues the parts. The ledger updates and a reorder alert fires.
5. **Technician** fills the checklist, adds before/after photos, signs and completes.
6. **Supervisor** verifies, which resolves the ticket. **Tenant** confirms and rates, which closes it. The dashboard tiles update live.

The breach path runs automatically: the SLA monitor warns the supervisor at 75% and escalates to the PM and then the owner. To trigger it on demand, use *Admin → System jobs → sla-monitor → Run now*.

## Phones: offline, push and QR scanning

The app installs on a phone like a native app (PWA). Service workers only run on a production build, so test these features with:

```bash
cd frontend
npm run build
npm run preview             # http://localhost:4173 (proxies /api to the API on 5080)
```

| Feature | How to try it |
|---|---|
| **Offline mode** | Sign in as the HVAC technician and open *Today*, *My jobs* and *Check in* once. Turn the network off (or stop the API). The screens still open from the phone's cache. Check-in/out, acknowledge/start/hold on tickets, parts requests and job completion (with photos) are saved on the phone. An "Offline · n to sync" chip appears in the top bar. When the signal returns they are sent in order; the server keeps the time of the tap and flags anything that synced more than 2 minutes late. |
| **Phone push** | *Profile → Phone notifications & delivery tests → This device*. On iPhone this works only after "Add to Home Screen". The *Send me a test…* buttons check each channel. |
| **QR scanner** | Use the scan icon in the top bar, or *Scan a QR code* on *Raise a ticket*. Scanning an asset sticker opens the asset (or fills the ticket's location and asset). If the camera is blocked, the code can be typed in. |

Phone browsers allow the camera, location and push only on `https://` or `localhost`. To test on a real phone, put the app behind HTTPS, for example with a tunnel or a reverse proxy that has a certificate.

## Connecting other systems

- **API keys (BMS, ERP, devices)**: *Admin → API keys & integrations*. Create a key with only the permissions it needs. The key is shown once, so copy it then. Send it in the `X-API-Key` header to `/api/v1/public/...`. The same screen lists every endpoint with a curl example. BMS alarms posted to `/public/assets/:code/alarms` become tickets, and repeats within 2 hours are not duplicated.
- **Email-to-ticket**: point your mail provider's inbound webhook (Mailgun, SendGrid Inbound Parse, Postmark) at `POST /api/v1/inbound/email?token=<INBOUND_EMAIL_TOKEN>`. Only senders who are registered users become tickets. The category is guessed from the wording, and the sender gets a reply with the ticket number.
- **Approval rules**: *Setup → Approval rules*. Edit who approves leave, overtime, purchase requests, POs, AMC renewals and permits, and above what amount.
- **Client reports**: *Reports → Schedules*. Set daily, weekly or monthly sending times and recipients. Reports are emailed as PDF attachments, and can also be sent automatically when the PM signs a report off.

## Useful commands

| Where | Command | What it does |
|---|---|---|
| backend | `npm run dev` | API + Socket.IO + scheduler, restarts on change |
| backend | `npm run seed` | Wipes and rebuilds the demo data |
| backend | `npm run test:demo` | Runs the live demo, breach path and access checks against the running API |
| backend | `npm run worker` | Runs the scheduler on its own (set `RUN_JOBS=false` on the API) |
| frontend | `npm run build` | Production build into `frontend/dist` |
| frontend | `npm run preview` | Serves the production build on 4173, with offline mode and push |

Demo data can also be reset from the app: *Admin → System jobs → Reset demo data* (while `DEMO_MODE=true`).

## Project layout

```
backend/   Express API (src/modules), Mongoose models, generic CRUD engine (src/lib/crud.js),
           scheduler (src/jobs), seed (src/seed), API test (tests/)
frontend/  React + Vite + MUI. Pages in src/pages; ~45 master/workflow screens are generated
           from src/config/resources.jsx; onboarding text in src/config/guide.js
docs/      PLAN.md (scope and status), DECISIONS.md (choices and deviations from the spec)
```

## Configuration notes

- The API listens on **5080**, not 5000, because port 5000 is commonly taken on Windows. Change `PORT` in `backend/.env` and `VITE_API_PROXY` for the frontend if you move it.
- **Email**: without `SMTP_HOST`, emails (including report PDFs) are printed to the API console. Password-reset codes are also shown in the app while not in production.
- **SMS / WhatsApp**: `SMS_PROVIDER` and `WHATSAPP_PROVIDER` take `console` (log only), `twilio` (set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`) or `webhook` (we POST JSON to your own gateway at `MESSAGE_WEBHOOK_URL`, for example MSG91 or Gupshup through a small relay). Numbers without a country code get `DEFAULT_COUNTRY_CODE` (91). Every notification records whether each channel succeeded.
- **Files**: stored in `backend/uploads/`, or in S3 (or an S3-compatible store) when `S3_BUCKET` is set. Every file link the API returns is signed and expires after `SIGNED_URL_TTL_SEC` (6 h by default). With S3, the API redirects to a 5-minute presigned URL. Links pasted outside the app stop working.
- **Privacy (DPDP)**: check-in selfies and GPS coordinates are deleted nightly after the number of days set on the property (*Setup → Properties → Keep selfies & GPS for*; 90 by default).
- **Push keys**: leave `VAPID_*` empty and the API generates a key pair once and stores it in the database. Set them yourself if several API servers share one database and should use the same keys.
- Set real `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` and `INBOUND_EMAIL_TOKEN` values before any deployment.
