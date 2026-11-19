// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ loaded: vi.fn(), init: vi.fn(), captureException: vi.fn() }));

vi.mock("@sentry/browser", () => {
  sdk.loaded();
  return {
    init: sdk.init,
    captureException: sdk.captureException,
    getClient: () => undefined,
    getCurrentScope: () => ({ setClient: () => {} }),
  };
});

describe("browser diagnostics privacy policy", () => {
  it("never loads the SDK for a stale session DSN or a captured task error", async () => {
    const { initBrowserErrorMonitoring, captureBrowserException, teardownBrowserErrorMonitoring } = await import("./sentry");

    await initBrowserErrorMonitoring("https://public@o0.ingest.sentry.io/1", "production");
    captureBrowserException(new Error("private task content"), { boundary: "route" });
    await teardownBrowserErrorMonitoring();

    expect(sdk.loaded).not.toHaveBeenCalled();
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });
});
