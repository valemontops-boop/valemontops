import { describe, expect, it } from "vitest";
import { translate } from "./index";

describe("i18n", () => {
  it("translates exact keys with placeholders into French and Spanish", () => {
    expect(translate("fr", "{n} left in list", { n: 3 })).toBe("3 restants dans la liste");
    expect(translate("es", "Send the deck")).toBe("Enviar la presentación");
  });
  it("matches server sentences against pattern keys and translates the captured label", () => {
    expect(translate("fr", "No answer on 2026-11-02")).toMatch(/2026-11-02/);
    expect(translate("fr", "No answer on 2026-11-02")).not.toMatch(/No answer/);
    expect(translate("es", "3 min ago")).not.toMatch(/ago/);
  });
  it("never rewrites free text typed by a founder through a UI key", () => {
    expect(translate("fr", "Call back after 5pm")).toBe("Call back after 5pm");
    expect(translate("es", "Send demo video")).toBe("Send demo video");
  });
  it("leaves user data and unknown text untouched", () => {
    expect(translate("fr", "Plomberie Duval (demo)")).toBe("Plomberie Duval (demo)");
    expect(translate("es", "")).toBe("");
  });
});
