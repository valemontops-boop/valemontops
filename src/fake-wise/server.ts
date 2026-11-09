/** Fake Wise HTTP API for tests: profiles, balances, statements with the SCA one-time-token signing flow. */
import http from "node:http";
import { createPublicKey, verify } from "node:crypto";
import { FakeWiseStore } from "./store";

export class FakeWiseServer {
  readonly store = new FakeWiseStore();
  /** PEM of the public key uploaded "in Wise"; when null, statements are refused with SCA and cannot be signed. */
  publicKeyPem: string | null = null;
  requireSca = true;
  log: { path: string; status: number }[] = [];
  /** Statement windows asked (D091 backfill tests). */
  windows: { balanceId: string; from: string; to: string }[] = [];
  /** Answer 503 once this many statement windows were served (an interruption mid-walk). */
  failAfterWindows: number | null = null;
  /** Bearer token the fake accepts (tests may set a UUID-shaped one, like a real personal token). */
  token = "wise-test-token";
  private server: http.Server | null = null;
  url = "";
  async start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this.url;
  }
  async stop() { await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r())); }
  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://fake");
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      this.log.push({ path: url.pathname, status });
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${this.token}`) return send(401, { error: "unauthorized" });
    const s = this.store;
    if (url.pathname === "/v2/profiles") return send(200, [{ id: 1, type: "PERSONAL" }, { id: s.profile, type: "BUSINESS" }]);
    let m = /^\/v4\/profiles\/([^/]+)\/balances$/.exec(url.pathname);
    if (m) return send(200, s.balances.map((b) => ({ id: b.id, currency: b.currency, amount: { value: b.amount_minor / 100, currency: b.currency }, name: b.name, type: "STANDARD" })));
    m = /^\/v1\/profiles\/([^/]+)\/balance-statements\/([^/]+)\/statement\.json$/.exec(url.pathname);
    if (m) {
      if (this.requireSca) {
        const ott = req.headers["x-2fa-approval"];
        const sig = req.headers["x-signature"];
        const ok = typeof ott === "string" && typeof sig === "string" && this.publicKeyPem && verify("sha256", Buffer.from(ott), createPublicKey(this.publicKeyPem), Buffer.from(sig, "base64"));
        if (!ok) return send(403, { error: "sca_required" }, { "x-2fa-approval": `ott-${Date.now()}` });
      }
      const from = url.searchParams.get("intervalStart") ?? "";
      const to = url.searchParams.get("intervalEnd") ?? "9999";
      // Like Wise: a statement covers at most 469 days.
      if (from && to !== "9999" && Date.parse(to) - Date.parse(from) > 469 * 86_400_000) return send(400, { error: "interval_too_long" });
      this.windows.push({ balanceId: decodeURIComponent(m[2]), from, to });
      if (this.failAfterWindows !== null && this.windows.length > this.failAfterWindows) return send(503, { error: "unavailable" });
      const tx = s.txs.filter((t) => t.balanceId === decodeURIComponent(m![2]) && t.occurred_at >= from && t.occurred_at <= to);
      return send(200, { transactions: tx.map((t) => ({
        type: t.direction.toUpperCase(), date: t.occurred_at, amount: { value: t.amount_minor / 100, currency: t.currency }, totalFees: { value: (t.fee_minor ?? 0) / 100 },
        runningBalance: { value: (t.running_balance_minor ?? 0) / 100 }, referenceNumber: t.referenceNumber,
        details: { type: t.detailsType, description: t.description, senderName: t.direction === "credit" ? t.counterparty : undefined, merchant: t.merchantCategory ? { name: t.counterparty, category: t.merchantCategory } : undefined, recipient: t.direction === "debit" && !t.merchantCategory ? { name: t.counterparty } : undefined },
      })) });
    }
    return send(404, { error: "not_found" });
  }
}
