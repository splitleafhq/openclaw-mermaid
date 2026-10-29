# Verification

What has been checked, and how. Anything not yet seen on a live gateway is marked unverified.

| Claim | Source | Status |
|---|---|---|
| A factory tool with `canDeliverSourceReply: true` and `details.sourceReply { text, mediaUrls }` sends one reply to the source conversation and ends the turn | openclaw 2026.10.8 `docs/plugins/tool-plugins.md` ("Deliver the reply directly"); `dist/builtin-openclaw-*.mjs` reads the flag from the effective tool list | Docs and source; unverified live |
| The PNG shows inline in a Matrix client, in the asking thread | not documented for plugins | Unverified: the first live test |
| A `.txt` from `includeSource: "file"` arrives as a file | not documented for plugins | Unverified: the first live test |
| Files saved with `saveMediaBuffer(..., "outbound")` are under an allowed local media root for every agent, sandboxed or not | openclaw 2026.10.8 `dist/store-*.mjs` (writes under `<state dir>/media/outbound`), `dist/local-roots-*.mjs` (`<state dir>/media` is a default root; the sandbox filter removes only `sandboxes` and `workspace` overlaps); `dist/store-*.mjs` (`outbound` pruned after 24 h) | Source; unverified live |
| A plugin skill loads when the plugin is enabled, gated by `metadata.openclaw.requires.bins`, checked on the host | openclaw 2026.10.8 `docs/tools/skills.md` ("Plugins and skills", `requires.bins`) | Docs. Checked on an isolated state dir: `openclaw skills info mermaid` shows it ready with `mmdc` found. Hiding it without `mmdc` is unverified: OpenClaw still found `mmdc` with a stripped PATH |
| `mmdc` reads stdin and writes PNG to stdout with `-i - -o - -e png` | mermaid-cli 12.0.0 | Checked |
| Mermaid `securityLevel: strict` alone still lets Chrome fetch an `<img>` URL in a label; the two Chrome flags in `assets/puppeteer.json` stop it | mermaid-cli 12.0.0, local HTTP server | Checked: 2 requests without the flags, 0 with them (`test/mmdc.test.ts`) |
| The skill's syntax rules: ids without spaces, reserved ids (`end`, `graph`, `subgraph`, `style`, `class`, `click`), quoted labels for punctuation, `#quot;`, quoted edge labels, and each listed diagram type | mermaid-cli 12.0.0, one render per rule | Checked. Hyphenated ids parse, so the skill doesn't forbid them |
| Mermaid `securityLevel: strict` still lets a label embed a local file (`<img src=/path>`, `<svg><image href>`, CSS `url()`) because mmdc renders from a `file:` page; the `dompurifyConfig` in `assets/mermaid.json` stops all three | mermaid-cli 12.0.0 | Checked: the render with a real file equals the render with a missing one (`test/mmdc.test.ts`); fails without the config |
| The `test` CI job installs mermaid-cli 12.0.0 and runs `test/mmdc.test.ts` on Ubuntu | `.github/workflows/ci.yml` | Unverified until the first CI run |
