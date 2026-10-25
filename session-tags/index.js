/**
 * Host half of the session-tags bundle.
 *
 * The bundle exists for its Client half: it marks sidebar Session rows with
 * front-end-only tags and renders a tag tree in the right Sidebar. Tags live in
 * the browser's localStorage, so this row only has to resolve for the profile
 * patch to apply — nothing is written to the Host.
 */
export function apply() {}
