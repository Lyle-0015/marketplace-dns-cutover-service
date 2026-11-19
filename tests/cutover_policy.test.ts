import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketplaceRecords, decideOrderHandoff, cutoverRequestSchema } from '../src/marketplace_dns_cutover.js';

test('returns ready_for_handoff when verified zone has all expected buyer records', () => {
  const input = cutoverRequestSchema.parse({
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
  });

  const expected = buildMarketplaceRecords(input);
  const current = [
    { record_type: 'TXT', name: '@', content: 'v=spf1 include:buyer.example ~all' },
    { record_type: 'TXT', name: '_dmarc', content: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@buyer.example' },
    { record_type: 'CNAME', name: 'notify', content: 'rp.mail.buyer.example' },
    { record_type: 'MX', name: 'notify', content: 'mx1.buyer.example', priority: 10 },
    { record_type: 'MX', name: 'notify', content: 'mx2.buyer.example', priority: 20 }
  ];

  const result = decideOrderHandoff(expected, current, true);
  assert.equal(result, 'ready_for_handoff');
});
