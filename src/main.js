import { Actor } from 'apify';

await Actor.init();

const token = process.env.APIFY_TOKEN;
const datasetId = process.env.APIFY_DEFAULT_DATASET_ID;

const maskedToken = token ? token.substring(0, 5) + '...' : 'MISSING';
console.log('Dataset ID:', datasetId);
console.log('Token:', maskedToken);

const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}`;

console.log('\nPushing test item via direct REST API...');

const payload = [
  {
    rawApiTest: true,
    message: "dataset raw api test",
    time: new Date().toISOString()
  }
];

try {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    console.log('POST Status:', response.status);
    const responseText = await response.text();
    console.log('POST Response Text:', responseText);
    
    if (response.ok) {
        console.log('✅ POST Success');
    } else {
        console.error('❌ POST Failed');
    }
} catch (e) {
    console.error('❌ Fetch exception during POST:', e);
}

const infoUrl = `https://api.apify.com/v2/datasets/${datasetId}?token=${token}`;
console.log('\nFetching dataset metadata...');
try {
    const infoResponse = await fetch(infoUrl);
    console.log('GET Status:', infoResponse.status);
    
    if (infoResponse.ok) {
        const infoData = await infoResponse.json();
        console.log('Dataset Info:', {
            itemCount: infoData.data.itemCount,
            writeCount: infoData.data.writeCount,
            storageBytes: infoData.data.storageBytes
        });
    } else {
        console.error('❌ Failed to fetch dataset info. Response text:', await infoResponse.text());
    }
} catch (e) {
    console.error('❌ Fetch exception during GET info:', e);
}

console.log('\nDiagnostic complete');

await Actor.exit();