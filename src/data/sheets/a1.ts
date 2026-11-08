/** Minimal A1 notation helpers shared by the adapter and the fake server. */

export function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/** 0-based column index -> letters (0 -> A, 26 -> AA). */
export function colLetters(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function lettersToCol(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface ParsedRange {
  sheet: string;
  startCol: number | null; // 0-based
  startRow: number | null; // 1-based
  endCol: number | null;
  endRow: number | null;
}

/** Parses `'My Tab'!A1:C`, `Tab!2:2`, `Tab!A:A`, `Tab` . */
export function parseRange(input: string): ParsedRange {
  let sheet: string;
  let rest = "";
  if (input.startsWith("'")) {
    let i = 1;
    let name = "";
    while (i < input.length) {
      if (input[i] === "'" && input[i + 1] === "'") {
        name += "'";
        i += 2;
      } else if (input[i] === "'") {
        i++;
        break;
      } else {
        name += input[i++];
      }
    }
    sheet = name;
    rest = input.slice(i).replace(/^!/, "");
  } else {
    const bang = input.indexOf("!");
    sheet = bang < 0 ? input : input.slice(0, bang);
    rest = bang < 0 ? "" : input.slice(bang + 1);
  }
  if (!rest) return { sheet, startCol: null, startRow: null, endCol: null, endRow: null };
  const [a, b] = rest.split(":");
  const pa = parseCell(a);
  const pb = b === undefined ? pa : parseCell(b);
  return { sheet, startCol: pa.col, startRow: pa.row, endCol: pb.col, endRow: pb.row };
}

function parseCell(ref: string): { col: number | null; row: number | null } {
  const m = /^([A-Za-z]*)(\d*)$/.exec(ref.trim());
  if (!m) throw new Error(`Bad A1 reference: ${ref}`);
  return { col: m[1] ? lettersToCol(m[1]) : null, row: m[2] ? Number(m[2]) : null };
}
