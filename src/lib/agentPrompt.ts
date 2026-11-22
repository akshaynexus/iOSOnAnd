/**
 * src/lib/agentPrompt.ts: the prompt a maintainer pastes into their coding
 * agent to claim and manage a repo on the tracker. The text is fixed by
 * contract-v2 ("The AI prompt"); the docs page "Maintain a repo" shows the
 * same text. `site` is the tracker's origin (window.location.origin in the UI).
 */

export interface AgentPromptInput {
  site: string;
  /** OWNER/REPO; left as a placeholder when missing. */
  repo?: string;
  /** Device slug; adds ", phone: DEVICE" and fills --device. */
  device?: string;
}

export function agentPrompt({ site, repo, device }: AgentPromptInput): string {
  const SITE = site.replace(/\/+$/, "");
  const REPO = repo?.trim() || "<OWNER/REPO>";
  const DEVICE = device?.trim() || "<device>";
  const phone = device?.trim() ? `, phone: ${device.trim()}` : "";
  return [
    `I maintain an iOS-on-Android port and want to manage it on the iOSOnAnd tracker at ${SITE}.`,
    `Repo: ${REPO}${phone}`,
    ``,
    `1. Get the tracker CLI (Node 18+, no install): curl -fsSLo cli.mjs ${SITE}/cli.mjs`,
    `2. Sign in with my GitHub account (needs the gh CLI, logged in): TRACKER_URL=${SITE} node cli.mjs login`,
    `3. Claim the repo: node cli.mjs repo-claim ${REPO} --device ${DEVICE}`,
    `   If it prints a verification code, write that code alone to .iosonand-verify on the repo's default branch, push, run node cli.mjs repo-verify <claim id>, then delete the file.`,
    `4. Read the repo (README, issues, recent commits) and record what works on the phone, one area at a time:`,
    `   node cli.mjs areas`,
    `   node cli.mjs status-set ${DEVICE} <area> works|in-progress|broken --detail "<what I can show>" --source "<link>"`,
    `   Only claim what the repo or I can show. Ask me when unsure.`,
    `5. Attach proof when I give you screenshots or clips: node cli.mjs media-upload <file> --device ${DEVICE} --area <area> --caption "..."`,
    `6. Check the result: node cli.mjs whoami`,
  ].join("\n");
}
