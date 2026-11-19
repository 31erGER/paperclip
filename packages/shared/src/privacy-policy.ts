/**
 * This fork keeps task data and diagnostics on the instance. Environment
 * variables, saved settings and plugins must not enable external diagnostics.
 * Agent Internet access, model providers and update checks are independent.
 */
export const EXTERNAL_DIAGNOSTICS_ENABLED: boolean = false;

/** Product news is optional background traffic; update checks stay independent. */
export const BACKGROUND_ANNOUNCEMENTS_ENABLED: boolean = false;

/** Loading an external image explicitly remains available. */
export const PASSIVE_REMOTE_IMAGES_ENABLED: boolean = false;
