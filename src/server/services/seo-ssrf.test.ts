import { afterEach, describe, expect, it, vi } from "vitest";
import { httpFetcher } from "./seo";

describe("site audit fetcher: redirects are checked before they are followed (SSRF, D084)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never requests an internal address a redirect points to", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(u);
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    });
    expect(await httpFetcher("https://www.example.com/")).toMatchObject({ status: 0, text: "" });
    expect(calls).toEqual(["https://www.example.com/"]);
  });

  it("follows a same-host https redirect", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      calls.push(u);
      return u.endsWith("/fr/") ? new Response("<html>ok</html>", { status: 200 }) : new Response(null, { status: 301, headers: { location: "/fr/" } });
    });
    expect(await httpFetcher("https://www.example.com/")).toMatchObject({ status: 200, url: "https://www.example.com/fr/", text: "<html>ok</html>" });
    expect(calls).toHaveLength(2);
  });
});
