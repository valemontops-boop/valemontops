# Schema (Stage 1A)

Generated from `src/data/schema/tables.ts` (the single source of truth). Every tab also has the base columns
`id` (UUID), `created_at`, `updated_at` (ISO 8601 UTC), `updated_by` (founder key or `system`), `version`, `is_archived`, `write_id`.

System tabs: `_Revisions` (domain, token, updated_at: polled revision tokens), `_Doctor` (doctor round-trip; always cleaned).

JSON-serialised columns: `Users.workdays` (array of weekday numbers, 0 = Sunday), `DailyPlans.targets` (metric → {target, weight, minutes}).

Money: `Opportunities.value_minor` is integer EUR cents plus `currency`. Never binary floats.

| Tab | Domain | Columns (after base) |
|---|---|---|
| SystemSettings | settings | key, value, description |
| Users | settings | founder_key, display_name, role, timezone, workdays, capacity_minutes, onboarded_at |
| WorkModes | settings | founder_key, mode, effective_from, reason |
| DailyTargets | settings | founder_key, mode, metric, target, weight, minutes_per_action, effective_from |
| DailyPlans | settings | founder_key, local_date, timezone, mode, is_workday, capacity_minutes, targets |
| ActivityEvents | activity | idempotency_key, founder_key, activity_type, channel, account_id, contact_id, opportunity_id, campaign_id, brand, market, outcome, objection, objection_note, met_person, notes, next_action, next_action_due, occurred_at, logged_at, timezone, local_date, late_logged, source, corrects_event_id |
| Accounts | crm | name, sector, niche, country, city, website, domain_normalized, phone, email, linkedin_url, lead_source, lead_type, brand, owner_founder, lead_status, observed_problem, problem_evidence, language, notes, import_batch_id |
| Contacts | crm | account_id, full_name, role, is_decision_maker, phone, email, linkedin_url, contact_type, language, consent_status, lawful_basis, source, retention_review_at, import_batch_id |
| Opportunities | crm | account_id, primary_contact_id, name, brand, market, stage, owner_founder, value_minor, currency, expected_close, next_action, next_action_due, next_action_priority, lost_reason, anum_authority, anum_need, anum_urgency, anum_money |
| OpportunityStageEvents | crm | opportunity_id, from_stage, to_stage, changed_at, changed_by, reason |
| ChannelRules | settings | market, contact_type, channel, status, note, source_url, review_date |
| SuppressionList | crm | kind, value_normalized, contact_id, account_id, reason, added_by |
| AuditLog | audit | actor, action, table_name, record_id, fields, correlation_id |
| SchemaMigrations | settings | schema_version, schema_hash, applied_at, notes |

## Relations
- Contacts.account_id → Accounts.id
- Opportunities.account_id → Accounts.id; primary_contact_id → Contacts.id
- OpportunityStageEvents.opportunity_id → Opportunities.id (append-only history)
- ActivityEvents.account_id / contact_id / opportunity_id → respective ids (append-only; dedupe by idempotency_key)
- SuppressionList.contact_id → Contacts.id (or a normalised email/phone/domain value)
- ChannelRules keyed by (market, contact_type, channel)
- WorkModes, DailyTargets: append-only, effective_from; latest row ≤ date wins
- DailyPlans: one per founder per local date (UUIDv5 of founder+date)

Private founder spreadsheets (JobApplications, PrivateTasks) and later-stage tabs are added by `setup:sheets` migrations in their stage.
