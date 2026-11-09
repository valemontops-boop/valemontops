# Schema (Stage 1B + iteration 3)

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
| ActivityEvents | activity | idempotency_key, founder_key, activity_type, channel, account_id, contact_id, opportunity_id, campaign_id, brand, market, outcome, objection, objection_note, met_person, notes, next_action, next_action_due, occurred_at, logged_at, timezone, local_date, late_logged, source, corrects_event_id, call_session_id, list_id, target_key, duration_sec, objections, replies, offers_pitched, next_action_at |
| Accounts | crm | name, sector, niche, country, city, website, domain_normalized, phone, email, linkedin_url, lead_source, lead_type, brand, owner_founder, lead_status, observed_problem, problem_evidence, language, notes, import_batch_id, list_id |
| Contacts | crm | account_id, full_name, role, is_decision_maker, phone, email, linkedin_url, contact_type, language, consent_status, lawful_basis, source, retention_review_at, import_batch_id |
| Opportunities | crm | account_id, primary_contact_id, name, brand, market, stage, owner_founder, value_minor, currency, expected_close, next_action, next_action_due, next_action_priority, next_action_reason, lost_reason, anum_authority, anum_need, anum_urgency, anum_money |
| OpportunityStageEvents | crm | opportunity_id, from_stage, to_stage, changed_at, changed_by, reason |
| ChannelRules | settings | market, contact_type, channel, status, note, source_url, review_date |
| SuppressionList | crm | kind, value_normalized, contact_id, account_id, reason, added_by |
| AuditLog | audit | actor, action, table_name, record_id, fields, correlation_id, http_status, audit_scope (team/private), input_hash, ip_hash — append-only; written by route() for every authenticated mutation, field NAMES only, keyed hashes (D084); appended without a revision bump |
| BackupRuns | audit | day, trigger (scheduler/first_request/founder), status (running/done/error), owner, file_id, file_name, file_url, tabs, rows, verify_status (ok/mismatch/not_run), verify_detail, deleted, error, started_at, finished_at — lease row id = UUIDv5("backup-lease", day, 30-min window), first writer wins; done row id = UUIDv5("backup-run", day, "done") (D084) |
| SchemaMigrations | settings | schema_version, schema_hash, applied_at, notes |
| Tasks | work | title, description, owner, created_by_founder, account_id, opportunity_id, project_id, client_id, priority, status, estimated_minutes, due_at, recurrence, recurrence_days, recurrence_parent_id, dependency_ids, completion_evidence, completed_at, visibility, snoozed_until, snooze_reason, area, source, source_id |
| TaskComments | work | task_id, author, body |
| DailyReviews | work | founder_key, local_date, went_well, blockers, tomorrow_priority |
| DailyResults | work | founder_key, local_date, status, attainment_pct, followups_ok, review_done, computed_at, correction_count |
| DailyResultCorrections | work | founder_key, local_date, reason, event_ids |
| Sprints | work | name, start_date, end_date, status, niche, targets, brand_split |
| WeeklyReviews | work | week_start, decisions, notes, priority_theo, priority_pablo, worked, blocked |
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
| InboxItems | work | source, account_label, from_name, excerpt, url, received_at, status, assigned_founder, replied_at, external_id |
| SearchConsoleRows | audience | period_start, period_end, language, dimension, key, clicks, impressions, position_x10, origin, import_file |
| SeoAudits | audience | run_at, founder_key, site_urls, pages_checked, facts, pages, issues |
| WorkflowRuns | work | workflow, subject_type, subject_id, status, steps (JSON: step → status, at, ids, error), input (JSON, frozen at first run), started_by, last_error, attempts |
| Clients | work | account_id, opportunity_id, name, brand, market, owner_founder, status, started_on, workflow_run_id |
| Projects | work | client_id, account_id, opportunity_id, quote_id, name, brand, market, owner_founder, status, start_date, due_date, scope, services (JSON), checklist (JSON), revenue_one_off_minor, mrr_minor, term_months, est_founder_hours, est_api_minor, est_infra_minor, est_other_minor, handoff_promised, handoff_stakeholders, handoff_success, source, workflow_run_id |
| Milestones | work | project_id, title, due_date, done_at, sort |
| TimeEntries | work | project_id, person_kind, founder_key, vendor_id, date, minutes, note |
| ProjectCosts | work | project_id, date, kind, label, amount_minor, currency (EUR/USD, D085), tool_id, wise_tx_id (late, D085: the Wise payment whose real rate converts a USD cost) |
| ProjectAssignments | work | project_id, vendor_id, role, rate_minor, rate_unit, currency, planned_hours, start_date, end_date, status, note |
| Vendors | work | name, company, skills, services, timezone, country, currency, hourly_rate_minor, daily_rate_minor, fixed_rate_minor, capacity_hours_week, availability, response_sla_hours, nda_status, contract_status, rate_valid_until, contact_email, contact_phone, notes, quality_feedback |
| ToolCosts | work | name, provider, use_case, apis, integration_status, monthly_cost_minor, currency, usage_limits, pricing_version, pricing_date, owner_founder, environment, linked_project_ids, risk_notes, expense_category |
| AgentTemplates | work | name, kind, purpose, stack, inputs, outputs, linked_tool_ids, linked_project_ids, owner_founder, status, notes |
| LocalSubscriptionUsage | work | client_id, month (YYYY-MM), conversations, qualified_requests, automated_emails, support_minutes, locations, actual_cost_minor, source, note |
| PriceBookItems | crm | item_key, effective_from, active, brand, kind, name_fr, name_es, unit, price_mode (fixed/range/quote/founder_entered), one_time_min_minor, one_time_max_minor, monthly_min_minor, monthly_max_minor, price_setting_key, one_time_hours_x100, monthly_hours_x100, one_time_cost_minor, monthly_cost_minor, pilot_assumption, limits, notes |
| AuditTemplates | crm | template_key (sector.complexity.language), sector, complexity, language, title, questions (JSON, 10–20, Zod-validated) |
| AuditSessions | crm | opportunity_id, account_id, template_key, sector, complexity, language, questions (JSON copy, editable), answers (JSON), status, summary (JSON sections), summary_at, validated_by, validated_at, owner_founder |
| Quotes | crm | quote_group_id, quote_version, reference, opportunity_id, account_id, audit_session_id, status (draft/approved/sent/accepted/declined; expired derived), author, currency, language, client_country, valid_until, payment_terms, term_months, discount_bp, contingency_bp, hour_cost_minor, tax_rule (JSON snapshot), approval_required, approvals (JSON), trade_recorded, scope, exclusions, milestones (JSON), risks, pilot_terms, notes, lines_rev, sent_at, sent_by, decided_at, decided_by, decline_reason, superseded_by, pdf_drive_file_id |
| QuoteLines | crm | quote_id, lines_rev, position, price_book_item_id, item_key, label, description, billing (one_time/monthly), unit, quantity_x100, unit_price_minor, list_unit_price_minor, discount_bp, est_hours_x100, direct_cost_minor, pilot_assumption |
| CommercialPolicy | crm | key, value, effective_from, changed_by, note (append-only; keys: discount_bands, margin_guardrail_pct, tax_rules, validity_days, contingency_pct, payment_terms_FR/ES and legal fields legal_name, legal_form, address, seller_country, company_id, vat_number, share_capital, registry, iban, legal_mentions) |
| LedgerEntries | finance | date, kind (income/expense/adjustment), category, cost_center (consulting/local/thirty/shared), cost_class, currency, amount_minor (ex VAT, signed), vat_minor (signed), fx_rate, fx_date, fx_source (empty for EUR; for a USD supplier payment (D085) the locked rate as EUR per 1 USD, its date and source bank/wise/manual/demo; ecb rows from before D082 stay unconverted), eur_minor, eur_vat_minor (EUR amounts; 0 for a USD entry with no rate = "rate missing"), counterparty, reference, receipt_url, project_id, contract_id, service_from, service_to, corrects_id, note, wise_tx_id (late, D085) — append-only (D078) |
| FinanceAllocations | finance | bank_tx_id, cost_center, cost_class, vat_minor, service_from, service_to, contract_id, project_id, receipt_url, reference, reconciled, note — one per bank movement, version-checked |
| UsdRates | finance | date, rate (EUR per 1 USD, decimal string), source (wise/demo) — D085: today's Wise rate (`GET /v1/rates?source=USD&target=EUR`), one row per day, id = UUIDv5("usd-rate", date, source); demo rows only in DEMO/preview |
| Contracts | finance | client_id, project_id, quote_id, name, cost_center, kind (subscription/one_off), currency, setup_minor, one_off_minor, recurring_minor, billing_months, start_date, end_date, status (active/paused/ended), source (project/manual), notes |
| RevenueSchedules | finance | contract_id, line_key, label, kind (milestone/setup/one_off/manual), milestone_id, period_start, period_end, amount_minor, currency, status (planned/earned/cancelled), earned_on |
| FxRates | retired (D082) | No longer in the schema: not created by setup, not read or written. An existing tab in a live spreadsheet is left as it is (setup and doctor ignore tabs outside the schema); its data is not deleted. |

