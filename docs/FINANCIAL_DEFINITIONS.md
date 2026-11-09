# Financial definitions (managerial, not statutory)

Valemont OS is a management dashboard. It is not bookkeeping, certified invoicing or tax advice, and claims no compliance with French or Spanish e-invoicing. Pure functions: `src/domain/finance.ts` (tests next to it; scenario 8 and the EUR-only rules in `tests/integration/finance.test.ts`). Decisions: D078, D082 (everything in EUR, no ECB rates), D085 (USD only to pay contractors).

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
| Runway | Cash (Wise + Stripe balances in EUR; balances in another currency are not converted and not counted) ÷ average net operating cash burn of the last 3 complete months; not shown when the business does not burn cash. |
| Set-up fees | Never in MRR. Recognized on payment (setting `finance_setup_fee_recognition`), to confirm with the accountant. |
| Currency | Everything is EUR (D082), with one exception (D085): contractors and supplier costs can be priced and paid in USD. Rate for a USD amount, in this order, never invented: (1) the real rate of the matching Wise payment (EUR actually debited ÷ USD sent, when a project cost or manual entry is linked to it), (2) today's Wise rate (LIVE, `GET /v1/rates`, cached once per day in UsdRates), (3) the founders' manual rate with its date (setting `usd_eur_rate_manual`), (4) DEMO/preview only: the stored demo rate, labelled "démo". Shown as "1 200 $US ≈ 1 104 € (taux Wise du 12/11)". Conversion: rate kept in millionths, integer maths, half away from zero. Manual USD entries (expenses only) lock rate, date, source and EUR amounts at entry; project costs and assignment rates convert at read (the bank rate once linked, else the current rate). No rate → the USD amount is shown with "taux manquant", counted, and left out of every EUR total. P&L, cash, MRR and project margins are in EUR. Any other currency, and any USD bank movement or balance itself, stays "hors EUR, non converti" as in D082. A Wise USD payment from the EUR balance is already an EUR movement: the P&L counts the EUR debited, the USD side is information. |
| Corrections | Manual entries are never edited or deleted: a reversing entry (opposite amounts) cancels one. |

Accountant exports: Money › Export (team) includes "Managerial P&L by month" next to bank movements by category.
