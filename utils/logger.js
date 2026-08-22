/**
 * Lightweight structured logger.
 *
 * Outputs JSON lines in production (easy to parse in CloudWatch / Datadog).
 * Outputs pretty-printed lines in development.
 *
 * Drop-in replacement for console.log / console.error throughout the codebase.
 * When you are ready to add Pino: `npm install pino pino-pretty`
 * and swap the implementation below — the API stays the same.
 */

const IS_PROD = process.env.NODE_ENV === 'production';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

const formatPretty = (level, msg, meta) => {
    const ts = new Date().toISOString();
    const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
    return `[${ts}] ${level.toUpperCase().padEnd(5)} ${msg}${metaStr}`;
};

const formatJson = (level, msg, meta) => {
    return JSON.stringify({ time: new Date().toISOString(), level, msg, ...meta });
};

const log = (level, msg, meta) => {
    if (LEVELS[level] > currentLevel) return;
    const line = IS_PROD ? formatJson(level, msg, meta) : formatPretty(level, msg, meta);
    if (level === 'error' || level === 'warn') {
        process.stderr.write(line + '\n');
    } else {
        process.stdout.write(line + '\n');
    }
};

const logger = {
    info:  (msg, meta) => log('info',  msg, meta),
    warn:  (msg, meta) => log('warn',  msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    debug: (msg, meta) => log('debug', msg, meta),
};

module.exports = logger;
