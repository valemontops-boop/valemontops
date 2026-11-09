import { createPrivateKey, sign } from "node:crypto";
import { StorageError } from "../repository";

/** Wise read access (round 5): balances, statements, profile. Amounts are decimal in Wise, minor units here. */
export interface BankBalance { id: string; currency: string; amount_minor: number; name: string }
export interface BankTx {
  referenceNumber: string; direction: "credit" | "debit"; occurred_at: string; amount_minor: number; currency: string; fee_minor: number | null;
  description: string; counterparty: string; detailsType: string; merchantCategory: string; running_balance_minor: number | null;
  /** D085: the other side of a cross-currency movement (e.g. USD sent to a contractor out of the EUR balance); "" / null otherwise. */
  fx_currency?: string; fx_amount_minor?: number | null;
}
/** Wise's current mid-market rate for a pair (GET /v1/rates). */
export interface WiseRate { rate: number; time: string }
export interface BankPort {
  profileId(): Promise<string>;
  balances(profileId: string): Promise<BankBalance[]>;
  statement(profileId: string, balanceId: string, currency: string, fromIso: string, toIso: string): Promise<BankTx[]>;
  /** Current rate source → target (D085: USD → EUR to estimate contractor payments). Optional: fakes may not have it. */
  rate?(source: string, target: string): Promise<WiseRate>;
}

/** Wise asks for strong customer authentication (PSD2) on statements and no signing key is configured or accepted. */
export class ScaRequiredError extends Error {
  readonly code = "sca_required";
  constructor() { super("Wise requires strong authentication for statements. Add a signing key, or import a CSV statement."); }
}

const minor = (v: unknown) => Math.round(Number(v ?? 0) * 100);
type WAmount = { value?: number; currency?: string };
type WTx = {
  exchangeDetails?: { forAmount?: WAmount; toAmount?: WAmount; fromAmount?: WAmount; rate?: number | null } | null;
  type?: string; date?: string; amount?: { value?: number; currency?: string }; totalFees?: { value?: number }; runningBalance?: { value?: number };
  referenceNumber?: string; details?: { sourceAmount?: WAmount; targetAmount?: WAmount; amount?: WAmount; type?: string; description?: string; senderName?: string; recipient?: { name?: string }; merchant?: { name?: string; category?: string }; paymentReference?: string };
};
/**
 * The other currency of a cross-currency movement, read defensively from the statement: `exchangeDetails.forAmount`
 * (card / transfer in another currency), `toAmount` / `fromAmount`, or a conversion's `details.targetAmount` /
 * `sourceAmount` — the first amount whose currency differs from the movement's own.
 */
function otherSide(t: WTx): { fx_currency: string; fx_amount_minor: number | null } {
  const own = String(t.amount?.currency ?? "").toUpperCase();
  const cands = [t.exchangeDetails?.forAmount, t.exchangeDetails?.toAmount, t.exchangeDetails?.fromAmount, t.details?.targetAmount, t.details?.sourceAmount, t.details?.amount];
  const hit = cands.find((a) => a && a.currency && String(a.currency).toUpperCase() !== own && Number(a.value));
  return hit ? { fx_currency: String(hit.currency).toUpperCase().slice(0, 3), fx_amount_minor: Math.abs(minor(hit.value)) } : { fx_currency: "", fx_amount_minor: null };
}
export function mapStatement(json: { transactions?: WTx[] }): BankTx[] {
  return (json.transactions ?? []).map((t) => ({
    ...otherSide(t),
    referenceNumber: String(t.referenceNumber ?? ""),
    direction: (t.type ?? "").toUpperCase() === "CREDIT" ? "credit" : "debit",
    occurred_at: new Date(t.date ?? Date.now()).toISOString(),
    amount_minor: minor(t.amount?.value),
    currency: String(t.amount?.currency ?? ""),
    fee_minor: t.totalFees?.value !== undefined ? minor(t.totalFees.value) : null,
    description: String(t.details?.description ?? ""),
    counterparty: String(t.details?.senderName ?? t.details?.recipient?.name ?? t.details?.merchant?.name ?? ""),
    detailsType: String(t.details?.type ?? ""),
    merchantCategory: String(t.details?.merchant?.category ?? ""),
    running_balance_minor: t.runningBalance?.value !== undefined ? minor(t.runningBalance.value) : null,
  }));
}

