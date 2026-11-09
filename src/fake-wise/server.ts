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
    if (req.headers.authorization !== "Bearer wise-test-token") return send(401, { error: "unauthorized" });
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
