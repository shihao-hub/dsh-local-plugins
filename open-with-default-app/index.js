/**
 * Host half of the open-with-default-app bundle.
 *
 * The bundle exists for its Client half: a visible 「用默认应用打开」 button on the
 * files the conversation shows, wired to the Host's existing session remote
 * (`session.openWorkspacePath`) and to the deliverables route the card owner
 * already authorizes. Nothing runs on the Host side — the entry only has to
 * resolve so the profile patch applies and the client bundle enters the boot
 * graph.
 */
export function apply() {}
