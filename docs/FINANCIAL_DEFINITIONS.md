# Financial definitions (managerial, not statutory)

Valemont OS is a management dashboard. It is not bookkeeping, certified invoicing or tax advice, and claims no compliance with French or Spanish e-invoicing. Pure functions: `src/domain/finance.ts`, `src/domain/fx.ts` (tests next to them; scenarios 8 and 9 in `tests/integration/finance.test.ts`). Decision: D078.

| Term | Definition |
|---|---|
| Cost centers | Valemont Consulting, Valemont Local, 30/30 AI, Shared (costs) / Not allocated (revenue). Consolidated = sum. |
| Cash collected / paid | Recorded payment events only (Wise, Stripe, manual entries), VAT included. Quotes, accepted proposals, unpaid invoices and the weighted pipeline are never cash. |
| Recognized revenue | Ex VAT. (1) Earned revenue-schedule lines of one-off contracts (a milestone is earned when it is done or marked earned); payments of such a contract are cash only. (2) Other revenue payments spread by day over their service period; a payment linked to a subscription with no period covers its billing months from the payment month. (3) Otherwise recognized on the payment date and the month is **provisional** (invoice-based estimate). Refunds to clients reduce revenue. |
| Direct costs (COGS) | Categories contractors and API/AI tokens by default; any movement can be switched between direct and operating. |
| Gross profit / margin | Recognized revenue − direct costs; margin = gross profit ÷ recognized revenue (none without revenue). |
| Operating expenses | Every other expense category, ex VAT, spread over a service period when one is entered. |
| Estimated EBITDA | Recognized revenue − direct costs − operating expenses; excludes interest, taxes, depreciation, amortization. Shown as "Provisional EBITDA (invoice-based estimate)" when part of the revenue is cash-based. Never audited EBITDA. |
| Outside EBITDA | Taxes, VAT payments, interest and other non-operating income. |
| Neither income nor expense | Founder contributions, transfers between our balances (including Stripe payouts into Wise), loans. Personal salaries or expenses are not Valemont costs unless recorded as such. |
| MRR | Sum of active subscription contracts on the date, normalized by billing period (yearly ÷ 12). Excludes VAT, set-up fees, one-off sales (30/30), unsigned quotes. The Stripe snapshot is shown for comparison and used only while no subscription contract exists. |
| MRR movements | Per client, month end vs previous month end: new, expansion, contraction, churn, reactivation. |
| ARR | MRR × 12, a run rate: not booked annual revenue and not a forecast. |
| Runway | Cash (Wise + Stripe balances, converted at the latest rate) ÷ average net operating cash burn of the last 3 complete months; not shown when the business does not burn cash. |
| Set-up fees | Never in MRR. Recognized on payment (setting `finance_setup_fee_recognition`), to confirm with the accountant. |
| FX | ECB reference rate of the transaction date (1 EUR = rate × currency), last publication up to 7 days old (weekends, holidays) with its real date shown; integer maths ×10^6, half away from zero. Manual entries lock rate, date and source. No rate → refused (entry) or left out of totals and counted (bank row); a founder may enter the bank's rate by hand. The EUR/USD switch is a reporting conversion, never a restatement. DEMO uses labelled demo rates. |
| Corrections | Manual entries are never edited or deleted: a reversing entry (same locked rate, opposite amounts) cancels one. |

Accountant exports: Money › Export (team) includes "Managerial P&L by month" next to bank movements by category.
