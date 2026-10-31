/**
 * Host half of the rightbar-width bundle.
 *
 * The work happens in the Client half: it persists both panel widths — the left
 * sidebar (host default 280, clamped 264–420) and the right panel (host default
 * 45% of the frame) — because the host keeps panel geometry transient and resets
 * it on every reload. This entry only has to resolve so the profile patch applies.
 */
export function apply() {}
