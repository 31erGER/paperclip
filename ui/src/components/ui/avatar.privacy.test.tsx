// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
});

async function renderAvatar(src: string, srcSet?: string) {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root!.render(
    <Avatar><AvatarImage src={src} srcSet={srcSet} alt="Jane Example" /><AvatarFallback>JE</AvatarFallback></Avatar>,
  ));
  return container;
}

describe("shared avatar privacy boundary", () => {
  it.each([
    "https://tracker.invalid/avatar.png",
    "//tracker.invalid/avatar.png",
    "\\\\tracker.invalid/avatar.png",
  ])("keeps initials without letting Radix preload a remote image: %s", async (src) => {
    const imageSource = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    const container = await renderAvatar(src);
    expect(imageSource).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("JE");
  });

  it.each([
    "/api/assets/avatar.png",
    "images/avatar.png",
    "http://localhost:3000/api/assets/avatar.png",
    "data:image/png;base64,aGVsbG8=",
    "blob:http://localhost:3000/local-avatar",
  ])("allows Radix to load local or embedded avatars: %s", async (src) => {
    const imageSource = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    await renderAvatar(src);
    expect(imageSource).toHaveBeenCalledWith(src);
  });

  it("uses the local primary image without forwarding remote responsive candidates", async () => {
    const imageSource = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    const container = await renderAvatar("/api/assets/avatar.png", "https://tracker.invalid/avatar.png 2x");
    // Radix preloads through Image before mounting its img. Complete that real
    // boundary so this assertion also covers the eventual browser srcset.
    const image = imageSource.mock.contexts[0] as HTMLImageElement;
    Object.defineProperties(image, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 24 },
    });
    await act(async () => image.dispatchEvent(new Event("load")));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/api/assets/avatar.png");
    expect(container.querySelector("img")?.getAttribute("srcset")).toBeNull();
  });
});
