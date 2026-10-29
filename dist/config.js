export const PLUGIN_ID = 'mermaid';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value) {
    return typeof value === 'string' && value !== '' ? value : undefined;
}
function count(value, fallback) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : fallback;
}
/** The manifest schema rejects bad shapes; these fallbacks cover a config that never went through it. */
export function resolveConfig(raw) {
    const c = isRecord(raw) ? raw : {};
    return {
        saveDir: text(c.saveDir),
        timeoutMs: count(c.timeoutMs, 20000),
        maxSourceChars: count(c.maxSourceChars, 20000),
        source: c.source === 'always' ? 'always' : 'onRequest',
        textPosition: c.textPosition === 'before' ? 'before' : 'after',
    };
}
