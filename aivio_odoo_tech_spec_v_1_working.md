# AIVIO × Odoo White‑Label Frontend + Campaign/Robot – Tech Spec v1 (working)

## 0) Cél és Definition of Done
**Cél:** AIVIO legyen az единetlen UI az Odoo CRM/Contacts/Calendar/Activities felett, plusz kampány- és robot‑orchestráció (outbound sales, inbound CS, survey), **snapshot** címlistákkal, **RBAC**‑kal.

**DoD (v1):**
- Admin és Sales role működik (assigned scope: **meeting owner OR lead owner**).
- AIVIO UI-ban: CRM kanban + lead detail + partner lista + meeting alap (megtekintés + szerkesztés jogosultság szerint).
- **Snapshot builder** AIVIO UI-ból **állítható schedule window** és retry policy mellett.
- Outbound phone kampány, meeting foglalással.
- Inbound webchat widget + meeting foglalás.
- Minden interakció logolva Odoo-ba (note/chatter + activity + meeting).
- Non‑regression: meglévő oldal funkciói sértetlenek, feature flaggel bevezetve.

---

## 1) Architektúra

### 1.1 Komponensek
1) **AIVIO Web UI**
- CRM Mirror (Kanban, Lead detail, Partner list/detail, Activity timeline)
- Campaign CMS (filters, snapshot, campaigns, results)
- Appointment UI (availability/slots, bookings)
- User Management UI (admin)
- **CSV Import UI** (potenciális partnerek tömeges feltöltése)

2) **AIVIO BFF API**
- Auth + RBAC enforcement
- Odoo adapter (read/write)
- Pagination/filter mapping
- UI aggregáció (kanban board összeállítás, timeline)

3) **AIVIO Orchestrator**
- Campaign scheduler (time window **parametrizálható**)
- Membership state machine (attempts, next_try_at)
- Channel adapters (phone MVP; később email/messaging)
- Robot runtime integration
- Odoo writeback queue (idempotent)

4) **State/Storage**
- Postgres (AIVIO DB): snapshots, campaigns, memberships, logs, audit, import batch
- Redis (ajánlott): session state + idempotency locks + rate limiting

5) **Odoo (hidden)**
- res.partner, crm.lead/opportunity, mail.message, mail.activity, calendar.event, (appointment)

---

## 2) CRM szegmentáció: Potenciális vs Szerződött partnerek

### 2.1 Üzleti elv
- **Potenciális partnerek**: outbound sales kampány célpontjai.
- **Szerződött partnerek**: elégedettségmérés (survey) célpontjai.

### 2.2 Megvalósítási opciók (javasolt)
**Ajánlott: Odoo‑ban Partner Tag / Category + (opcionális) Státusz mező**
- `res.partner.category_id` (tag) pl. `status:prospect`, `status:contracted`.
- Alternatív/plusz: custom field `x_partner_status` enum: `prospect|contracted|inactive`.

**Minden szűrés a ti UI‑ból indul**, de Odoo domain query‑vé fordul.

---

## 3) Tömeges feltöltés (potenciális partnerek)

### 3.1 Ajánlott irány
**CSV import a ti UI‑ban** → AIVIO backend validál → idempotens upsert Odoo `res.partner` (+ contacts) → import report.

### 3.2 CSV séma (MVP)
- company_name (kötelező)
- tax_id (opcionális, ha B2B HU)
- website
- industry
- city
- contact_name
- phone
- email
- linkedin_url (opcionális)
- notes
- tags (comma-separated)
- status (default: prospect)

### 3.3 Import pipeline
1) Upload → create `import_batch`
2) Parse + normalize:
   - phone → E.164
   - email → lowercase
   - website → canonical host
3) Dedupe rules:
   - 1) tax_id
   - 2) email (contact)
   - 3) phone
   - 4) company_name + website
4) Upsert Odoo:
   - partner create/update
   - child contact create/update (ha van)
   - tag/status beállítás
5) Report UI:
   - created/updated/skipped/error list

### 3.4 Idempotency
- per row key: `hash(company_name|tax_id|website|phone|email)`
- import batch re-run safe.

---

## 4) Kampány rendszer – Schedule window állítható

### 4.1 Kampány konfiguráció (UI)
- `schedule_window_json`:
  - timezone (default Europe/Budapest)
  - days_of_week (Mon..Sun)
  - time_ranges (pl. [09:00-12:00, 13:00-16:00])
  - holiday_exclusions (v1.1)
- retry_policy_json:
  - rules by outcome
  - max_attempts
  - escalation (multi-channel fallback v2)

### 4.2 Orchestrator time-window logic
- Next eligible time = `compute_next_run(now, window)`
- Outside window → postpone `next_try_at`.

---

## 5) RBAC / IAM (röviden)
- Assigned meeting = `calendar.event.user_id` (owner)
- Assigned lead = `crm.lead.user_id` (owner)
- Sales scope = UNION(meeting owner, lead owner)
- Admin reassign meeting owner + audit.

---

## 6) Következő pontosítások (nyitott döntések)
- Contracted vs prospect jelölés: tag vs custom field (javaslat: **mindkettő**, de MVP-ben elég tag).
- Odoo oldali import: közvetlen API write vs staging table (MVP: közvetlen + DLQ).
- Adatminőség: tax_id kötelező-e bizonyos szegmenseknél.

