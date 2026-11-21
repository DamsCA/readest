/**
 * What this edition of the app offers.
 *
 * It stands on its own: there is no Readest account, so everything that needs
 * Readest's servers is off — sign-in, cloud sync and storage, shared links,
 * "Send to Readest" by e-mail, the online metadata search, Readest's
 * purchases and its usage statistics. The reader, the local library,
 * translation and the voice do not need them and stay.
 *
 * One switch, so a backend of our own can bring these back in one place.
 */
export const READEST_CLOUD_ENABLED = false;

/** Usage statistics go to Readest's PostHog only when the cloud is on. */
export const TELEMETRY_ENABLED = READEST_CLOUD_ENABLED;

/**
 * The voice that reads first. Fish Audio's free model is meant for personal
 * use, so a voice sold on the stores cannot lean on it: this edition reads with
 * Edge's voices (or the phone's own) by default, and Fish stays one tap away in
 * the voice menu wherever the relay is set up. Turn this on with a paid Fish
 * plan behind the subscription.
 */
export const FISH_VOICE_BY_DEFAULT = false;
