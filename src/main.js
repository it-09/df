import { Actor } from 'apify';

await Actor.init();

console.log('Writing test item...');

await Actor.pushData({
    hello: 'world',
    timestamp: new Date().toISOString(),
});

console.log('Done writing.');

await Actor.exit();