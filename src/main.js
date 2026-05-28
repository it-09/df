import { Actor } from 'apify';

await Actor.init();

await Actor.pushData({
    test: true,
    hello: 'world',
    timestamp: new Date().toISOString(),
});

console.log('Push complete');

await Actor.exit();