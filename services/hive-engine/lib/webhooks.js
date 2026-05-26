const { MessageBuilder } = require('discord-webhook-node');
const ctx = require('../context');

async function webhook(title, message, color) {
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .setColor(color)
        .setTimestamp();
    try {
        ctx.hook.send(embed).then(() => console.log('Sent webhook successfully!'))
            .catch(err => console.log(err.message));
    } catch (err) {
        console.log('Discord Webhook Error:', err.message);
    }
}

async function marketWebhook(title, message, color) {
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .setColor(color)
        .setTimestamp();
    try {
        ctx.market_hook.send(embed).then(() => console.log('Sent webhook successfully!'))
            .catch(err => console.log(err.message));
    } catch (err) {
        console.log('Discord Webhook Error:', err.message);
    }
}

const RARITY_COLOR = { common: '#bbc0c7', uncommon: '#538a62', rare: '#2a2cbd', epic: '#7c04cc', legendary: '#d98b16' };
const RARITY_EMOJI = { common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟠' };
const IMG = 'https://api.terracoregame.com/images/';

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

async function crateDropWebhook(owner, name, itemNumber, rarity, planet) {
    const embed = new MessageBuilder()
        .setTitle(`${RARITY_EMOJI[rarity] ?? '🎁'} Crate Dropped!`)
        .addField('Player', owner, true)
        .addField('Crate', name, true)
        .addField('Item #', String(itemNumber), true)
        .addField('Planet', planet, true)
        .addField('Rarity', capitalize(rarity), true)
        .setColor(RARITY_COLOR[rarity] ?? '#ffffff')
        .setThumbnail(`${IMG}${rarity}_crate.png`)
        .setTimestamp();
    try {
        await ctx.boss_hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log('Discord Webhook Error:', err.message);
    }
}

async function consumableDropWebhook(owner, type, rarity, planet) {
    const embed = new MessageBuilder()
        .setTitle('🧪 Consumable Dropped!')
        .addField('Player', owner, true)
        .addField('Type', capitalize(type) + ' Consumable', true)
        .addField('Rarity', capitalize(rarity), true)
        .addField('Planet', planet, true)
        .setColor(RARITY_COLOR[rarity] ?? '#ffffff')
        .setThumbnail(`${IMG}${type}_consumable.png`)
        .setTimestamp();
    try {
        await ctx.boss_hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log('Discord Webhook Error:', err.message);
    }
}

async function relicDropWebhook(owner, relicType, amount, rarity, planet) {
    const label = relicType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const embed = new MessageBuilder()
        .setTitle('✨ Relic Dropped!')
        .addField('Player', owner, true)
        .addField('Amount', String(amount), true)
        .addField('Type', label, true)
        .addField('Planet', planet, true)
        .setColor(RARITY_COLOR[rarity] ?? '#ffffff')
        .setThumbnail(`${IMG}${rarity}_relic.png`)
        .setTimestamp();
    try {
        await ctx.boss_hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log('Discord Webhook Error:', err.message);
    }
}

async function forgeWebhook(title, message) {
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .setColor('#00ff00')
        .setTimestamp();
    try {
        ctx.forge_hook.send(embed).then(() => console.log('Sent webhook successfully!'))
            .catch(err => console.log(err.message));
    } catch (err) {
        console.log('Discord Webhook Error:', err.message);
    }
}

const TIER_COLORS = { 1: '#95A5A6', 2: '#2ECC71', 3: '#3498DB', 4: '#F1C40F', 5: '#E74C3C' };
const TIER_LABEL  = { 1: 'T1', 2: 'T2', 3: 'T3', 4: 'T4', 5: 'T5' };
const QT_EMOJI    = { combat: '⚔️', stealth: '👁', fortune: '🎲', salvage: '🔧', defense: '🛡' };

async function questStartWebhook(username, questName, tier, questType, durationHours, scrapPaid, imageUrl) {
    const label = `${TIER_LABEL[tier] || `T${tier}`} ${questType}`;
    const embed = new MessageBuilder()
        .setTitle(`${QT_EMOJI[questType] || '🎯'} "${questName}"`)
        .addField('Player', username, true)
        .addField('Mission', label, true)
        .addField('Duration', `${durationHours}h`, true)
        .addField('SCRAP', `${Math.round(scrapPaid)}`, true)
        .setColor(TIER_COLORS[tier] || '#95A5A6')
        .setTimestamp();
    if (imageUrl) embed.setThumbnail(imageUrl);
    try {
        ctx.quest_hook.send(embed).catch(err => console.log(err.message));
    } catch (err) {
        console.log('Discord Webhook Error:', err.message);
    }
}

module.exports = { webhook, marketWebhook, crateDropWebhook, consumableDropWebhook, relicDropWebhook, forgeWebhook, questStartWebhook };
