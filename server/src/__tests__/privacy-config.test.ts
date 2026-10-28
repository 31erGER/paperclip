import { afterEach, expect, it, vi } from "vitest";
import { loadConfig } from "../config.js";
import { announcementFeedService } from "../services/announcement-feed.js";

afterEach(() => vi.unstubAllEnvs());

it("does not fetch the product-news feed even if an inherited variable requests it", async () => {
  vi.stubEnv("PAPERCLIP_ANNOUNCEMENTS_ENABLED", "true");
  vi.stubEnv("PAPERCLIP_ANNOUNCEMENTS_FEED_URL", "https://tracking.example/news.json");
  const config = loadConfig();
  const fetch = vi.fn();
  const feed = announcementFeedService({ enabled: config.announcementsEnabled, feedUrl: config.announcementsFeedUrl, version: "1.0.0", fetch });
  expect(config.telemetryEnabled).toBe(false);
  expect(await feed.current()).toBeNull();
  expect(await feed.image("remote")).toBeNull();
  expect(await feed.animation("remote")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
