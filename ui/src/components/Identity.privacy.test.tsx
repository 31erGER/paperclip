// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Identity } from "./Identity";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.restoreAllMocks());

describe("human avatar privacy", () => {
  it.each(["https://tracker.invalid/avatar.png", "//tracker.invalid/avatar.png", "\\\\tracker.invalid/avatar.png"])("uses initials without requesting an external avatar: %s", async (avatarUrl) => {
    const imageSource = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Identity name="Jane Example" avatarUrl={avatarUrl} />));
      expect(imageSource).not.toHaveBeenCalled();
      expect(container.textContent).toContain("JE");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("keeps local uploaded avatars available", async () => {
    const imageSource = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(<Identity name="Jane Example" avatarUrl="/api/assets/avatar.png" />));
      expect(imageSource).toHaveBeenCalledWith("/api/assets/avatar.png");
    } finally {
      await act(async () => root.unmount());
    }
  });
});
