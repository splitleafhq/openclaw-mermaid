import { isAbsolute, join, relative } from 'node:path';
import { saveMediaBuffer } from 'openclaw/plugin-sdk/media-store';
import { type OpenClawPluginApi, definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { textResult } from 'openclaw/plugin-sdk/tool-results';
import { type Static, Type } from 'typebox';
import { PLUGIN_ID, resolveConfig } from './config.ts';
import { MAX_PNG_BYTES, renderPng } from './render.ts';
import { saveDiagram } from './save.ts';

type Api = OpenClawPluginApi;

/** The parts of OpenClaw's plugin API this plugin uses. `register` passes OpenClaw's own, and tests pass a stand-in. */
export interface PluginHost {
  pluginConfig?: Api['pluginConfig'];
  logger?: Partial<Pick<Api['logger'], 'warn'>>;
  registerTool: Api['registerTool'];
}

const TOOL = 'render_mermaid';

const PARAMETERS = Type.Object({
  source: Type.String({ description: 'Mermaid source, without a ```mermaid fence.' }),
  name: Type.Optional(Type.String({ description: 'A few words that name the files, such as "login flow".' })),
  caption: Type.Optional(
    Type.String({ description: 'The message sent with the image, in your own words. The image ends your turn: write nothing after this call.' }),
  ),
  includeSource: Type.Optional(
    Type.Union([Type.Literal('none'), Type.Literal('inline'), Type.Literal('file')], {
      description: 'Also send the Mermaid source: "inline" as a code block, "file" as a .txt attachment. Only when the user asks for it. Default "none".',
    }),
  ),
});

type Params = Static<typeof PARAMETERS>;

const FENCE = /^\s*```(?:mermaid)?[^\S\n]*\n([\s\S]*?)\n```\s*$/;

/** Models often wrap the source in a fence despite the description; mermaid-cli can't parse one. */
export function unfence(source: string): string {
  return FENCE.exec(source)?.[1] ?? source;
}

function fail(message: string) {
  return textResult(`${TOOL} failed: ${message}`, { status: 'failed' });
}

/** A path inside the workspace is shown relative to it, so a sandboxed agent can read it at the same place. */
function shown(path: string, workspaceDir: string | undefined): string {
  if (workspaceDir === undefined) {
    return path;
  }
  const rel = relative(workspaceDir, path);
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

export function registerMermaid(api: PluginHost): void {
  const config = resolveConfig(api.pluginConfig);
  const warn = (message: string) => api.logger?.warn?.(`[${PLUGIN_ID}] ${message}`);

  api.registerTool(
    (ctx) => {
      const { workspaceDir } = ctx;
      const configured = config.saveDir;
      let saveDir: string | undefined;
      if (configured !== undefined && isAbsolute(configured)) {
        saveDir = configured;
      } else if (workspaceDir !== undefined) {
        saveDir = join(workspaceDir, configured ?? join('out', 'diagrams'));
      }
      if (saveDir === undefined) {
        warn('no saveDir and no agent workspace: render_mermaid is not offered');
        return null;
      }
      const dir = saveDir;
      return {
        name: TOOL,
        label: 'Render Mermaid',
        description:
          'Draw a diagram or chart: renders Mermaid source to a PNG and sends it to this conversation as your reply. Saves the .mmd and .png and returns their paths. On a syntax error, fix the source and call again.',
        parameters: PARAMETERS,
        canDeliverSourceReply: true,
        catalogMode: 'direct-only',
        async execute(_id: string, params: Params, signal?: AbortSignal) {
          const source = unfence(params.source);
          if (source.trim() === '') {
            return fail('source is empty');
          }
          if (source.length > config.maxSourceChars) {
            return fail(`source is ${source.length} characters; the limit is ${config.maxSourceChars}`);
          }
          const rendered = await renderPng(source, { timeoutMs: config.timeoutMs, signal });
          if (!rendered.ok) {
            return fail(rendered.message);
          }
          const saved = await saveDiagram(dir, params.name ?? '', source, rendered.png);
          if (!saved.ok) {
            warn(`save failed: ${saved.message}`);
            return fail(saved.message);
          }
          const includeSource = params.includeSource ?? 'none';
          try {
            const media = [(await saveMediaBuffer(rendered.png, 'image/png', 'outbound', MAX_PNG_BYTES, `${saved.base}.png`)).path];
            if (includeSource === 'file') {
              media.push((await saveMediaBuffer(Buffer.from(source), 'text/plain', 'outbound', MAX_PNG_BYTES, `${saved.base}.txt`)).path);
            }
            const parts = [params.caption?.trim() ?? ''];
            if (includeSource === 'inline') {
              parts.push(`\`\`\`mermaid\n${source}\n\`\`\``);
            }
            const mmd = shown(saved.mmdPath, workspaceDir);
            const png = shown(saved.pngPath, workspaceDir);
            return textResult(`Sent the diagram. Saved ${mmd} and ${png}.`, {
              status: 'sent',
              mmd,
              png,
              sourceReply: { text: parts.filter((p) => p !== '').join('\n\n'), mediaUrls: media },
            });
          } catch (error) {
            warn(`staging failed: ${error instanceof Error ? error.message : String(error)}`);
            return fail('the image could not be staged for sending');
          }
        },
      };
    },
    { name: TOOL, optional: true },
  );
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: 'Mermaid',
  description: 'Renders Mermaid diagrams to PNG and sends them to the conversation.',
  register: registerMermaid,
});
