// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SkillCardIcon } from "./SkillCardIcon";
import { AppLogo } from "@/pages/apps/AppLogo";

vi.mock("@/lib/app-brand-assets", () => ({ loadLocalAppBrandAssets: async () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });

it.each(["https://tracker.invalid/icon.svg", "//tracker.invalid/icon.svg"])("uses a skill initial instead of a passive remote icon: %s", async (iconUrl) => {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root!.render(<SkillCardIcon card={{ key: "skill", name: "Skill", iconUrl, color: null }} />));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe("S");
});

it("retains a local skill icon", async () => {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root!.render(<SkillCardIcon card={{ key: "skill", name: "Skill", iconUrl: "/api/assets/icon.svg", color: null }} />));
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/assets/icon.svg");
});

it("blocks both remote logo variants even when a caller allows remote fallback", async () => {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root!.render(<AppLogo name="Custom" allowRemoteFallback logoUrl="https://tracker.invalid/light.svg" darkLogoUrl="https://tracker.invalid/dark.svg" />));
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toBe("C");
});
