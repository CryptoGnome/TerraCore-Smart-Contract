const { MongoTopologyClosedError } = require('mongodb');
const ctx = require('../context');
const { webhook, webhook4 } = require('./webhooks');
const { sendTransaction } = require('./queue');

async function marketplaceLog(_action, _id, _item_number, _buyer, _seller, _price, marketplace, rarity, qty) {
    try {
        let collection = ctx.db.collection('marketplace-logs');
        let log = {
            action: _action,
            id: _id,
            item_number: _item_number,
            buyer: _buyer,
            seller: _seller,
            price: _price,
            marketplace: marketplace,
            rarity: rarity,
            qty: qty,
            created: Date.now()
        };
        await collection.insertOne(log);
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function listItem(_item, seller) {
    try {
        console.log('Listing item ' + _item.item_number + ' type: ' + _item.type + ' for ' + _item.price + ' by ' + seller);

        if (_item.type.includes('relics')) {
            let relic = await ctx.db.collection('relics').findOne({ username: seller, type: _item.type, amount: { $gt: 0 } });
            if (relic) {
                if (relic.market.listed == true) {
                    let amount = relic.market.amount;
                    if (amount + _item.amount > relic.amount) {
                        relic.market.amount = relic.amount;
                    } else {
                        relic.market.amount = amount + _item.amount;
                    }
                    relic.market.price = _item.price;
                    relic.market.created = new Date().getTime();
                    await ctx.db.collection('relics').updateOne({ username: seller, type: _item.type }, { $set: relic });
                    webhook4('Relics Listing Updated', relic.type, relic.market.amount.toString(), relic.market.price.toString(), 'Update Listing', relic.market.seller);
                } else {
                    relic.market.listed = true;
                    relic.market.amount = _item.amount;
                    relic.market.price = _item.price;
                    relic.market.seller = seller;
                    relic.market.created = new Date().getTime();
                    await ctx.db.collection('relics').updateOne({ username: seller, type: _item.type }, { $set: relic });
                    webhook4('New Relic Listing', relic.type, relic.market.amount.toString(), relic.market.price.toString(), 'New Listing', relic.market.seller);
                }
                marketplaceLog('create', relic.type, relic.type, null, seller, relic.market.price, null, relic.type, relic.market.amount);
            } else {
                console.log('Relic not found');
                return;
            }
        } else if (_item.type.includes('consumable')) {
            let consumable = await ctx.db.collection('consumables').findOne({ username: seller, type: _item.type, amount: { $gt: 0 } });
            if (consumable) {
                if (consumable.market.listed == true) {
                    let amount = consumable.market.amount;
                    if (amount + _item.amount > consumable.amount) {
                        consumable.market.amount = consumable.amount;
                    } else {
                        consumable.market.amount = amount + _item.amount;
                    }
                    consumable.market.price = _item.price;
                    consumable.market.created = new Date().getTime();
                    await ctx.db.collection('consumables').updateOne({ username: seller, type: _item.type }, { $set: consumable });
                    webhook4('Consumables Listing Updated', consumable.type, consumable.market.amount.toString(), consumable.market.price.toString(), 'Update Listing', consumable.market.seller);
                } else {
                    consumable.market.listed = true;
                    consumable.market.amount = _item.amount;
                    consumable.market.price = _item.price;
                    consumable.market.seller = seller;
                    consumable.market.created = new Date().getTime();
                    await ctx.db.collection('consumables').updateOne({ username: seller, type: _item.type }, { $set: consumable });
                    webhook4('New Consumable Listing', consumable.type, consumable.market.amount.toString(), consumable.market.price.toString(), 'New Listing', consumable.market.seller);
                }
                marketplaceLog('create', consumable.type, consumable.type, null, seller, consumable.market.price, null, consumable.type, consumable.market.amount);
            } else {
                console.log('Consumable not found');
                return;
            }
        } else {
            let collection = ctx.db.collection(_item.type);
            let item = await collection.findOne({ item_number: parseInt(_item.item_number) });
            if (item.salvaged == true) {
                console.log('Item is salvaged');
                return;
            }
            if (item && item.market.listed == false && item.owner == seller && item.equiped == false) {
                console.log('Item found');
                item.market.listed = true;
                item.market.price = _item.price;
                item.market.seller = seller;
                item.market.created = new Date().getTime();
                await collection.updateOne({ item_number: parseInt(_item.item_number) }, { $set: item });
                webhook('New Item Listed', `Item # ${item.item_number}  ${item.name} was listed by ${seller} for ${_item.price}`, item.rarity, item.attributes, '#f7f75c', item.id);
                marketplaceLog('create', item.id, item.item_number, null, seller, item.market.price, null, item.rarity, 1);
                return;
            } else {
                console.log('Item not found');
                return;
            }
        }
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function cancelItem(_item, seller) {
    try {
        if (_item.type.includes('relics')) {
            let relic = await ctx.db.collection('relics').findOne({ username: seller, type: _item.type, 'market.amount': { $gt: 0 } });
            if (relic) {
                relic.market.listed = false;
                relic.market.amount = 0;
                relic.market.price = 0;
                relic.market.seller = null;
                relic.market.created = 0;
                await ctx.db.collection('relics').updateOne({ username: seller, type: _item.type }, { $set: relic });
                webhook4('Relics Listing Cancelled', relic.type, relic.market.amount.toString(), relic.market.price.toString(), 'Cancel Listing', relic.market.seller);
                marketplaceLog('cancel', relic.type, relic.type, null, seller, relic.market.price, null, relic.type, relic.market.amount);
                return;
            } else {
                console.log('Relic not found');
                return;
            }
        }

        if (_item.type.includes('consumable')) {
            let consumable = await ctx.db.collection('consumables').findOne({ username: seller, type: _item.type, 'market.amount': { $gt: 0 } });
            if (consumable) {
                consumable.market.listed = false;
                consumable.market.amount = 0;
                consumable.market.price = 0;
                consumable.market.seller = null;
                consumable.market.created = 0;
                await ctx.db.collection('consumables').updateOne({ username: seller, type: _item.type }, { $set: consumable });
                webhook4('Consumables Listing Cancelled', consumable.type, consumable.market.amount.toString(), consumable.market.price.toString(), 'Cancel Listing', consumable.market.seller);
                marketplaceLog('cancel', consumable.type, consumable.type, null, seller, consumable.market.price, null, consumable.type, consumable.market.amount);
                return;
            } else {
                console.log('Consumable not found');
                return;
            }
        }

        let collection = ctx.db.collection(_item.type);
        let item = await collection.findOne({ item_number: parseInt(_item.item_number) });
        if (item && item.market.listed == true && item.owner == seller && item.equiped == false) {
            item.market.listed = false;
            item.market.price = 0;
            item.market.seller = null;
            item.market.created = 0;
            await collection.updateOne({ item_number: parseInt(_item.item_number) }, { $set: item });
            webhook('Listing Cancelled', `Item # ${item.item_number}  ${item.name} was cancelled by ${seller}`, item.rarity, item.attributes, '#ff906e', item.id);
            marketplaceLog('cancel', item.id, item.item_number, null, seller, item.market.price, null, item.rarity, 1);
            return;
        } else {
            console.log('Item not found');
            return;
        }
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

async function purchaseItem(memo, price, buyer) {
    try {
        let refundNeeded = true;
        let refundReason = 'Unknown error occurred';

        const refundBuyer = async (reason) => {
            console.log(`Refunding buyer ${buyer}: ${price} - Reason: ${reason}`);
            await sendTransaction(buyer, price, `Refund: ${reason}`);
        };

        if (memo.type.includes('relics') || memo.type.includes('consumable')) {
            const collectionName = memo.type.includes('relics') ? 'relics' : 'consumables';
            let item = await ctx.db.collection(collectionName).findOne({ username: memo.seller, type: memo.type, amount: { $gt: 0 } });

            if (!item) {
                refundReason = `${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)} not found`;
                await refundBuyer(refundReason);
                return;
            }

            if (!item.market.listed) {
                refundReason = `${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)} not listed`;
                await refundBuyer(refundReason);
                return;
            }

            let item_price = parseFloat(item.market.price.split(' ')[0]);
            let amount = parseFloat(price.split(' ')[0]);
            let _total = (item_price * memo.amount).toFixed(3);

            if (amount < _total) {
                refundReason = `Not enough Hive sent to purchase ${collectionName}`;
                await refundBuyer(refundReason);
                return;
            }

            if (memo.amount > item.market.amount) {
                refundReason = 'Amount is greater than listed';
                await refundBuyer(refundReason);
                return;
            }

            const session = ctx.client.startSession();
            try {
                await session.withTransaction(async () => {
                    await ctx.db.collection(collectionName).updateOne(
                        { username: memo.seller, type: memo.type },
                        {
                            $inc: { amount: -memo.amount },
                            $set: memo.amount < item.market.amount
                                ? { 'market.amount': item.market.amount - memo.amount }
                                : { 'market.listed': false, 'market.amount': 0, 'market.price': 0, 'market.seller': null, 'market.created': 0 }
                        },
                        { session }
                    );

                    await ctx.db.collection(collectionName).updateOne(
                        { username: memo.buyer, type: memo.type },
                        { $inc: { amount: memo.amount } },
                        { upsert: true, session }
                    );

                    await marketplaceLog('purchase', item.type, item.type, buyer, memo.seller, item_price, memo.marketplace, item.rarity, memo.amount);
                });

                refundNeeded = false;

                let sellerAmount = amount * 0.95;
                let marketplaceAmount = amount * 0.025;
                let terracoreAmount = amount * 0.025;

                await sendTransaction(memo.seller, sellerAmount.toFixed(3) + ' HIVE', `${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)} Sale: ${item.type} to ${buyer}`);

                if (memo.marketplace != 'terracore') {
                    await sendTransaction('asgarth', marketplaceAmount.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${item.type} to ${buyer}`);
                    await sendTransaction('crypt0gnome', terracoreAmount.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${item.type} to ${buyer}`);
                } else {
                    var total = marketplaceAmount + terracoreAmount;
                    await sendTransaction('crypt0gnome', total.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${item.type} to ${buyer}`);
                }

                webhook4(`${collectionName.charAt(0).toUpperCase() + collectionName.slice(1)} Purchased`, item.type, memo.amount.toString(), item_price.toString(), buyer, memo.seller);

            } catch (error) {
                console.error('Transaction failed:', error);
                refundReason = 'Transaction failed';
                await refundBuyer(refundReason);
            } finally {
                await session.endSession();
            }
        } else {
            let collection = ctx.db.collection(memo.type);
            let check = await collection.findOne({ item_number: parseInt(memo.item_number) });
            if (check) {
                if (check.market.listed && check.market.price == price && check.market.seller == memo.seller && check.owner == memo.seller && !check.equiped) {
                    const session = ctx.client.startSession();
                    try {
                        await session.withTransaction(async () => {
                            await collection.updateOne(
                                { item_number: check.item_number },
                                { $set: { owner: buyer, market: { listed: false, seller: null, price: 0, sold: Date.now() } } },
                                { session }
                            );

                            let amount = parseFloat(price.split(' ')[0]);
                            let seller_amount = amount * 0.95;
                            let marketplace_amount = amount * 0.025;
                            let terracore_amount = amount * 0.025;

                            await sendTransaction(memo.seller, seller_amount.toFixed(3) + ' HIVE', `Marketplace Sale of ${check.name} #${check.item_number} to ${buyer}`);
                            await marketplaceLog('purchase', check.id, check.item_number, buyer, memo.seller, price, memo.marketplace, check.rarity, 1);

                            if (memo.marketplace != 'terracore') {
                                await sendTransaction('asgarth', marketplace_amount.toFixed(3) + ' HIVE', `3rd Party Marketplace Fee for Sale of ${check.name} #${check.item_number} to ${buyer}`);
                                await sendTransaction('crypt0gnome', terracore_amount.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${check.name} #${check.item_number} to ${buyer}`);
                            } else {
                                var total = marketplace_amount + terracore_amount;
                                await sendTransaction('crypt0gnome', total.toFixed(3) + ' HIVE', `Terracore Marketplace Fee for Sale of ${check.name} #${check.item_number} to ${buyer}`);
                            }
                        });

                        refundNeeded = false;
                        webhook('Item Purchased', `Item # ${check.item_number}  ${check.name} was purchased by ${buyer} for ${price}`, check.rarity, check.attributes, '#81fc8d', check.id);
                    } catch (error) {
                        console.error('Transaction failed:', error);
                        refundReason = 'Transaction failed';
                    } finally {
                        await session.endSession();
                    }
                } else {
                    refundReason = 'Item is no longer available for purchase';
                }
            } else {
                refundReason = 'Item not found';
            }
        }

        if (refundNeeded) {
            await refundBuyer(refundReason);
        }

    } catch (err) {
        console.error('Error in purchaseItem:', err);
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            await sendTransaction(buyer, price, 'Refund: Unexpected error occurred');
        }
    }
}

async function transferItem(_item, sender) {
    try {
        let collection = ctx.db.collection(_item.type);
        let item = await collection.findOne({ item_number: parseInt(_item.item_number) });
        if (item.owner == sender && item.equiped == false) {
            if (item.lastTransfer != null) {
                if (Date.now() - item.lastTransfer < 86400000) {
                    console.log('Item was transferred less than 24 hours ago, cannot transfer');
                    webhook('Item Transfer Failed', `Item # ${item.item_number}  ${item.name} was transferred less than 24 hours ago, cannot transfer`, item.rarity, item.attributes, '#ff0000', item.id);
                    return;
                }
            }
            if (item.market.listed == true) {
                console.log('Item is listed in marketplace cannot be transferred');
            } else {
                await collection.updateOne({ item_number: item.item_number }, { $set: { owner: _item.receiver, lastTransfer: Date.now() } });
                webhook("Item Transferred", `Item ${item.name} was transferred from ${sender} to ${_item.receiver}`, item.rarity, item.attributes, '#c2fffe', item.id);
                marketplaceLog('transfer', item.id, item.item_number, _item.receiver, sender, null, null, item.rarity, 1);
            }
        } else {
            return;
        }
    } catch (err) {
        if (err instanceof MongoTopologyClosedError) {
            console.log('MongoDB connection is closed');
            process.exit(1);
        } else {
            console.log(err);
        }
    }
}

module.exports = { marketplaceLog, listItem, cancelItem, purchaseItem, transferItem };
