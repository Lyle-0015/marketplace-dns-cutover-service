import { z } from 'zod';
import { InfraiApiError, InfraiClient } from './infrai_client.js';

const mailboxSchema = z.object({
  mailFromSubdomain: z.string().min(1),
  returnPathCname: z.string().min(1),
  dmarcMailbox: z.string().email(),
  mxHosts: z.array(z.object({ host: z.string().min(1), priority: z.number().int().positive() })).min(1)
});

export const cutoverRequestSchema = z.object({
  orderId: z.string().min(1),
  sellerDomain: z.string().min(1),
  buyerMailbox: mailboxSchema
});

export type CutoverRequest = z.infer<typeof cutoverRequestSchema>;

export type VisibleRecord = {
  record_type: string;
  name: string;
  content: string;
  priority?: number;
};

export type CutoverResult = {
  orderId: string;
  sellerDomain: string;
  zoneId: string;
  handoff: 'ready_for_handoff' | 'waiting_on_dns';
  expectedRecords: VisibleRecord[];
  currentRecords: VisibleRecord[];
};

export function buildMarketplaceRecords(input: CutoverRequest): VisibleRecord[] {
  const apexSpf: VisibleRecord = {
    record_type: 'TXT',
    name: '@',
    content: 'v=spf1 include:buyer.example ~all'
  };

  const dmarc: VisibleRecord = {
    record_type: 'TXT',
    name: '_dmarc',
    content: `v=DMARC1; p=quarantine; rua=mailto:${input.buyerMailbox.dmarcMailbox}`
  };

  const returnPath: VisibleRecord = {
    record_type: 'CNAME',
    name: input.buyerMailbox.mailFromSubdomain,
    content: input.buyerMailbox.returnPathCname
  };

  const mxRecords = input.buyerMailbox.mxHosts.map((mx) => ({
    record_type: 'MX' as const,
    name: input.buyerMailbox.mailFromSubdomain,
    content: mx.host,
    priority: mx.priority
  }));

  return [apexSpf, dmarc, returnPath, ...mxRecords];
}

export function decideOrderHandoff(expectedRecords: VisibleRecord[], currentRecords: VisibleRecord[], verified: boolean): 'ready_for_handoff' | 'waiting_on_dns' {
  if (!verified) {
    return 'waiting_on_dns';
  }

  const hasEveryRecord = expectedRecords.every((expected) =>
    currentRecords.some((current) =>
      current.record_type === expected.record_type &&
      current.name === expected.name &&
      current.content === expected.content &&
      (expected.priority === undefined || current.priority === expected.priority)
    )
  );

  return hasEveryRecord ? 'ready_for_handoff' : 'waiting_on_dns';
}

export async function stageMarketplaceCutover(infrai: InfraiClient, rawInput: unknown): Promise<CutoverResult> {
  const input = cutoverRequestSchema.parse(rawInput);

  let zoneId: string;
  try {
    const existing = await infrai.dns.domain.get({ domain: input.sellerDomain });
    zoneId = existing.zone_id;
  } catch (error) {
    if (!(error instanceof InfraiApiError) || error.status !== 404) {
      throw error;
    }

    const created = await infrai.dns.domain.add({
      domain: input.sellerDomain,
      vendor: 'infrai',
      metadata: input.orderId
    });
    zoneId = created.zone_id;
  }

  const expectedRecords = buildMarketplaceRecords(input);

  for (const record of expectedRecords) {
    await infrai.dns.record.upsert({
      zone_id: zoneId,
      record_type: record.record_type,
      name: record.name,
      content: record.content,
      priority: record.priority,
      ttl: 300,
      metadata: input.orderId
    });
  }

  const verifyResult = await infrai.dns.domain.verify({ domain: input.sellerDomain });
  const listed = await infrai.dns.record.list({ zone_id: zoneId });
  const currentRecords: VisibleRecord[] = (listed.records ?? []).map((record) => ({
    record_type: record.record_type ?? '',
    name: record.name ?? '',
    content: record.content ?? '',
    priority: record.priority
  }));

  return {
    orderId: input.orderId,
    sellerDomain: input.sellerDomain,
    zoneId,
    handoff: decideOrderHandoff(expectedRecords, currentRecords, Boolean(verifyResult.verified ?? true)),
    expectedRecords,
    currentRecords
  };
}
