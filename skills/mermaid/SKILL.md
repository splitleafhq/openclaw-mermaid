---
name: mermaid
description: Draw diagrams and charts (flowcharts, sequence, state, class, ER, Gantt, pie, timelines) as images with render_mermaid, and send their source with send_mermaid_source.
metadata:
  {
    "openclaw":
      {
        "emoji": "📈",
        "requires": { "bins": ["mmdc"] },
        "install": [{ "id": "brew", "kind": "brew", "formula": "mermaid-cli", "bins": ["mmdc"], "label": "Install mermaid-cli (brew)" }],
      },
  }
---

# Mermaid diagrams

When a diagram or chart would help, write it in Mermaid and call `render_mermaid`. It sends the PNG to the conversation, then your caption as your reply. Don't paste a Mermaid code block, write HTML or SVG, or describe an image you haven't sent.

- `source`: the Mermaid text, without a ```mermaid fence.
- `caption`: what you'd say with the picture. The call ends your turn, so put everything you want to say here.
- `name`: a few words for the file names.
- `attachSource`: `true` only when the same message asks for the diagram and its source. The source arrives as a `.txt` file after the image.

When the user asks for the source of a diagram you already sent, call `send_mermaid_source` with the `.mmd` path `render_mermaid` returned, and a `caption`. It sends the `.txt` alone; the image isn't sent again. Never paste the source into your message.

Every render keeps the `.mmd` and `.png`; the result gives their paths, so you can edit the `.mmd` and render it again later.

## Pick a type

| Need | Start with |
| --- | --- |
| Steps, decisions, architecture | `flowchart LR` or `flowchart TD` |
| Messages between parts over time | `sequenceDiagram` |
| States and transitions | `stateDiagram-v2` |
| Data model | `erDiagram` or `classDiagram` |
| Schedule | `gantt` |
| Shares of a whole | `pie` |
| Events in order | `timeline` |
| Numbers over a series | `xychart-beta` |

## Syntax that avoids parse errors

- Node ids have no spaces (`api_gateway`, not `API Gateway`). Put the visible text in a label: `api_gateway["API gateway"]`.
- Quote any label with punctuation: `a["Save (draft)"]`. Use `#quot;` for a double quote inside a label.
- Avoid reserved words as ids: `end`, `graph`, `subgraph`, `style`, `class`, `click`. Use `done` or `end_step` instead of `end`.
- Edge labels: `a -->|"yes"| b`.
- Subgraphs: `subgraph billing["Billing"]` ... `end`.
- No links, images, HTML styles or `click` lines: the renderer has no network and strips them.

On a syntax error, `render_mermaid` returns the parser's message with the line. Fix that line and call again.
