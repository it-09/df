import { Actor, Dataset } from 'apify';

await Actor.init();

const dataset = await Dataset.open();
console.log('Dataset ID:', dataset.id);

console.log('Pushing test item...');
await dataset.pushData({
    test: true,
    hello: 'world',
    source: 'manual_dataset_push',
    time: new Date().toISOString()
});

const info = await dataset.getInfo();
console.log('Dataset info after push:', info);

console.log('Diagnostic complete');

await Actor.exit();