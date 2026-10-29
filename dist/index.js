import { isAbsolute, join, relative } from 'node:path';
import { saveMediaBuffer } from 'openclaw/plugin-sdk/media-store';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { textResult } from 'openclaw/plugin-sdk/tool-results';
import { Type } from 'typebox';
import { PLUGIN_ID, resolveConfig } from './config.js';
import { MAX_PNG_BYTES, renderPng } from './render.js';
import { saveDiagram } from './save.js';
const TOOL = 'render_mermaid';
const PARAMETERS = Type.Object({
    source: Type.String({ description: 'Mermaid source, without a ```mermaid fence.' }),
    caption: Type.String({
        description: 'Your message about the diagram, in your own words. It is sent right after the image and ends your turn: write nothing after this call.',
    }),
    name: Type.Optional(Type.String({ description: 'A few words that name the files, such as "login flow".' })),
    attachSource: Type.Optional(Type.Boolean({ description: 'Also send the Mermaid source as a .txt file. Only when the user asks for the source.' })),
});
const FENCE = /^\s*```(?:mermaid)?[^\S\n]*\n([\s\S]*?)\n```\s*$/;
/** Models often wrap the source in a fence despite the description; mermaid-cli can't parse one. */
export function unfence(source) {
    return FENCE.exec(source)?.[1] ?? source;
}
function fail(message) {
    return textResult(`${TOOL} failed: ${message}`, { status: 'failed' });
}
/** A path inside the workspace is shown relative to it, so a sandboxed agent can read it at the same place. */
function shown(path, workspaceDir) {
    if (workspaceDir === undefined) {
        return path;
    }
    const rel = relative(workspaceDir, path);
    return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}
export function registerMermaid(api) {
    const config = resolveConfig(api.pluginConfig);
    const warn = (message) => api.logger?.warn?.(`[${PLUGIN_ID}] ${message}`);
    api.registerTool((ctx) => {
        const { workspaceDir } = ctx;
        const configured = config.saveDir;
        let saveDir;
        if (configured !== undefined && isAbsolute(configured)) {
            saveDir = configured;
        }
        else if (workspaceDir !== undefined) {
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
            description: 'Draw a diagram or chart: renders Mermaid source to a PNG, sends it to this conversation, then sends your caption as your reply. Saves the .mmd and .png and returns their paths. On a syntax error, fix the source and call again.',
            parameters: PARAMETERS,
            canDeliverSourceReply: true,
            catalogMode: 'direct-only',
            async execute(_id, params, signal) {
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
                const caption = (params.caption ?? '').trim();
                try {
                    const media = [(await saveMediaBuffer(rendered.png, 'image/png', 'outbound', MAX_PNG_BYTES, `${saved.base}.png`)).path];
                    if (params.attachSource === true) {
                        media.push((await saveMediaBuffer(Buffer.from(source), 'text/plain', 'outbound', MAX_PNG_BYTES, `${saved.base}.txt`)).path);
                    }
                    const mmd = shown(saved.mmdPath, workspaceDir);
                    const png = shown(saved.pngPath, workspaceDir);
                    const details = { status: 'sent', mmd, png };
                    const { delivery } = ctx;
                    // Without a delivery helper the image goes with the reply text, in whatever order the channel sends them.
                    if (delivery === undefined) {
                        return textResult(`Sent the diagram. Saved ${mmd} and ${png}.`, { ...details, sourceReply: { text: caption, mediaUrls: media } });
                    }
                    for (const mediaUrl of media) {
                        // oxlint-disable-next-line no-await-in-loop -- sends must land in order: the image, then the .txt
                        await delivery.send({ mediaUrl });
                    }
                    return textResult(`Sent the diagram. Saved ${mmd} and ${png}.`, caption === '' ? details : { ...details, sourceReply: { text: caption } });
                }
                catch (error) {
                    warn(`sending failed: ${error instanceof Error ? error.message : String(error)}`);
                    return fail('the image could not be sent');
                }
            },
        };
    }, { name: TOOL, optional: true });
}
export default definePluginEntry({
    id: PLUGIN_ID,
    name: 'Mermaid',
    description: 'Renders Mermaid diagrams to PNG and sends them to the conversation.',
    register: registerMermaid,
});
