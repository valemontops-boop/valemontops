// Builds the static feedback preview: one HTML file with inlined JS and CSS (no server, no network).
import { build } from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = process.argv[2] ?? path.join(root, "preview/dist/valemont-os-preview.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
const shim = (p) => path.join(root, "preview/shims", p);

const js = await build({
  entryPoints: [path.join(root, "preview/main.tsx")],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "next/link": shim("link.tsx"),
    "next/navigation": shim("navigation.ts"),
    "node:crypto": shim("crypto.ts"),
    "server-only": shim("empty.ts"),
    exceljs: shim("no-excel.ts"),
    xlsx: shim("no-excel.ts"),
  },
  tsconfig: path.join(root, "tsconfig.json"),
  logLevel: "warning",
});
const css = execSync(`npx @tailwindcss/cli -i src/app/globals.css --minify`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const script = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = `<title>Valemont OS</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root { --font-geist-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; --font-geist-mono: "Geist Mono", ui-monospace, monospace; }
${css}
/* Single light theme by design (DESIGN.md); background set explicitly for any host theme. */
:root { color-scheme: light; }
body { background: #f1f0ec; color: #17161a; padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px); }
</style>
<div id="root"><p style="padding:24px;font-family:system-ui;color:#57545c">Loading Valemont OS preview…</p></div>
<script>${script}</script>
`;
fs.writeFileSync(out, html);
console.log(`${out} ${(html.length / 1024).toFixed(0)} KB`);
