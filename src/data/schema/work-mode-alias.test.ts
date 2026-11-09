import { describe, expect, it } from "vitest";
import { tableSchema } from "./tables";
import { normalizeWorkMode } from "@/domain/constants";

describe("work mode rename (brief round 8)", () => {
  it("reads rows written with the old names as the new modes, in every table holding a mode", () => {
    for (const table of ["WorkModes", "DailyTargets", "DailyPlans"] as const) {
      const mode = tableSchema(table).shape.mode;
      expect(mode.parse("JOB_SEARCHING")).toBe("FULL_TIME");
      expect(mode.parse(" EMPLOYED_35H ")).toBe("REDUCED");
      expect(mode.parse("FULL_TIME")).toBe("FULL_TIME");
      expect(mode.parse("LAUNCH_SPRINT")).toBe("LAUNCH_SPRINT");
      expect(() => mode.parse("SOMETHING_ELSE")).toThrow();
    }
    expect(normalizeWorkMode("EMPLOYED_35H")).toBe("REDUCED");
  });
});
