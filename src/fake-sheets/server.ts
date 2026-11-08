/**
 * Fake Google Sheets v4 HTTP server for tests and DEMO (spec 10).
 * Implements the subset Valemont OS uses, with fault injection (429/5xx/latency)
 * and faithful RAW vs USER_ENTERED semantics. NEVER used against real data.
 */
import http from "node:http";
import fs from "node:fs";
import { colLetters, parseRange } from "../data/sheets/a1";

type Cell = string | number | boolean;
interface FakeSheet {
  sheetId: number;
  title: string;
  grid: Cell[][];
  frozenRowCount: number;
  protectedRanges: { protectedRangeId: number; warningOnly: boolean; description?: string }[];
}
interface FakeSpreadsheet {
  title: string;
  sheets: FakeSheet[];
}
export interface Fault {
  status: number;
  times: number;
  method?: string;
  pathIncludes?: string;
  delayMs?: number;
}

export interface FakeSheetsOptions {
  port?: number;
  host?: string;
  persistPath?: string;
  spreadsheets?: Record<string, string>; // id -> title, created at start
}

export class FakeSheetsServer {
  readonly books = new Map<string, FakeSpreadsheet>();
  faults: Fault[] = [];
  requestLog: { method: string; path: string; status: number }[] = [];
  /** Test hook: runs after a values PUT is applied (simulate a concurrent writer). */
  afterPut: ((range: string) => void) | null = null;
  private server: http.Server | null = null;
  private nextSheetId = 1000;
  private nextProtId = 1;
  url = "";

  constructor(private readonly opts: FakeSheetsOptions = {}) {
    if (opts.persistPath && fs.existsSync(opts.persistPath)) {
      const raw = JSON.parse(fs.readFileSync(opts.persistPath, "utf8")) as Record<string, FakeSpreadsheet>;
      for (const [id, book] of Object.entries(raw)) this.books.set(id, book);
      this.nextSheetId = 1000 + [...this.books.values()].reduce((n, b) => n + b.sheets.length, 0) + 1;
    }
    for (const [id, title] of Object.entries(opts.spreadsheets ?? {})) {
      if (!this.books.has(id)) this.createSpreadsheet(id, title);
    }
  }

  createSpreadsheet(id: string, title: string) {
    this.books.set(id, { title, sheets: [] });
  }

  reset() {
    for (const b of this.books.values()) b.sheets = [];
    this.faults = [];
    this.requestLog = [];
    this.persist();
  }

