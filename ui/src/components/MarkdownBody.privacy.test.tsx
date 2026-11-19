// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../context/ThemeContext";
import { MarkdownBody } from "./MarkdownBody";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => <a href={to} {...props}>{children}</a>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;
let client: QueryClient;

async function renderMarkdown(markdown: string, props: Partial<React.ComponentProps<typeof MarkdownBody>> = {}) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }
  await act(async () => root!.render(
    <QueryClientProvider client={client}>
      <ThemeProvider><MarkdownBody {...props}>{markdown}</MarkdownBody></ThemeProvider>
    </QueryClientProvider>,
  ));
  return container;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  client?.clear();
});

describe("MarkdownBody image privacy", () => {
  it("keeps a remote tracking image inert until its load button is clicked", async () => {
    const url = "https://tracker.invalid/pixel.gif?task=secret";
    const node = await renderMarkdown(`![Evidence](${url})`);
    expect(node.querySelector("img")).toBeNull();
    expect(node.querySelector("a")?.getAttribute("href")).toBe(url);
    expect(node.textContent).toContain("Evidence");

    const button = node.querySelector("button");
    expect(button?.textContent).toContain("Load external image");
    await act(async () => button!.click());
    expect(node.querySelector("img")?.getAttribute("src")).toBe(url);
    expect(node.querySelector("img")?.getAttribute("referrerpolicy")).toBe("no-referrer");

    await renderMarkdown("![Changed](https://tracker.invalid/different.gif)");
    expect(node.querySelector("img")).toBeNull();
  });

  it.each([
    "/api/attachments/local/content",
    "images/local.png",
    "http://localhost:3000/api/attachments/local/content",
    "data:image/png;base64,aGVsbG8=",
    "blob:http://localhost:3000/local-image",
  ])("renders local or embedded images immediately: %s", async (url) => {
    const node = await renderMarkdown(`![Local](${url})`);
    expect(node.querySelector("img")?.getAttribute("src")).toBe(url);
    expect(node.querySelector("button")).toBeNull();
  });

  it("applies the privacy gate after resolving an image URL", async () => {
    const node = await renderMarkdown("![Export](images/local.png)", {
      resolveImageSrc: () => "https://tracker.invalid/resolved.png",
    });
    expect(node.querySelector("img")).toBeNull();
    expect(node.querySelector("a")?.getAttribute("href")).toBe("https://tracker.invalid/resolved.png");
  });

  it("blocks protocol relative tracking images and preserves deliberate external links", async () => {
    const node = await renderMarkdown("![Tracking](//tracker.invalid/pixel.gif)\n\n[Search result](https://example.com/result)");
    expect(node.querySelector("img")).toBeNull();
    expect(node.querySelector('a[href="https://example.com/result"]')?.getAttribute("target")).toBe("_blank");
  });

  it("preserves an image's original wrapping link without nesting interactive controls", async () => {
    const node = await renderMarkdown("[![Build status](https://tracker.invalid/badge.svg)](https://example.com/build)");
    expect(node.querySelector("img")).toBeNull();
    expect(node.querySelectorAll("a")).toHaveLength(1);
    expect(node.querySelector("a")?.getAttribute("href")).toBe("https://example.com/build");
    expect(node.querySelector("button")).toBeNull();
    expect(node.textContent).toContain("Build status");
  });
});
