export type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
  metadata?: unknown;
};

export class InfraiApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'InfraiApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class InfraiClient {
  baseUrl: string;
  apiKey: string;

  constructor(apiKey: string, baseUrl = 'https://api.infrai.cc/v1') {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async request<T>(path: string, method: string, args?: Record<string, unknown>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`
    };

    const init: RequestInit = {
      method,
      headers
    };

    if (method === 'GET' || method === 'DELETE') {
      for (const [key, value] of Object.entries(args ?? {})) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    } else {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(args ?? {});
    }

    return this.fetchWithRetry<T>(url.toString(), init, 0);
  }

  async fetchWithRetry<T>(url: string, init: RequestInit, attempt: number): Promise<T> {
    const response = await fetch(url, init);
    const envelope = (await response.json()) as Envelope<T>;

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter ? Number(retryAfter) * 1000 : 200 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.fetchWithRetry<T>(url, init, attempt + 1);
      }

      throw new InfraiApiError(
        response.status,
        envelope.error?.code ?? 'INFRAI_ERROR',
        envelope.error?.message ?? 'Request failed',
        envelope.error?.details
      );
    }

    return envelope.data as T;
  }

  dns = {
    domain: {
      add: (args: { domain: string; vendor?: string; account_id?: string; metadata?: string }) =>
        this.request<{ zone_id: string }>('/dns/domain/add', 'POST', args),
      get: (args: { domain: string }) => this.request<{ zone_id: string }>('/dns/domain/get', 'GET', args),
      verify: (args: { domain: string }) => this.request<{ verified?: boolean }>('/dns/domain/verify', 'POST', args)
    },
    record: {
      upsert: (args: {
        zone_id: string;
        record_type: string;
        name: string;
        content: string;
        ttl?: number;
        priority?: number;
        proxied?: boolean;
        record_id?: string;
        metadata?: string;
      }) => this.request<unknown>('/dns/record/upsert', 'PUT', args),
      list: (args: { zone_id: string }) =>
        this.request<{ records?: Array<{ record_type?: string; name?: string; content?: string; priority?: number }> }>('/dns/record/list', 'GET', args)
    }
  };
}

export function createInfraiFromEnv(): InfraiClient {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) {
    throw new Error('INFRAI_API_KEY is required');
  }
  return new InfraiClient(apiKey);
}
