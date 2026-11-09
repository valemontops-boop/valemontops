import { afterEach, describe, expect, it } from "vitest";
import { InMemoryRepository } from "@/data/memory";
import { seedBaseline, settingsFromEnv } from "@/server/services/baseline";

const TZ = { theo: "Europe/Paris", pablo: "Europe/Madrid" };
afterEach(() => { delete process.env.SETTING_CALENDLY_URL_THEO; delete process.env.SETTING_DECK_URL_FR; });

describe("settings from the hosting environment (SETTING_<KEY>)", () => {
  it("parses only SETTING_ keys with a value", () => {
    expect(settingsFromEnv({ SETTING_CALENDLY_URL_THEO: " https://example.com/c ", SETTING_EMPTY: "", OTHER: "x" })).toEqual([{ key: "calendly_url_theo", value: "https://example.com/c" }]);
  });

  it("fills a missing setting once and never overwrites a founder's edit", async () => {
    const repo = new InMemoryRepository();
    process.env.SETTING_CALENDLY_URL_THEO = "https://example.com/theo/15min";
    await seedBaseline(repo, TZ);
    const row = (await repo.list("SystemSettings")).rows.find((r) => r.key === "calendly_url_theo")!;
    expect(row.value).toBe("https://example.com/theo/15min");
    await repo.update("SystemSettings", row.id, row.version, { value: "https://example.com/edited" }, { founder: "theo", writeId: "w" } as never);
    process.env.SETTING_CALENDLY_URL_THEO = "https://example.com/other";
    await seedBaseline(repo, TZ);
    const after = (await repo.list("SystemSettings")).rows.filter((r) => r.key === "calendly_url_theo" && !r.is_archived);
    expect(after).toHaveLength(1);
    expect(after[0].value).toBe("https://example.com/edited");
  });
});