/**
 * Personal API token (read-only) of the Wise business account. Statements may answer 403 with a one-time
 * token in `x-2fa-approval`: when a private key is configured (its public key uploaded in Wise), the token is
 * signed (RSA-SHA256) and the request repeated with `X-Signature`. Without a key → ScaRequiredError.
 */
export class WiseAdapter implements BankPort {
  constructor(private readonly base: string, private readonly token: string, private readonly privateKeyPem: string | null, private readonly fixedProfile: string | null = null) {}
  private async get<T>(path: string, extra: Record<string, string> = {}): Promise<{ status: number; data: T | null; ott: string | null }> {
    let res: Response;
    try {
      res = await fetch(this.base.replace(/\/$/, "") + path, { headers: { authorization: `Bearer ${this.token}`, ...extra }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    } catch {
      throw new StorageError("Wise is unreachable", undefined, true);
    }
    if (res.ok) return { status: res.status, data: (await res.json()) as T, ott: null };
    if (res.status === 403 && res.headers.get("x-2fa-approval")) return { status: 403, data: null, ott: res.headers.get("x-2fa-approval") };
    throw new StorageError(`Wise returned ${res.status}`, res.status, [429, 500, 502, 503, 504].includes(res.status));
  }
  async profileId() {
    if (this.fixedProfile) return this.fixedProfile;
    const r = await this.get<{ id: number | string; type?: string }[]>("/v2/profiles");
    const list = r.data ?? [];
    const p = list.find((x) => String(x.type ?? "").toLowerCase() === "business") ?? list[0];
    if (!p) throw new StorageError("No Wise profile found for this token");
    return String(p.id);
  }
  async balances(profileId: string) {
    const r = await this.get<{ id: number | string; currency: string; amount?: { value?: number }; name?: string | null }[]>(`/v4/profiles/${encodeURIComponent(profileId)}/balances?types=STANDARD`);
    return (r.data ?? []).map((b) => ({ id: String(b.id), currency: b.currency, amount_minor: minor(b.amount?.value), name: b.name ?? "" }));
  }
  async statement(profileId: string, balanceId: string, currency: string, fromIso: string, toIso: string) {
    const path = `/v1/profiles/${encodeURIComponent(profileId)}/balance-statements/${encodeURIComponent(balanceId)}/statement.json?currency=${encodeURIComponent(currency)}&intervalStart=${encodeURIComponent(fromIso)}&intervalEnd=${encodeURIComponent(toIso)}&type=COMPACT`;
    let r = await this.get<{ transactions?: WTx[] }>(path);
    if (r.status === 403 && r.ott) {
      if (!this.privateKeyPem) throw new ScaRequiredError();
      const signature = sign("sha256", Buffer.from(r.ott), createPrivateKey(this.privateKeyPem)).toString("base64");
      r = await this.get<{ transactions?: WTx[] }>(path, { "x-2fa-approval": r.ott, "X-Signature": signature });
      if (r.status === 403) throw new ScaRequiredError();
    }
    return mapStatement(r.data ?? {});
  }
  /** GET /v1/rates?source=USD&target=EUR → [{ rate, source, target, time }]. Read-only: same personal token. */
  async rate(source: string, target: string) {
    const r = await this.get<{ rate?: number; source?: string; target?: string; time?: string }[]>(`/v1/rates?source=${encodeURIComponent(source)}&target=${encodeURIComponent(target)}`);
    const x = (r.data ?? [])[0];
    const rate = Number(x?.rate);
    if (!x || !Number.isFinite(rate) || rate <= 0) throw new StorageError("Wise returned no rate");
    return { rate, time: String(x.time ?? new Date().toISOString()) };
  }
}
