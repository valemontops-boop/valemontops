import { describe, expect, it } from "vitest";
import { formatE164, normalizeWhatsApp, whatsappChatUrl } from "./whatsapp";

const e164 = (raw: string, market?: "FR" | "ES" | null) => { const n = normalizeWhatsApp(raw, market); return n.ok ? n.e164 : n.error; };

describe("WhatsApp numbers (D090)", () => {
  it("normalises French formats to +33", () => {
    expect(e164("06 12 34 56 78")).toBe("+33612345678");
    expect(e164("07.12.34.56.78")).toBe("+33712345678");
    expect(e164("01 23 45 67 89")).toBe("+33123456789");
    expect(e164("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(e164("+33 (0)6 12 34 56 78")).toBe("+33612345678");
    expect(e164("0033 6 12 34 56 78")).toBe("+33612345678");
    expect(e164("33612345678")).toBe("+33612345678");
  });
  it("normalises Spanish formats to +34", () => {
    expect(e164("612 345 678")).toBe("+34612345678");
    expect(e164("612345678", "ES")).toBe("+34612345678");
    expect(e164("+34 612 34 56 78")).toBe("+34612345678");
    expect(e164("0034 612 345 678")).toBe("+34612345678");
    expect(e164("34612345678")).toBe("+34612345678");
    expect(e164("912 345 678")).toBe("+34912345678");
  });
  it("reads a bare 6/7 number as French for a French prospect (the 0 was dropped)", () => {
    expect(e164("612345678", "FR")).toBe("+33612345678");
    expect(e164("912345678", "FR")).toBe("+34912345678");
  });
  it("keeps other international numbers and refuses what is not a number", () => {
    expect(e164("+44 7700 900123")).toBe("+447700900123");
    expect(e164("")).toBe("empty");
    expect(e164("   ")).toBe("empty");
    expect(e164("06 12 34")).toBe("invalid");
    expect(e164("+33 6 12 34 56 7")).toBe("invalid");
    expect(e164("+34 512 345 678")).toBe("invalid");
    expect(e164("abc")).toBe("invalid");
    expect(e164("+0 123")).toBe("invalid");
  });
  it("reads numbers back and opens a new chat with the text, Web on a computer, the app on a phone", () => {
    expect(formatE164("+33612345678")).toBe("+33 6 12 34 56 78");
    expect(formatE164("+34612345678")).toBe("+34 612 345 678");
    expect(whatsappChatUrl("+33612345678", "Bonjour à vous", false)).toBe("https://web.whatsapp.com/send?phone=33612345678&text=Bonjour%20%C3%A0%20vous");
    expect(whatsappChatUrl("+34612345678", "Hola", true)).toBe("https://wa.me/34612345678?text=Hola");
  });
});
