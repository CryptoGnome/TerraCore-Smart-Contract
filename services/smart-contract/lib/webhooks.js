const { MessageBuilder } = require('discord-webhook-node');
const ctx = require('../context');

async function webhook(title, message, color) {
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', message, true)
        .setColor(color)
        .setTimestamp();
    try {
        ctx.hook.send(embed).catch(err => console.log(err.message));
    } catch (err) {
        console.log("Discord Webhook Error:", err.message);
    }
}

async function webhook2(title, message, color) {
    try {
        let collection = ctx.db.collection('players');
        let totalPlayers = await collection.countDocuments();

        collection = ctx.db.collection('stats');
        let todaysPlayers = await collection.findOne({ date: new Date().toISOString().slice(0, 10) });
        todaysPlayers = todaysPlayers ? todaysPlayers.players : 0;

        const embed = new MessageBuilder()
            .setTitle(title)
            .addField('New Citizen: ', message, true)
            .addField('Total Citizens: ', totalPlayers.toString(), true)
            .addField('New Citizens Today: ', todaysPlayers.toString(), true)
            .setColor(color)
            .setTimestamp();

        ctx.hook2.send(embed).then(() => console.log('Sent webhook successfully!'))
            .catch(err => console.log(err.message));
    } catch (err) {
        console.log("Discord Webhook Error:", err.message);
    }
}

async function webhook3(title, common, uncommon, rare, epic, legendary) {
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Common Relics: ', common, true)
        .addField('Uncommon Relics: ', uncommon, false)
        .addField('Rare Relics: ', rare, false)
        .addField('Epic Relics: ', epic, false)
        .addField('Legendary Relics: ', legendary, false)
        .setColor('#00ff00')
        .setTimestamp();
    try {
        ctx.hook3.send(embed).then(() => console.log('Sent webhook successfully!'))
            .catch(err => console.log(err.message));
    } catch (err) {
        console.log("Discord Webhook Error:", err.message);
    }
}

async function webhook4(title, msg) {
    const embed = new MessageBuilder()
        .setTitle(title)
        .addField('Message: ', msg, true)
        .setColor('#ff0000')
        .setTimestamp();
    try {
        ctx.hook3.send(embed).then(() => console.log('Sent webhook successfully!'))
            .catch(err => console.log(err.message));
    } catch (err) {
        console.log("Discord Webhook Error:", err.message);
    }
}

module.exports = { webhook, webhook2, webhook3, webhook4 };