## Private spreadsheet per founder

| Tab | Columns (after base) |
|---|---|
| PrivateTasks | private | title, description, owner, created_by_founder, account_id, opportunity_id, project_id, client_id, priority, status, estimated_minutes, due_at, recurrence, recurrence_days, recurrence_parent_id, dependency_ids, completion_evidence, completed_at, visibility, snoozed_until, snooze_reason, area, source, source_id |
| Playbook | settings | kind, key, language, subject, body |
| EmailSends | activity | idempotency_key, founder_key, account_id, contact_id, activity_event_id, call_session_id, channel, via, context, template_key, language, brand, market, niche, to_address, subject, status, sent_at, local_date, gmail_message_id, gmail_thread_id, replied_at, reply_kind |

## Relations
- Contacts.account_id, Opportunities.account_id → Accounts.id; OpportunityStageEvents.opportunity_id → Opportunities.id
- ActivityEvents.account_id / contact_id / opportunity_id (append-only; dedupe by idempotency_key)
- Tasks.account_id / opportunity_id; TaskComments.task_id → Tasks.id; Tasks.source_id → FounderPoints/Ideas
- FounderPointItems.point_id → FounderPoints.id (action items → Tasks via task_id); CalendarLinks map events to records
- DailyResults (one per founder/day, UUIDv5) ← DailyPlans snapshot, ActivityEvents, DailyReviews, DailyResultCorrections
- FilesIndex.record_id → Accounts/Opportunities/Tasks/Ideas; SocialAccountDaily.account_id → SocialAccounts.id
- Calendar titles are never stored: only CalendarLinks (calendar id, event id, record).
- ActivityEvents.replies lists reply variants used ("too_expensive#2"); ActivityEvents.offers_pitched (late column, D071) lists the downsell offers made during a call ("local", "thirty"; "local_yes" / "thirty_yes" = accepted); ActivityEvents.next_action_at (late column, D080) is the call-back time set after a call (ISO, the queue brings the business back first once due); EmailSends.account_id → Accounts.id; activity_event_id → ActivityEvents.id (the follow-up event); Playbook overrides built-in templates by (kind, key, language)
- CallLists.id = import id; Accounts.list_id → CallLists.id; CallSessions → ActivityEvents.call_session_id
- ContentLog (weekly deliverables), TrafficDaily (GA4/manual), AudienceBreakdown (country split per SocialAccount)
- TrafficDaily.source/medium is classified at read time (src/domain/marketing.ts `classifyTraffic`): web browser (search, paid, direct, referral, other), AI engines, social networks
- InboxItems.id = UUIDv5("inbox", external_id), so a webhook retried or a comment delivered twice adds nothing; items derived from EmailSends (`email:<id>`, `whatsapp:<id>`), ActivityEvents (`activity:<id>`) and Accounts (`lead:<id>`) get a row only when marked replied/ignored
- SearchConsoleRows.id = UUIDv5("gsc", language, period_start, period_end, dimension, key): a GSC export imported twice adds nothing; only the latest period per language is summed (D072). SeoAudits: one row per audit run, the latest is shown.
- Stage 2B (D075): WorkflowRuns.id = UUIDv5("workflow", workflow, subject_id); Clients.id = UUIDv5("client", account_id) (one client per business); Projects / Milestones / kick-off Task ids = UUIDv5(run id, step, n), so a retried run never duplicates. LocalSubscriptionUsage.id = UUIDv5("local-usage", client_id, month). Projects → Clients → Accounts; Tasks.project_id / client_id link delivery tasks; ProjectAssignments → Vendors; TimeEntries.vendor_id → Vendors; ToolCosts / AgentTemplates link projects by id lists.
- Stage 2A (D074): PriceBookItems and CommercialPolicy are versioned by effective_from (latest ≤ date, then created_at, wins; edits append). Seed ids = UUIDv5("pricebook-seed", item_key) / ("policy-seed", key) / ("audit-template", template_key). AuditSessions.opportunity_id → Opportunities.id. Quotes.opportunity_id → Opportunities.id; a quote's current lines are QuoteLines with quote_id = Quotes.id AND lines_rev = Quotes.lines_rev (copy-on-write; other revs are ignored). New version id = UUIDv5(previous id, "next-version"), old version gets superseded_by. Quotes.reference = "VAL-" + first 8 hex of quote_group_id + "-V" + quote_version. proposal_sent ActivityEvent idempotency_key = UUIDv5("proposal-sent", quote_group_id). Quote PDFs saved to Drive are linked in FilesIndex (record_type opportunity).
- Stage 3 finance (D078): FinanceAllocations.id = UUIDv5("alloc", bank_tx_id) → BankTransactions.id; LedgerEntries.id = the form's UUID (a retry adds nothing), a reversal id = UUIDv5("ledger-reverse", entry id) with corrects_id → LedgerEntries.id; Contracts.id = UUIDv5("contract", project_id, kind) when made from a project (→ Projects / Clients / Quotes); RevenueSchedules.id = UUIDv5("schedule", contract_id, milestone_id | "one_off") → Contracts.id, milestone_id → Milestones.id (earned when the milestone is done); BankTransactions.category gains refund, api_tokens, hosting, marketing, sales_commissions, reimbursement, vat, loan (loan is neutral like contributions and transfers). FxRates and the ECB fetch status (IntegrationStatuses UUIDv5("integration", "ecb")) are retired by D082: any existing rows stay, unread.
- USD contractors (D085): BankTransactions gains late columns `fx_currency`, `fx_amount_minor` (the other side of a cross-currency Wise movement, e.g. 326 USD sent for 300 EUR debited; from the statement's exchange details or the CSV "Exchange To" / "Exchange To Amount"); ProjectCosts.wise_tx_id and LedgerEntries.wise_tx_id → BankTransactions.id; Vendors / ProjectAssignments / ProjectCosts currency is EUR or USD (rates and amounts in that currency); the manual rate is SystemSettings `usd_eur_rate_manual` (JSON {rate, date}, id UUIDv5("setting", key), version-checked); the Wise rate fetch status is IntegrationStatuses UUIDv5("integration", "wise_rates"). Run `npm run setup:sheets` once to add the tab and the late columns.
- Stage 3 marketing (D079): ContentPieces (one concept; mutable, expected_version) ← ContentVariants.piece_id (one per language, id = UUIDv5("content-variant", piece id, FR|ES); account_id → SocialAccounts.id; checklist_done = JSON array of checklist item keys; utm_* columns). SocialPostSnapshots (append-only for the API): id = UUIDv5("post-snap", account id, media id, h24|h72|d7|d30) or (…, "live", slot) for stories; hand-entered = UUIDv5("post-snap", variant id, checkpoint, "manual") (editable); variant_id → ContentVariants.id (also joined at read time by media_id or post link); availability "not_available" = Instagram served no value (never stored as 0); Instagram uses `views`, LinkedIn `impressions`, never summed. SnapshotRuns: one "done" row per 6-hour UTC slot (id = UUIDv5("snapshot-run", slot, "done")), error rows have random ids. Account days captured by the job go to SocialAccountDaily with source "api" (id = UUIDv5("social-daily", account, date, "api")). Publishing a variant appends ContentLog rows with idempotency_key = UUIDv5("content-publish", variant id) and, for the first published version of a Reel/VSL, UUIDv5("content-concept", piece id). Checklists: SystemSettings `content_checklist_instagram` / `content_checklist_linkedin` (JSON [{key,label}]). Round 11 (D081): ContentPieces.format reel / carousel / post / story / video (old brand_post, personal_post, vsl read as post / video) and stage idea / draft / ready (old script, shoot → draft, edit → ready); one ContentVariants row per account × language, id = UUIDv5("content-variant", piece id, FR|ES, account id) (older rows keep UUIDv5(piece, lang)); late columns scheduled_time (HH:MM local), hook, hashtags, alt_text, first_comment, cover_text, link_placement (first_comment | post | bio, empty = first_comment), drive_media (JSON array ≤ 20 of {file_id, name, mime, web_link, thumbnail_link, width, height, duration_ms}: Drive references only, no file copy). ContentLog.deliverable adds `ig_post` (Instagram posts and carousels).