  sheet(bookId: string, title: string): FakeSheet | undefined {
    return this.books.get(bookId)?.sheets.find((s) => s.title === title);
  }

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((e) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: 500, message: String((e as Error).message) } }));
      });
    });
    await new Promise<void>((r) => this.server!.listen(this.opts.port ?? 0, this.opts.host ?? "127.0.0.1", () => r()));
    const addr = this.server.address() as { port: number };
    this.url = `http://${this.opts.host ?? "127.0.0.1"}:${addr.port}`;
    return this.url;
  }

  async stop() {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = null;
  }

  private persist() {
    if (!this.opts.persistPath) return;
    fs.writeFileSync(this.opts.persistPath, JSON.stringify(Object.fromEntries(this.books)));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://fake");
    const method = req.method ?? "GET";
    const body = await readBody(req);
    const send = (status: number, payload: unknown) => {
      this.requestLog.push({ method, path: url.pathname, status });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    // ---- admin endpoints (local only) ----
    if (url.pathname.startsWith("/__fake/")) {
      const what = url.pathname.slice("/__fake/".length);
      if (what === "faults" && method === "POST") {
        this.faults.push(...(Array.isArray(body) ? body : [body]) as Fault[]);
        return send(200, { ok: true });
      }
      if (what === "faults" && method === "DELETE") {
        this.faults = [];
        return send(200, { ok: true });
      }
      if (what === "reset" && method === "POST") {
        this.reset();
        return send(200, { ok: true });
      }
      if (what === "health") return send(200, { ok: true });
      return send(404, { error: { code: 404, message: "unknown admin route" } });
    }

    // ---- fault injection ----
    const fault = this.faults.find(
      (f) => f.times > 0 && (!f.method || f.method === method) && (!f.pathIncludes || decodeURIComponent(url.pathname + url.search).includes(f.pathIncludes)),
    );
    if (fault) {
      fault.times--;
      if (fault.delayMs) await new Promise((r) => setTimeout(r, fault.delayMs));
      if (fault.status >= 400) return send(fault.status, { error: { code: fault.status, message: "Injected fault" } });
    }

    if (!String(req.headers.authorization ?? "").startsWith("Bearer ")) {
      return send(401, { error: { code: 401, message: "Request is missing required authentication credential." } });
    }

    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(url.pathname);
    if (!m) return send(404, { error: { code: 404, message: "Not found" } });
    const bookId = decodeURIComponent(m[1]);
    const rest = decodeURIComponent(m[2]);
    const book = this.books.get(bookId);
    if (!book) return send(404, { error: { code: 404, message: "Requested entity was not found." } });

    try {
      if (rest === "" && method === "GET") {
        return send(200, {
          spreadsheetId: bookId,
          properties: { title: book.title },
          sheets: book.sheets.map((s) => ({
            properties: {
              sheetId: s.sheetId,
              title: s.title,
              gridProperties: { rowCount: Math.max(s.grid.length, 1), columnCount: Math.max(1, ...s.grid.map((r) => r.length)), frozenRowCount: s.frozenRowCount },
            },
            protectedRanges: s.protectedRanges,
          })),
        });
      }
      if (rest === ":batchUpdate" && method === "POST") {
        const replies = ((body as { requests?: unknown[] }).requests ?? []).map((r) => this.structural(book, r as StructuralRequest));
        this.persist();
        return send(200, { spreadsheetId: bookId, replies });
      }
      if (rest === "/values:batchGet" && method === "GET") {
        const ranges = url.searchParams.getAll("ranges");
        const raw = url.searchParams.get("valueRenderOption") === "UNFORMATTED_VALUE";
        return send(200, { spreadsheetId: bookId, valueRanges: ranges.map((r) => ({ range: r, majorDimension: "ROWS", values: this.read(book, r, raw) })) });
      }
      const vm = /^\/values\/(.+?)(:append|:clear)?$/.exec(rest);
      if (vm) {
        const range = vm[1];
        const op = vm[2];
        const input = url.searchParams.get("valueInputOption") ?? "RAW";
        if (!op && method === "GET") return send(200, { range, values: this.read(book, range, true) });
        if (!op && method === "PUT") {
          const updated = this.write(book, range, (body as { values: Cell[][] }).values ?? [], input);
          this.afterPut?.(range);
          this.persist();
          return send(200, { spreadsheetId: bookId, updatedRange: updated });
        }
        if (op === ":append" && method === "POST") {
          const updated = this.append(book, range, (body as { values: Cell[][] }).values ?? [], input);
          this.persist();
          return send(200, { spreadsheetId: bookId, updates: { updatedRange: updated } });
        }
        if (op === ":clear" && method === "POST") {
          this.clearRange(book, range);
          this.persist();
          return send(200, { spreadsheetId: bookId, clearedRange: range });
        }
      }
      return send(404, { error: { code: 404, message: `Unsupported route ${method} ${rest}` } });
    } catch (e) {
      return send(400, { error: { code: 400, message: (e as Error).message } });
    }
  }

  private findSheet(book: FakeSpreadsheet, title: string): FakeSheet {
    const s = book.sheets.find((x) => x.title === title);
    if (!s) throw new Error(`Unable to parse range: ${title}`);
    return s;
  }

  private read(book: FakeSpreadsheet, a1: string, unformatted: boolean): Cell[][] {
    const r = parseRange(a1);
    const s = this.findSheet(book, r.sheet);
    const r0 = (r.startRow ?? 1) - 1;
    const r1 = r.endRow === null ? s.grid.length - 1 : r.endRow - 1;
    const c0 = r.startCol ?? 0;
    const c1 = r.endCol ?? Number.MAX_SAFE_INTEGER;
    const out: Cell[][] = [];
    for (let i = r0; i <= r1 && i < s.grid.length; i++) {
      const row = (s.grid[i] ?? []).slice(c0, c1 + 1).map((v) => (unformatted ? v : String(v)));
      while (row.length && row[row.length - 1] === "") row.pop();
      out.push(row);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out;
  }

  private coerce(v: Cell, input: string): Cell {
    if (input === "RAW") return v; // stored exactly as sent
    if (typeof v !== "string") return v;
    if (v.startsWith("=")) return "#ERROR!"; // a formula would be evaluated
    if (/^[+-]?\d+(\.\d+)?$/.test(v.trim())) return Number(v); // "+336…" becomes a number, losing the "+"
    if (/^(TRUE|FALSE)$/i.test(v)) return v.toUpperCase() === "TRUE";
    return v;
  }

  private write(book: FakeSpreadsheet, a1: string, values: Cell[][], input: string): string {
    const r = parseRange(a1);
    const s = this.findSheet(book, r.sheet);
    const r0 = (r.startRow ?? 1) - 1;
    const c0 = r.startCol ?? 0;
    values.forEach((row, i) => {
      const target = (s.grid[r0 + i] ??= []);
      row.forEach((v, j) => {
        assertCell(v);
        while (target.length < c0 + j) target.push("");
        target[c0 + j] = this.coerce(v, input);
      });
    });
    for (let i = 0; i < s.grid.length; i++) s.grid[i] ??= [];
    return `${r.sheet}!${colLetters(c0)}${r0 + 1}`;
  }

  private append(book: FakeSpreadsheet, a1: string, values: Cell[][], input: string): string {
    const r = parseRange(a1);
    const s = this.findSheet(book, r.sheet);
    let last = s.grid.length;
    while (last > 0 && (s.grid[last - 1] ?? []).every((c) => c === "")) last--;
    s.grid.length = last;
    const start = last + 1;
    for (const row of values) {
      row.forEach(assertCell);
      s.grid.push(row.map((v) => this.coerce(v, input)));
    }
    return `${r.sheet}!A${start}:${colLetters(Math.max(0, ...values.map((v) => v.length)) - 1)}${start + values.length - 1}`;
  }

  private clearRange(book: FakeSpreadsheet, a1: string) {
    const r = parseRange(a1);
    const s = this.findSheet(book, r.sheet);
    const r0 = (r.startRow ?? 1) - 1;
    const r1 = r.endRow === null ? s.grid.length - 1 : r.endRow - 1;
    for (let i = r0; i <= r1 && i < s.grid.length; i++) {
      const row = s.grid[i] ?? [];
      const c0 = r.startCol ?? 0;
      const c1 = r.endCol ?? row.length - 1;
      for (let j = c0; j <= c1 && j < row.length; j++) row[j] = "";
    }
  }

  private structural(book: FakeSpreadsheet, req: StructuralRequest): unknown {
    if (req.addSheet) {
      const title = String(req.addSheet.properties?.title ?? "");
      if (book.sheets.some((s) => s.title === title)) {
        throw new Error(`Invalid requests[0].addSheet: A sheet with the name "${title}" already exists.`);
      }
      const sheet: FakeSheet = { sheetId: this.nextSheetId++, title, grid: [], frozenRowCount: 0, protectedRanges: [] };
      book.sheets.push(sheet);
      return { addSheet: { properties: { sheetId: sheet.sheetId, title } } };
    }
    if (req.updateSheetProperties) {
      const p = req.updateSheetProperties.properties;
      const s = book.sheets.find((x) => x.sheetId === p.sheetId);
      if (!s) throw new Error("No sheet with that id");
      if (p.gridProperties?.frozenRowCount !== undefined) s.frozenRowCount = p.gridProperties.frozenRowCount;
      return {};
    }
    if (req.addProtectedRange) {
      const p = req.addProtectedRange.protectedRange;
      const s = book.sheets.find((x) => x.sheetId === p.range?.sheetId);
      if (!s) throw new Error("No sheet with that id");
      const pr = { protectedRangeId: this.nextProtId++, warningOnly: Boolean(p.warningOnly), description: p.description };
      s.protectedRanges.push(pr);
      return { addProtectedRange: { protectedRange: pr } };
    }
    if (req.repeatCell || req.updateDimensionProperties || req.deleteDimension) return {};
    throw new Error(`Unsupported batchUpdate request: ${Object.keys(req).join(",")}`);
  }
}

interface StructuralRequest {
  addSheet?: { properties?: { title?: string } };
  updateSheetProperties?: { properties: { sheetId: number; gridProperties?: { frozenRowCount?: number } } };
  addProtectedRange?: { protectedRange: { range?: { sheetId?: number }; warningOnly?: boolean; description?: string } };
  repeatCell?: unknown;
  updateDimensionProperties?: unknown;
  deleteDimension?: unknown;
}

function assertCell(v: unknown) {
  if (typeof v === "string" && v.length > 50_000) throw new Error("Your input contains more than the maximum of 50000 characters in a single cell.");
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}
