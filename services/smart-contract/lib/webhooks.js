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

async function webhook3(quest, player, effectiveRoll, drawCount, relics, scrapPaid) {
    const EMOJI   = { common: '⚪', uncommon: '🟢', rare: '🔵', epic: '🟣', legendary: '🟡' };
    const COLORS  = { legendary: '#FFD700', epic: '#9B59B6', rare: '#3498DB', uncommon: '#2ECC71', common: '#95A5A6' };
    const TIER_LABEL = { 1: 'T1', 2: 'T2', 3: 'T3', 4: 'T4', 5: 'T5' };

    const topRarity = ['legendary','epic','rare','uncommon','common'].find(r => (relics[r] || 0) > 0) || 'common';

    const relicParts = ['legendary','epic','rare','uncommon','common']
        .filter(r => (relics[r] || 0) > 0)
        .map(r => `${EMOJI[r]} **${relics[r]}** ${r}`);

    const relicLine = relicParts.length ? relicParts.join('  ·  ') : '_No relics_';
    const questLabel = `${TIER_LABEL[quest.tier] || `T${quest.tier}`} ${quest.quest_type}`;

    const embed = new MessageBuilder()
        .setTitle(`✅ "${quest.name}"`)
        .setDescription(relicLine)
        .addField('Player', player, true)
        .addField('Mission', questLabel, true)
        .addField('SCRAP', `${scrapPaid || '?'}`, true)
        .addField('Roll', `${effectiveRoll.toFixed(1)}  ·  ${drawCount} draws`, true)
        .setColor(COLORS[topRarity])
        .setTimestamp();
    if (quest.image_url) embed.setThumbnail(quest.image_url);
    try {
        ctx.hook3.send(embed).catch(err => console.log(err.message));
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
