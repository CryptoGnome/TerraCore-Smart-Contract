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

async function bossWebhook(title, message, rarity, planet) {
    let color;
    let id;

    switch (rarity) {
        case 'common':
            color = '#bbc0c7';
            id = 'common_crate';
            break;
        case 'uncommon':
            color = '#538a62';
            id = 'uncommon_crate';
            break;
        case 'rare':
            color = '#2a2cbd';
            id = 'rare_crate';
            break;
        case 'epic':
            color = '#7c04cc';
            id = 'epic_crate';
            break;
        case 'legendary':
            color = '#d98b16';
            id = 'legendary_crate';
            break;
    }

    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .addField('Planet: ', planet, true)
        .setColor(color)
        .setThumbnail(`https://terracore.herokuapp.com/images/${id}.png`)
        .setTimestamp();

    try {
        await ctx.boss_hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log('Discord Webhook Error:', err.message);
    }
}

async function bossWebhook2(title, message, rarity, planet, type) {
    let color;
    let id;

    switch (rarity) {
        case 'common':
            color = '#bbc0c7';
            id = 'common_crate';
            break;
        case 'uncommon':
            color = '#538a62';
            id = 'uncommon_crate';
            break;
        case 'rare':
            color = '#2a2cbd';
            id = 'rare_crate';
            break;
        case 'epic':
            color = '#7c04cc';
            id = 'epic_crate';
            break;
        case 'legendary':
            color = '#d98b16';
            id = 'legendary_crate';
            break;
    }

    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .addField('Planet: ', planet, true)
        .setColor(color)
        .setThumbnail(`https://terracore.herokuapp.com/images/${type}.png`)
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

module.exports = { webhook, marketWebhook, bossWebhook, bossWebhook2, forgeWebhook };
