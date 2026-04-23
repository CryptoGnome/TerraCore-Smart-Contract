// Centralized error logger for TerraCore.
//
// Usage:
//   const { logError } = require('../../shared/error-logger');
//   logError('SC_BATTLE_UNEXPECTED', err, { fn: 'battle', username, blockId });
//
// Initialization (done once in services/app.js):
//   const errorLogger = require('../shared/error-logger');
//   errorLogger.setErrorHook(new Webhook(process.env.ERROR_DISCORD_WEBHOOK));
//   errorLogger.setErrorDb(db);

const { MessageBuilder } = require('discord-webhook-node');
const { CODES, SEVERITY } = require('./error-codes');

let _hook = null;
let _db   = null;

const SEVERITY_COLOR = {
    [SEVERITY.FATAL]: '#ff0000',
    [SEVERITY.ERROR]: '#ff6600',
    [SEVERITY.WARN]:  '#ffcc00',
};

function setErrorHook(hook) {
    _hook = hook;
}

function setErrorDb(db) {
    _db = db;
}

function logError(code, err, ctx = {}, overrideSeverity = null) {
    const entry       = CODES[code];
    const severity    = overrideSeverity || (entry ? entry.severity : SEVERITY.ERROR);
    const description = entry ? entry.description : 'Unknown error code';

    const ts         = new Date().toISOString();
    const service    = ctx.service  || _deriveService(code);
    const fn         = ctx.fn       || 'unknown';
    const username   = ctx.username || null;
    const blockId    = ctx.blockId  || null;
    const errMessage = _extractMessage(err);
    const errStack   = (err instanceof Error) ? err.stack : null;

    const parts = [`[${ts}]`, `[${severity}]`, `[${code}]`, `[${service}]`, `fn=${fn}`];
    if (username) parts.push(`user=${username}`);
    if (blockId)  parts.push(`block=${blockId}`);
    parts.push(errMessage);
    console.error(parts.join(' '));
    if (errStack) console.error(errStack);

    if (severity === SEVERITY.ERROR || severity === SEVERITY.FATAL) {
        _sendDiscordAlert(code, severity, description, errMessage, service, fn, username, blockId, ts)
            .catch(() => {});
    }

    if (_db) {
        const doc = {
            code, severity, description, service, fn,
            username:  username  || undefined,
            blockId:   blockId   || undefined,
            message:   errMessage,
            stack:     errStack  || undefined,
            extra:     ctx.extra || undefined,
            timestamp: new Date(),
        };
        _db.collection('error-log').insertOne(doc).catch(() => {});
    }
}

function _deriveService(code) {
    if (code.startsWith('SYS_')) return 'SYS';
    if (code.startsWith('SC_'))  return 'SC';
    if (code.startsWith('HE_'))  return 'HE';
    if (code.startsWith('NFT_')) return 'NFT';
    if (code.startsWith('LB_'))  return 'LB';
    return 'UNKNOWN';
}

function _extractMessage(err) {
    if (!err) return '(no error object)';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    try { return JSON.stringify(err); } catch (_) { return String(err); }
}

async function _sendDiscordAlert(code, severity, description, errMessage, service, fn, username, blockId, ts) {
    if (!_hook) return;
    try {
        const msgField = errMessage.length > 900 ? errMessage.slice(0, 900) + '…' : errMessage;
        const embed = new MessageBuilder()
            .setTitle(`[${severity}] ${code}`)
            .setDescription(description)
            .addField('Service',  service, true)
            .addField('Function', fn,      true)
            .addField('Error',    msgField, false);
        if (username) embed.addField('Username', username, true);
        if (blockId)  embed.addField('Block ID', String(blockId), true);
        embed.addField('Timestamp', ts, false)
            .setColor(SEVERITY_COLOR[severity] || '#ff6600')
            .setTimestamp();
        await _hook.send(embed);
    } catch (discordErr) {
        console.error('[error-logger] Discord alert send failed:', discordErr.message);
    }
}

module.exports = { setErrorHook, setErrorDb, logError, SEVERITY };
