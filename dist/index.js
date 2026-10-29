import { isAbsolute, join, relative } from 'node:path';
import { saveMediaBuffer } from 'openclaw/plugin-sdk/media-store';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { textResult } from 'openclaw/plugin-sdk/tool-results';
import { Type } from 'typebox';
import { PLUGIN_ID, resolveConfig } from './config.js';
import { MAX_PNG_BYTES, renderPng } from './render.js';
import { readSavedSource, saveDiagram } from './save.js';
const RENDER = 'render_mermaid';
const SEND_SOURCE = 'send_mermaid_source';
const CAPTION = Type.String({
    description: 'Your message, in your own words. It is sent with the file and ends your turn: write nothing after this call.',
});
const RENDER_PARAMETERS = Type.Object({
    source: Type.String({ description: 'Mermaid source, without a ```mermaid fence.' }),
    caption: CAPTION,
    name: Type.Optional(Type.String({ description: 'A few words that name the files, such as "login flow".' })),
    attachSource: Type.Optional(Type.Boolean({
        description: 'Also send the source as a .txt file after the image. Only when the user asks for the source in the same message as the diagram.',
    })),
});
const SEND_SOURCE_PARAMETERS = Type.Object({
    file: Type.String({ description: 'The .mmd path render_mermaid returned for the diagram already sent.' }),
    caption: Type.Optional(CAPTION),
});
const FENCE = /^\s*```(?:mermaid)?[^\S\n]*\n([\s\S]*?)\n```\s*$/;
/** Models often wrap the source in a fence despite the description; mermaid-cli can't parse one. */
export function unfence(source) {
    return FENCE.exec(source)?.[1] ?? source;
}
function fail(tool, message) {
    return textResult(`${tool} failed: ${message}`, { status: 'failed' });
}
/** A path inside the workspace is shown relative to it, so a sandboxed agent can read it at the same place. */
function shown(path, workspaceDir) {
    if (workspaceDir === undefined) {
        return path;
    }
    const rel = relative(workspaceDir, path);
    return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}
function resolveSaveDir(config, workspaceDir) {
    const configured = config.saveDir;
    if (configured !== undefined && isAbsolute(configured)) {
        return configured;
    }
    return workspaceDir === undefined ? undefined : join(workspaceDir, configured ?? join('out', 'diagrams'));
}
const stageText = async (text, name) => (await saveMediaBuffer(Buffer.from(text), 'text/plain', 'outbound', MAX_PNG_BYTES, name)).path;
/**
 * Sends the files and the caption in the order `textPosition` sets. The caption is the reply, which ends the turn;
 * with the text first, the files are the reply. Without a delivery helper everything goes in the reply, in whatever
 * order the channel sends it.
 */
async function deliver(delivery, media, caption, config, done, details) {
    if (delivery === undefined) {
        return textResult(done, { ...details, sourceReply: { text: caption, mediaUrls: media } });
    }
    if (config.textPosition === 'before') {
        if (caption !== '') {
            await delivery.send({ text: caption });
        }
        return textResult(done, { ...details, sourceReply: { mediaUrls: media } });
    }
    for (const mediaUrl of media) {
        // oxlint-disable-next-line no-await-in-loop -- sends must land in order: the image, then the .txt
        await delivery.send({ mediaUrl });
    }
    return textResult(done, caption === '' ? details : { ...details, sourceReply: { text: caption } });
}
export function registerMermaid(api) {
    const config = resolveConfig(api.pluginConfig);
    const warn = (message) => api.logger?.warn?.(`[${PLUGIN_ID}] ${message}`);
    api.registerTool((ctx) => {
        const { workspaceDir } = ctx;
        const dir = resolveSaveDir(config, workspaceDir);
        if (dir === undefined) {
            warn('no saveDir and no agent workspace: render_mermaid is not offered');
            return null;
        }
        return {
            name: RENDER,
            label: 'Render Mermaid',
            description: 'Draw a diagram or chart: renders Mermaid source to a PNG, sends it to this conversation, then sends your caption as your reply. Saves the .mmd and .png and returns their paths. On a syntax error, fix the source and call again.',
            parameters: RENDER_PARAMETERS,
            canDeliverSourceReply: true,
            catalogMode: 'direct-only',
            async execute(_id, params, signal) {
                const source = unfence(params.source);
                if (source.trim() === '') {
                    return fail(RENDER, 'source is empty');
                }
                if (source.length > config.maxSourceChars) {
                    return fail(RENDER, `source is ${source.length} characters; the limit is ${config.maxSourceChars}`);
                }
                const rendered = await renderPng(source, { timeoutMs: config.timeoutMs, signal });
                if (!rendered.ok) {
                    return fail(RENDER, rendered.message);
                }
                const saved = await saveDiagram(dir, params.name ?? '', source, rendered.png);
                if (!saved.ok) {
                    warn(`save failed: ${saved.message}`);
                    return fail(RENDER, saved.message);
                }
                try {
                    const media = [(await saveMediaBuffer(rendered.png, 'image/png', 'outbound', MAX_PNG_BYTES, `${saved.base}.png`)).path];
                    if (params.attachSource === true || config.source === 'always') {
                        media.push(await stageText(source, `${saved.base}.txt`));
                    }
                    const mmd = shown(saved.mmdPath, workspaceDir);
                    const png = shown(saved.pngPath, workspaceDir);
                    const caption = (params.caption ?? '').trim();
                    return await deliver(ctx.delivery, media, caption, config, `Sent the diagram. Saved ${mmd} and ${png}.`, { status: 'sent', mmd, png });
                }
                catch (error) {
                    warn(`sending failed: ${error instanceof Error ? error.message : String(error)}`);
                    return fail(RENDER, 'the image could not be sent');
                }
            },
        };
    }, { name: RENDER, optional: true });
    api.registerTool((ctx) => {
        const dir = resolveSaveDir(config, ctx.workspaceDir);
        if (dir === undefined) {
            return null;
        }
        return {
            name: SEND_SOURCE,
            label: 'Send Mermaid source',
            description: 'Send the Mermaid source of a diagram you already sent, as a .txt file on its own. Use it when the user asks for the source after seeing the image. The image is not sent again.',
            parameters: SEND_SOURCE_PARAMETERS,
            canDeliverSourceReply: true,
            catalogMode: 'direct-only',
            async execute(_id, params) {
                const read = await readSavedSource(dir, params.file);
                if (!read.ok) {
                    return fail(SEND_SOURCE, read.message);
                }
                try {
                    const txt = await stageText(read.source, `${read.base}.txt`);
                    const caption = (params.caption ?? '').trim();
                    return await deliver(ctx.delivery, [txt], caption, config, `Sent ${read.base}.txt.`, { status: 'sent' });
                }
                catch (error) {
                    warn(`sending failed: ${error instanceof Error ? error.message : String(error)}`);
                    return fail(SEND_SOURCE, 'the source could not be sent');
                }
            },
        };
    }, { name: SEND_SOURCE, optional: true });
}
export default definePluginEntry({
    id: PLUGIN_ID,
    name: 'Mermaid',
    description: 'Renders Mermaid diagrams to PNG and sends them to the conversation.',
    register: registerMermaid,
});
