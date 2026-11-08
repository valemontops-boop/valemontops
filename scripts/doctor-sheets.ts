import { runDoctor } from "../src/data/sheets/doctor";
import { clientFromEnv, fail } from "./_client";

async function main() {
  const { client, target } = clientFromEnv();
  console.log(`Checking ${target}…\n`);
  const checks = await runDoctor(client);
  const icon = { ok: "✓", warn: "!", fail: "✗" } as const;
  for (const c of checks) console.log(`${icon[c.status]} ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => c.status === "fail").length;
  console.log(`\n${failed ? `${failed} check(s) failed.` : "All required checks passed."}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => fail((e as Error).message));
