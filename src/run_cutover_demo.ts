import { createInfraiFromEnv } from './infrai_client.js';
import { stageMarketplaceCutover } from './marketplace_dns_cutover.js';

const infrai = createInfraiFromEnv();

const request = {
  orderId: 'ord_1001',
  sellerDomain: 'clinic-example.test',
  buyerMailbox: {
    mailFromSubdomain: 'notify',
    returnPathCname: 'rp.mail.buyer.example',
    dmarcMailbox: 'dmarc@buyer.example',
    mxHosts: [
      { host: 'mx1.buyer.example', priority: 10 },
      { host: 'mx2.buyer.example', priority: 20 }
    ]
  }
};

const result = await stageMarketplaceCutover(infrai, request);
console.log(JSON.stringify(result, null, 2));
