# AIVIO × Odoo – Spec addendum (státusz, import, schedule)

## 1) Partner státusz: Prospect vs Contracted (C opció)

### 1.1 Definíció
A partner státusza **alapvetően automatikus jelből** származhat (szerződés / aktív szolgáltatás), de **admin felülbírálható**.

### 1.2 Megvalósítás (MVP ajánlás)
- Odoo `res.partner`-en használunk **Category/Tag**-et:
  - `status:prospect`
  - `status:contracted`
- (v1.1+) opcionális custom mező: `x_partner_status` enum `prospect|contracted|inactive` reportokhoz.
- Admin UI-ban legyen **státusz kapcsoló**, ami tag-et állít és auditál.

### 1.3 Automatikus jel (v1.1)
- Ha Odoo-ban van elérhető “aktív szerződés / szolgáltatás” jel (pl. subscription / contract modul, vagy egy custom flag), akkor az alapján:
  - `auto_status = contracted`
- Admin override:
  - `manual_status_override = true` és a tag/mező admin szerint áll.

### 1.4 Szűrési szabályok kampányokhoz
- Outbound Sales kampány default célcsoport: `status:prospect`
- Survey kampány default célcsoport: `status:contracted`
- Snapshot készítéskor a státusz **a snapshot_fields_json-ben** rögzítendő (audit/trace), de kampány futás előtt opt-out és manual override ellenőrizhető élőben.

---

## 2) Campaign schedule window – állítható kampányonként

### 2.1 Konfiguráció mező (AIVIO DB)
`campaigns.schedule_window_json`:
```json
{
  "timezone": "Europe/Budapest",
  "days_of_week": ["MON","TUE","WED","THU","FRI"],
  "time_ranges": [
    {"start": "09:00", "end": "12:00"},
    {"start": "13:00", "end": "16:00"}
  ],
  "holiday_exclusions": []
}
```

### 2.2 Orchestrator szabály
- Membership pick csak ha:
  - `now` benne van a window-ban
  - `next_try_at <= now`
- Ha `now` kívül van:
  - `next_try_at = compute_next_opening(now, window)`

---

## 3) Potenciális partnerek tömeges feltöltése (CSV import)

### 3.1 Cél
AIVIO UI-ból CSV feltöltéssel tömegesen létrehozhatók/frissíthetők **prospect** partnerek az Odoo-ban, a user nem lát Odoo-t.

### 3.2 CSV séma (MVP)
Kötelező:
- `company_name`

Ajánlott (legalább egyik):
- `phone` vagy `email`

Opcionális:
- `tax_id`
- `website`
- `industry`
- `city`
- `contact_name`
- `linkedin_url`
- `notes`
- `tags` (comma-separated)
- `status` (default `prospect`)

### 3.3 Validáció & normalizálás
- phone → E.164
- email → lowercase
- website → host canonical
- whitespace trimming

### 3.4 Dedupe / Upsert priority
1) `tax_id` (ha van)
2) contact `email`
3) partner `phone` (E.164)
4) `company_name + website_host`

### 3.5 Import pipeline
1) UI upload → `import_batch` létrehozás
2) Parse → per-row validation
3) Preview (X első sor) + hibák listája
4) Execute:
   - Odoo upsert partner
   - Odoo upsert contact (child partner), ha contact mezők vannak
   - Tag-ek + státusz beállítás
5) Report:
   - created / updated / skipped / error sorok

### 3.6 Idempotency
- Row key: `hash(company_name|tax_id|website_host|phone_e164|email)`
- Import batch re-run safe.

### 3.7 Audit
- `audit_logs`: batch indító user, fájl hash, sor statisztikák
- Odoo chatter note opcionális a partnerhez: “Imported via AIVIO batch {id}” (v1.1)

---

## 4) Cursor ticket javaslat (külön fejlesztési egységek)
1) Campaign schedule window UI + backend compute_next_opening
2) Partner status tag UI (admin) + audit + Odoo adapter
3) CSV import UI + backend pipeline + report + Odoo upsert service
4) Snapshot builder filter bővítés státusszal (prospect/contracted)

