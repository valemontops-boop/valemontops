# Schema (Stage 1B + feedback round 2)

Generated from `src/data/schema/tables.ts`. Every tab also has the base columns `id` (UUID), `created_at`, `updated_at`, `updated_by`, `version`, `is_archived`, `write_id`.

System tabs: `_Revisions` (domain, token, updated_at), `_Doctor` (doctor round-trip; always cleaned).

JSON columns: Users.workdays, DailyPlans.targets, Tasks.dependency_ids, Sprints.targets, Sprints.brand_split, Ideas.votes, DailyResultCorrections.event_ids.

Money: integer EUR cents (`value_minor`) + `currency`.

## Shared spreadsheet

| Tab | Domain | Columns (after base) |
|---|---|---|
| SystemSettings | settings | key, value, description |
| Users | settings | founder_key, display_name, role, timezone, workdays, capacity_minutes, onboarded_at, avail_start, avail_end |
| WorkModes | settings | founder_key, mode, effective_from, reason |
| DailyTargets | settings | founder_key, mode, metric, target, weight, minutes_per_action, effective_from |
| DailyPlans | settings | founder_key, local_date, timezone, mode, is_workday, capacity_minutes, targets |
| ActivityEvents | activity | idempotency_key, founder_key, activity_type, channel, account_id, contact_id, opportunity_id, campaign_id, brand, market, outcome, objection, objection_note, met_person, notes, next_action, next_action_due, occurred_at, logged_at, timezone, local_date, late_logged, source, corrects_event_id, call_session_id, list_id, target_key, duration_sec |
| Accounts | crm | name, sector, niche, country, city, website, domain_normalized, phone, email, linkedin_url, lead_source, lead_type, brand, owner_founder, lead_status, observed_problem, problem_evidence, language, notes, import_batch_id, list_id |
| Contacts | crm | account_id, full_name, role, is_decision_maker, phone, email, linkedin_url, contact_type, language, consent_status, lawful_basis, source, retention_review_at, import_batch_id |
| Opportunities | crm | account_id, primary_contact_id, name, brand, market, stage, owner_founder, value_minor, currency, expected_close, next_action, next_action_due, next_action_priority, next_action_reason, lost_reason, anum_authority, anum_need, anum_urgency, anum_money |
| OpportunityStageEvents | crm | opportunity_id, from_stage, to_stage, changed_at, changed_by, reason |
| ChannelRules | settings | market, contact_type, channel, status, note, source_url, review_date |
| SuppressionList | crm | kind, value_normalized, contact_id, account_id, reason, added_by |
| AuditLog | audit | actor, action, table_name, record_id, fields, correlation_id |
| SchemaMigrations | settings | schema_version, schema_hash, applied_at, notes |
| Tasks | work | title, description, owner, created_by_founder, account_id, opportunity_id, project_id, client_id, priority, status, estimated_minutes, due_at, recurrence, recurrence_parent_id, dependency_ids, completion_evidence, completed_at, visibility, snoozed_until, snooze_reason, area, source, source_id |
| TaskComments | work | task_id, author, body |
| DailyReviews | work | founder_key, local_date, went_well, blockers, tomorrow_priority |
| DailyResults | work | founder_key, local_date, status, attainment_pct, followups_ok, review_done, computed_at, correction_count |
| DailyResultCorrections | work | founder_key, local_date, reason, event_ids |
| Sprints | work | name, start_date, end_date, status, niche, targets, brand_split |
| WeeklyReviews | work | week_start, decisions, notes, priority_theo, priority_pablo |
| Ideas | work | text, note, brand, category, status, votes, reason, created_by_founder, converted_type, converted_id |
| FounderPoints | work | title, type, duration_min, status, start_at, calendar_event_id, recurrence, notes |
| FounderPointItems | work | point_id, kind, text, done, owner, task_id, idea_id |
| CalendarSources | settings | calendar_id, label, kind, owner_founder, access |
| CalendarLinks | work | calendar_id, event_id, record_type, record_id |
| NotificationStates | work | founder_key, dedupe_key, dismissed_at |
| FilesIndex | crm | file_id, name, mime_type, url, record_type, record_id, linked_by |
| SocialAccounts | audience | platform, handle, brand, market, owner_founder, connection_mode, visibility |
| SocialAccountDaily | audience | account_id, date, followers, views, impressions, reach, profile_visits, interactions, link_clicks, source, captured_at, import_file |
| IntegrationStatuses | settings | integration, status, last_success_at, last_error |
| CallLists | crm | name, source, market, niche, brand, owner_founder, notes |
| CallSessions | activity | founder_key, list_id, started_at, ended_at, notes |
| ContentLog | audience | idempotency_key, founder_key, deliverable, brand, language, title, url, local_date |
| AudienceBreakdown | audience | account_id, date, dimension, key, value, unit, source |
| TrafficDaily | audience | date, brand, source, medium, campaign, country, sessions, leads, meetings, purchases, revenue_minor, origin, import_file |

## Private spreadsheet per founder

| Tab | Columns (after base) |
|---|---|
| PrivateTasks | title, description, owner, created_by_founder, account_id, opportunity_id, project_id, client_id, priority, status, estimated_minutes, due_at, recurrence, recurrence_parent_id, dependency_ids, completion_evidence, completed_at, visibility, snoozed_until, snooze_reason, area, source, source_id |

## Relations
- Contacts.account_id, Opportunities.account_id → Accounts.id; OpportunityStageEvents.opportunity_id → Opportunities.id
- ActivityEvents.account_id / contact_id / opportunity_id (append-only; dedupe by idempotency_key)
- Tasks.account_id / opportunity_id; TaskComments.task_id → Tasks.id; Tasks.source_id → FounderPoints/Ideas
- FounderPointItems.point_id → FounderPoints.id (action items → Tasks via task_id); CalendarLinks map events to records
- DailyResults (one per founder/day, UUIDv5) ← DailyPlans snapshot, ActivityEvents, DailyReviews, DailyResultCorrections
- FilesIndex.record_id → Accounts/Opportunities/Tasks/Ideas; SocialAccountDaily.account_id → SocialAccounts.id
- Calendar titles are never stored: only CalendarLinks (calendar id, event id, record).
- CallLists.id = import id; Accounts.list_id → CallLists.id; CallSessions → ActivityEvents.call_session_id
- ContentLog (weekly deliverables), TrafficDaily (GA4/manual), AudienceBreakdown (country split per SocialAccount)
