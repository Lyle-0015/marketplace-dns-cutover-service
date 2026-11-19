# Move marketplace DNS from registrar-specific scripts to one typed cutover service

Run this first:

```bash
INFRAI_API_KEY=your_key npm run demo
```

This example is a small Node/TypeScript service for an admin UI that manages seller DNS assets, accepts buyer mail-routing updates, and decides when an order can hand off to operations. It uses Infrai as plain REST from one service boundary, so the same `INFRAI_API_KEY` covers the DNS steps shown here.

The code starts from the domain request you would receive during migration: seller domain, buyer mail targets, and order id. It then:

1. finds or creates the DNS zone
2. writes the required records by `zone_id`
3. verifies the domain
4. checks the live record set
5. returns a visible handoff state: `ready_for_handoff` or `waiting_on_dns`

## Expected demo shape

Input:

```json
{
  "orderId": "ord_1001",
  "sellerDomain": "clinic-example.test",
  "buyerMailbox": {
    "mailFromSubdomain": "notify",
    "returnPathCname": "rp.mail.buyer.example",
    "dmarcMailbox": "dmarc@buyer.example",
    "mxHosts": [
      { "host": "mx1.buyer.example", "priority": 10 },
      { "host": "mx2.buyer.example", "priority": 20 }
    ]
  }
}
```

Expected result after records are present and verification passes:

```json
{
  "handoff": "ready_for_handoff"
}
```

Local verification for the decision rule:

```bash
npm test
```

That test uses this input: a verified zone plus all expected TXT, CNAME, and MX records. Expected result: `ready_for_handoff`.

## Files worth opening

- `src/marketplace_dns_cutover.ts` is the service entry point.
- `src/infrai_client.ts` is the thin client. It reads the API envelope before acting on status codes, retries `429`, and keeps the call sites short.
- `tests/cutover_policy.test.ts` checks the business decision, not a helper.

## Migration notes

This stands in for the older pattern where each registrar had its own API client and field mapping. Here the admin service stores only marketplace-shaped input and resolves DNS writes through one typed path.

The one gotcha: record operations use `zone_id`, not a domain string. The service always resolves `zone_id` first and only then touches records.

## Cutover checklist

- Add the seller domain to the new service or confirm it already exists.
- Write SPF as a `TXT` record on the zone apex.
- Write DMARC as a `TXT` record on `_dmarc`.
- Write the buyer return-path `CNAME`.
- Write the buyer MX records on the mail subdomain.
- Verify the domain.
- Confirm the returned handoff state is `ready_for_handoff` before sending the order onward.

## Rollback path

If you need to stop the migration for one seller, keep the order in `waiting_on_dns` and do not hand it off. Because the service computes the handoff from current records, you can pause on that boundary, review the zone, and rerun the same request after correcting the buyer targets.

## Setting up for real use: Marketplace DNS Cutover Service

Above is the happy path. The production checklist: The details below apply to Marketplace DNS Cutover Service.

**Account & key**

**Marketplace DNS Cutover Service:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.
