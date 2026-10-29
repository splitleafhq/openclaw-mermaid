# AGENTS.md

Rules for working in this repo.

1. Fail open: `render_mermaid` returns an error result and never throws.
2. `render_mermaid` takes no path from the caller. File names are built in code, created through OpenClaw's `root().create` (exclusive, atomic), and written only under `saveDir`.
3. mermaid-cli runs with `assets/mermaid.json` (`securityLevel: strict`) and `assets/puppeteer.json` (no host resolves). Don't loosen either without a test that shows the diagram still can't reach the network.
4. Follow OpenClaw's own conventions for names and locations (camelCase keys with unit suffixes, the media store for staged attachments).
5. Keep everything setup-agnostic: no usernames, hostnames, paths, room or chat ids or persona names from any real setup, in code, tests, docs, commits, issues or pull requests. Say "the assistant".
6. Build fixtures from synthetic content; test names and characters come from R.A. Salvatore's books.
7. Ship a fix with a test you have watched fail without it.
8. Name a test for the failure it prevents.
9. Cite the OpenClaw version, and a docs page or source file, for any claim about OpenClaw behaviour, and label anything not yet checked on a live gateway as unverified in `docs/verification.md`.
10. Pin every tool and action to an exact version or commit.
11. Keep runtime dependencies to `typebox`, pinned to the version OpenClaw's plugin docs show; otherwise import only `node:` built-ins and `openclaw/plugin-sdk/*`. Use OpenClaw's helper where one exists.
12. A comment states a constraint the code can't show, never what the next line does.
13. Write terse, factual prose.
14. Commit on the user's behalf; pushing, merging, tagging, releasing and installing each need their own approval.
15. Keep agent-session links and session trailers out of commit messages, issues and pull request bodies.
