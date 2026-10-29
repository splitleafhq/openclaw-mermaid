# openclaw-mermaid

An [OpenClaw](https://docs.openclaw.ai) plugin (id `mermaid`) that lets an agent draw diagrams. The agent writes Mermaid; **`render_mermaid`** renders it to a PNG with [mermaid-cli](https://github.com/mermaid-js/mermaid-cli) on the gateway host and sends the image to the conversation. A bundled `mermaid` skill tells the agent when and how to use it.

**Status:** built and unit-tested against OpenClaw 2026.10.8 and mermaid-cli 12.0.0. Not published. What a live gateway still has to confirm is in [docs/verification.md](docs/verification.md).

## What it does

`render_mermaid({ source, caption, name?, attachSource? })`:

1. Renders `source` to PNG with `mmdc`, in the gateway process, so sandboxed and unsandboxed agents behave the same.
2. Keeps `<stamp>-<hex>-<name>.mmd` and `.png` in `saveDir`, and returns their paths. A path inside the agent workspace is returned relative to it.
3. Sends the PNG on its own through the host's delivery helper (`toolContext.delivery.send`, `docs/plugins/tool-plugins.md`, "Optional and factory tools"), then `caption` as the agent's reply through `details.sourceReply` ("Deliver the reply directly"). The reply ends the turn.
4. Sends the source only when asked in the same message: `attachSource: true` sends it as a `.txt` file right after the image. Never inline.

`send_mermaid_source({ file, caption? })` sends the source of a diagram already sent, as a `.txt` on its own, without the image. `file` is the `.mmd` path `render_mermaid` returned; only a name the plugin created in `saveDir` is accepted, read through OpenClaw's `root().readText`.

Without the delivery helper (a channel whose delivery a Gateway transport owns), the PNG and `.txt` go in the reply with the caption, and the channel decides their order.

On Matrix with `streaming.mode` `progress`, OpenClaw 2026.10.8 edits the progress draft into the reply text and sends any media in the reply as a separate event without a caption (`extensions/matrix/src/matrix/monitor/handler-reply-dispatcher.ts`, `buildSupplementalPayload`). Sending the image first through the helper keeps it above the text. One message holding the image, the `.txt` and the caption needs an outbound gallery, which the Matrix plugin doesn't send yet.

A parse error comes back as an error result with mermaid-cli's message and line, so the agent can fix the source and call again. Nothing is sent or saved.

### Network

mermaid-cli renders in headless Chrome from a `file:` page. Even with Mermaid's `securityLevel: strict`, a label can fetch an image URL or embed a local file. `assets/puppeteer.json` starts Chrome with `--host-resolver-rules=MAP * ~NOTFOUND` and `--disable-background-networking`, and `assets/mermaid.json` sets DOMPurify to drop the tags and attributes that load files (`img`, `image`, `src`, `href`, `style` and similar). `test/mmdc.test.ts` checks both: a local server gets no request, and a real file path renders the same as a missing one. Each render has a timeout, and stopping it stops Chrome too.

## Install

Needs `mmdc` on the gateway's PATH (`brew install mermaid-cli`, or `npm install -g @mermaid-js/mermaid-cli`). The skill is hidden while it's missing (`requires.bins`).

Pinned to a tag or commit of a clone, with the gateway owner's approval:

```sh
openclaw plugins install git:file:///path/to/openclaw-mermaid@<tag or commit> --force --accept-capabilities
openclaw plugins inspect mermaid --runtime --json
```

OpenClaw loads the committed `dist/` through `openclaw.runtimeExtensions`; an install runs npm without scripts, so nothing is built then.

Both tools are optional, so allow them per agent. A sandboxed agent also needs it in the sandbox list:

```json5
{
  plugins: {
    entries: {
      mermaid: { enabled: true, config: { saveDir: "out/diagrams" } },
    },
  },
  agents: {
    entries: {
      main: {
        tools: {
          alsoAllow: ["...existing entries", "render_mermaid", "send_mermaid_source"],
          sandbox: { tools: { alsoAllow: ["...existing entries", "render_mermaid", "send_mermaid_source"] } },
        },
      },
    },
  },
}
```

## Configuration

| Key | Default | What |
| --- | --- | --- |
| `saveDir` | `out/diagrams` in the agent workspace | Where each `.mmd` and `.png` is kept. Absolute, or relative to the agent workspace |
| `timeoutMs` | `20000` | Longest a render may run |
| `maxSourceChars` | `20000` | Longest source accepted |
| `source` | `onRequest` | `onRequest`: the source goes as a `.txt` only when the agent is asked. `always`: a `.txt` with every diagram |
| `textPosition` | `after` | `after`: the image (and `.txt`), then the agent's text. `before`: the text, then the image (and `.txt`) as the reply |

The attached copy is staged in OpenClaw's media store (`<state dir>/media/outbound`, pruned after a day), which every channel may send from; `saveDir` can be anywhere.

## Development

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md). [docs/verification.md](docs/verification.md), [docs/CHANGELOG.md](docs/CHANGELOG.md).
