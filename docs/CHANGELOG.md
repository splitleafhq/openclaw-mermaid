# Changelog

## 0.4.0

- **One captioned image:** with `textPosition: "after"` (the default) the PNG, any `.txt`, and the caption go back together as the reply, so the channel sends the image with the caption on it, then the `.txt`. On Matrix in progress mode this needs OpenClaw with openclaw#188018 (in 2026.11.10); before it, the caption arrived above the image as the edited progress draft. `send_mermaid_source` returns its `.txt` the same way. `textPosition: "before"` is unchanged.
- A missing browser is reported as a host error and logged, not as a syntax error (#33).

## 0.3.0

- **`send_mermaid_source`:** sends the source of a diagram already sent, as a `.txt` alone. The image isn't sent again. It takes the `.mmd` path `render_mermaid` returned and accepts only a name the plugin created in `saveDir`.
- `attachSource` on `render_mermaid` is for a request that asks for the diagram and its source together.

## 0.2.0

- **Image first, then the caption:** the PNG goes out on its own through `toolContext.delivery.send`, and the caption follows as the reply. On Matrix in progress mode the reply text used to arrive first, as the edited draft, with the image after it.
- **Source as a file only:** `includeSource` (`none` | `inline` | `file`) is replaced by `attachSource` (boolean). The source is never sent inline.
- `caption` is required.
- **Config:** `source` (`onRequest` | `always`) and `textPosition` (`after` | `before`).

## 0.1.0

First version, built and tested against OpenClaw 2026.10.8 and mermaid-cli 12.0.0.

- **`render_mermaid`:** renders Mermaid to PNG with `mmdc`, keeps the `.mmd` and `.png` in `saveDir`, and sends the PNG with the agent's caption as the reply (`canDeliverSourceReply`). The source goes along only when asked, inline or as `.txt`.
- **Network:** Chrome resolves no host names during a render; a timeout stops mmdc and Chrome.
- **Skill `mermaid`:** when to draw, which diagram type, and syntax that avoids parse errors. Shown only when `mmdc` is on PATH.
