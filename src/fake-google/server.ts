/** Fake Google Calendar + Drive HTTP API for tests (spec 10). Tokens: "sa-token" = service account. */
import http from "node:http";
import { FakeGoogleStore } from "./store";
import type { Fault } from "../fake-sheets/server";

export class FakeGoogleServer {
  readonly store = new FakeGoogleStore();
  faults: Fault[] = [];
  log: { method: string; path: string; token: string; status: number }[] = [];
  private server: http.Server | null = null;
  url = "";

  async start() {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
    return this.url;
  }
  async stop() {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://fake");
    const method = req.method ?? "GET";
    const token = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const send = (status: number, body: unknown) => {
      this.log.push({ method, path: url.pathname, token, status });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const fault = this.faults.find((f) => f.times > 0 && (!f.method || f.method === method) && (!f.pathIncludes || url.pathname.includes(f.pathIncludes)));
    if (fault) {
      fault.times--;
      return send(fault.status, { error: { code: fault.status, message: "Injected fault" } });
    }
    if (!token) return send(401, { error: { code: 401, message: "Login Required" } });
    const s = this.store;
    try {
      let m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname);
      if (m) {
        const cal = decodeURIComponent(m[1]);
        if (method === "GET" && !m[2]) {
          const items = s.list(cal, url.searchParams.get("timeMin") ?? "", url.searchParams.get("timeMax") ?? "9999");
          return send(200, { items: items.map(toG) });
        }
        if (method === "GET" && m[2]) {
          const e = s.get(cal, decodeURIComponent(m[2]));
          return e ? send(200, toG(e)) : send(404, { error: { code: 404, message: "Not Found" } });
        }
        if (method === "POST") {
          const b = JSON.parse(raw.toString("utf8"));
          if (!/^[0-9a-v]{5,1024}$/.test(b.id ?? "")) return send(400, { error: { code: 400, message: "Invalid resource id value." } });
          const r = s.insert(cal, { id: b.id, title: b.summary ?? "", description: b.description ?? "", start: b.start?.dateTime, end: b.end?.dateTime }, token === "sa-token" ? "service-account" : token);
          return r.created ? send(200, toG(r.event)) : send(409, { error: { code: 409, message: "The requested identifier already exists." } });
        }
      }
      if (url.pathname === "/calendar/v3/freeBusy" && method === "POST") {
        const b = JSON.parse(raw.toString("utf8")) as { timeMin: string; timeMax: string; items: { id: string }[] };
        return send(200, { calendars: Object.fromEntries(b.items.map((i) => [i.id, { busy: s.busy(i.id, b.timeMin, b.timeMax) }])) });
      }
      if (url.pathname === "/drive/v3/files" && method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        const folder = /'([^']+)' in parents/.exec(q)?.[1];
        const search = /name contains '([^']*)'/.exec(q)?.[1];
        if (folder) return send(200, { files: s.listFiles(folder, search) });
        if (search !== undefined) return send(200, { files: s.searchFiles(search) });
        return send(200, { files: s.recentFiles(Number(url.searchParams.get("pageSize") ?? 20)) });
      }
      if (url.pathname === "/drive/v3/files" && method === "POST") {
        if (token === "sa-token") return send(403, { error: { code: 403, message: "Service Accounts do not have storage quota." } });
        const b = JSON.parse(raw.toString("utf8")) as { name: string; mimeType: string; parents?: string[] };
        s.writes.push({ kind: "drive.folder", by: token });
        return send(200, s.addFile({ id: `fld-${s.files.length + 1}`, name: b.name, mimeType: b.mimeType, parents: b.parents ?? [] }, token));
      }
      m = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (m && method === "GET") {
        const f = s.files.find((x) => x.id === decodeURIComponent(m![1]));
        return f ? send(200, f) : send(404, { error: { code: 404, message: "File not found" } });
      }
      if (url.pathname === "/upload/drive/v3/files" && method === "POST") {
        // Like real personal Google accounts: a service account has no storage quota (spec 4.8).
        if (token === "sa-token") return send(403, { error: { code: 403, message: "Service Accounts do not have storage quota.", errors: [{ reason: "storageQuotaExceeded" }] } });
        const meta = JSON.parse(/\{[^\r\n]*\}/.exec(raw.toString("utf8"))?.[0] ?? "{}") as { name?: string; mimeType?: string; parents?: string[] };
        s.writes.push({ kind: "drive.upload", by: token });
        return send(200, s.addFile({ id: `upl-${s.files.length + 1}`, name: meta.name ?? "file", mimeType: meta.mimeType, parents: meta.parents ?? [] }, token));
      }
      return send(404, { error: { code: 404, message: `Unsupported ${method} ${url.pathname}` } });
    } catch (e) {
      return send((e as { status?: number }).status ?? 500, { error: { message: (e as Error).message } });
    }
  }
}

function toG(e: { id: string; title: string; description: string; start: string; end: string; status: string; htmlLink: string }) {
  return { id: e.id, summary: e.title, description: e.description, start: { dateTime: e.start }, end: { dateTime: e.end }, status: e.status, htmlLink: e.htmlLink };
}
