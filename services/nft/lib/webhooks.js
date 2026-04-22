const { MessageBuilder } = require('discord-webhook-node');
const chalk = require('chalk');
const ctx = require('../context');

async function webhook(title, message, rarity, stats, color, id) {
    var embed;
    if (stats == null) {
        embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .addField('Rarity: ', rarity.toString(), false)
            .setColor(color)
            .setThumbnail(`https://terracore.herokuapp.com/images/${rarity + "_crate"}.png`)
            .setTimestamp();
    } else {
        switch (rarity) {
            case 'common':    color = '#bbc0c7'; break;
            case 'uncommon':  color = '#538a62'; break;
            case 'rare':      color = '#2a2cbd'; break;
            case 'epic':      color = '#7c04cc'; break;
            case 'legendary': color = '#d98b16'; break;
        }

        if (title != 'New Item Minted') {
            if (title.includes('Listed'))           color = '#f7f75c';
            else if (title.includes('Purchased'))   color = '#5cf75c';
            else if (title.includes('Cancelled'))   color = '#FF8440';
            else if (title.includes('Transferred')) color = '#ffffff';
        }

        embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .addField('Rarity: ', rarity.toString(), false)
            .addField('Damage: ', stats.damage.toString(), true)
            .addField('Defense: ', stats.defense.toString(), true)
            .addField('Dodge: ', stats.dodge.toString(), true)
            .addField('Crit: ', stats.crit.toString(), true)
            .addField('Luck: ', stats.luck.toString(), true)
            .addField('Engineering: ', stats.engineering.toString(), true)
            .setColor(color)
            .setThumbnail(`https://terracore.herokuapp.com/images/${id}.png`)
            .setTimestamp();
    }

    try {
        await ctx.hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error: ", err.message));
    }
}

async function webhook2(title, message, color) {
    try {
        if (message.includes('Common'))          color = '#808080';
        else if (message.includes('Uncommon'))   color = '#abffc1';
        else if (message.includes('Rare'))       color = '#0000FF';
        else if (message.includes('Epic'))       color = '#800080';
        else if (message.includes('Legendary'))  color = '#FFA500';
        else                                     color = '#808080';

        const embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .setColor(color)
            .setTimestamp();

        ctx.hook2.send(embed).catch(err => console.log(err.message));
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }
}

async function webhook3(title, message, rarity, stats, color, id) {
    var embed;
    if (stats == null) {
        embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .addField('Rarity: ', rarity.toString(), false)
            .setColor(color)
            .setThumbnail(`https://terracore.herokuapp.com/images/${rarity + "_crate"}.png`)
            .setTimestamp();
    } else {
        switch (rarity) {
            case 'common':    color = '#bbc0c7'; break;
            case 'uncommon':  color = '#538a62'; break;
            case 'rare':      color = '#2a2cbd'; break;
            case 'epic':      color = '#7c04cc'; break;
            case 'legendary': color = '#d98b16'; break;
        }

        if (title != 'New Item Minted') {
            if (title.includes('Listed'))           color = '#f7f75c';
            else if (title.includes('Purchased'))   color = '#5cf75c';
            else if (title.includes('Cancelled'))   color = '#FF8440';
            else if (title.includes('Transferred')) color = '#ffffff';
        }

        embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .addField('Rarity: ', rarity.toString(), false)
            .addField('Damage: ', stats.damage.toString(), true)
            .addField('Defense: ', stats.defense.toString(), true)
            .addField('Dodge: ', stats.dodge.toString(), true)
            .addField('Crit: ', stats.crit.toString(), true)
            .addField('Luck: ', stats.luck.toString(), true)
            .addField('Engineering: ', stats.engineering.toString(), true)
            .setColor(color)
            .setThumbnail(`https://terracore.herokuapp.com/images/${id}.png`)
            .setTimestamp();
    }

    try {
        await ctx.hook3.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error: ", err.message));
    }
}

async function webhook4(title, rarity, quantity, price, buyer, seller) {
    var image = rarity.substring(0, rarity.length - 1);
    var color = title.includes('Purchased') ? '#5cf75c' : '#ffffff';

    var embed = new MessageBuilder()
        .setTitle(title)
        .addField('Rarity: ', rarity, false)
        .addField('Quantity: ', quantity, true)
        .addField('Price: ', price, true)
        .addField('Buyer: ', buyer, true)
        .addField('Seller: ', seller, true)
        .setColor(color)
        .setThumbnail(`https://terracore.herokuapp.com/images/${image}.png`)
        .setTimestamp();

    try {
        await ctx.hook.send(embed);
        console.log('Sent webhook successfully!');
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error: ", err.message));
    }
}

async function questHook(title, message, color, image) {
    try {
        const embed = new MessageBuilder()
            .setTitle(title)
            .addField('Message: ', message, true)
            .setColor(color)
            .setThumbnail(image)
            .setTimestamp();
        ctx.hook4.send(embed).catch(err => console.log(err.message));
    } catch (err) {
        console.log(chalk.red("Discord Webhook Error"));
    }
}

module.exports = { webhook, webhook2, webhook3, webhook4, questHook };
