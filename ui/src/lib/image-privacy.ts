import { PASSIVE_REMOTE_IMAGES_ENABLED } from "@paperclipai/shared/privacy-policy";

/** A remote image request discloses the viewer's address before they interact. */
export function canLoadImagePassively(src: string | null | undefined): boolean {
  if (!src?.trim()) return false;
  if (/^data:image\//i.test(src) || /^blob:/i.test(src)) return true;
  try {
    // Server rendering has no trusted origin for absolute image URLs. Relative
    // assets remain available; browser rendering uses the actual app origin.
    const base = typeof window === "undefined" ? "https://paperclip.invalid/" : window.location.href;
    const url = new URL(src, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (PASSIVE_REMOTE_IMAGES_ENABLED) return true;
    if (typeof window === "undefined" && /^[a-z][a-z\d+.-]*:|^[\\/]{2}/i.test(src.trim())) return false;
    return url.origin === new URL(base).origin;
  } catch {
    return false;
  }
}
