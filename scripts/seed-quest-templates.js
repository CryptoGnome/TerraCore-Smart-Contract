const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { MongoClient } = require('mongodb');
const fs = require('fs');

const TEMPLATES_DIR = path.resolve(__dirname, '../../docs/quest-templates');

async function main() {
    if (!process.env.MONGO_URL) {
        console.error('MONGO_URL not set — ensure .env exists in the Smart Contract root');
        process.exit(1);
    }

    const client = new MongoClient(process.env.MONGO_URL, {
        connectTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000,
    });

    try {
        await client.connect();
        const db = client.db('terracore');
        const collection = db.collection('quest-templates');

        const files = fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
        if (files.length === 0) {
            console.log('No .json files found in', TEMPLATES_DIR);
            return;
        }

        let total = 0, inserted = 0, updated = 0;

        for (const file of files) {
            const filePath = path.join(TEMPLATES_DIR, file);
            let templates;
            try {
                templates = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            } catch (err) {
                console.warn(`Skipping ${file}: parse error — ${err.message}`);
                continue;
            }

            if (!Array.isArray(templates)) {
                console.warn(`Skipping ${file}: root value must be a JSON array`);
                continue;
            }

            let fileCount = 0;
            for (const template of templates) {
                if (!template.name) {
                    console.warn(`  Skipping entry in ${file}: missing name`);
                    continue;
                }

                const result = await collection.updateOne(
                    { name: template.name },
                    { $set: template },
                    { upsert: true }
                );

                if (result.upsertedCount) inserted++;
                else updated++;
                total++;
                fileCount++;
            }

            console.log(`${file}: ${fileCount} templates`);
        }

        console.log(`\nDone — ${total} total (${inserted} inserted, ${updated} updated)`);
    } finally {
        await client.close();
    }
}

main().catch(err => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
