export interface DnsProvider {
  id: string;
  name: string;
  url: string;
}

export const DNS_PROVIDERS: DnsProvider[] = [
  { id: "ali", name: "阿里 DNS", url: "https://dns.alidns.com/resolve" },
  {
    id: "cloudflare",
    name: "Cloudflare",
    url: "https://cloudflare-dns.com/dns-query",
  },
  { id: "google", name: "Google", url: "https://dns.google/resolve" },
];

export const DNS_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA"] as const;

export type DnsType = (typeof DNS_TYPES)[number];

export type DnsStatus = "ok" | "empty" | "error";

export interface DnsResult {
  host: string;
  qType: DnsType;
  providerId: string;
  status: DnsStatus;
  records: string[];
  ttl: number;
  latencyMs: number;
  message?: string;
}

export interface DnsTask {
  host: string;
  qType: DnsType;
  providerId: string;
}

export function parseDomains(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,;，；、]+/)
        .map((s) =>
          s
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "")
            .replace(/\/$/, "")
            .replace(/(?<!:):\d+$/, ""),
        )
        .filter((s) => s.length > 0 && !s.startsWith("#")),
    ),
  );
}

export function providerName(id: string): string {
  if (/^https?:\/\//i.test(id)) return id;
  return DNS_PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

export function normalizeEndpoint(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "");
  try {
    const u = new URL(url);
    if (u.pathname === "/" || u.pathname === "") {
      u.pathname = "/resolve";
    }
    return u.toString();
  } catch {
    return "";
  }
}

interface QueryOutcome {
  providerId: string;
  status: DnsStatus;
  records: string[];
  ttl: number;
  latencyMs: number;
  message?: string;
}

async function queryOne(
  host: string,
  qType: DnsType,
  provider: DnsProvider,
  timeoutMs: number,
): Promise<QueryOutcome> {
  const start = performance.now();
  const url = `${provider.url}?name=${encodeURIComponent(host)}&type=${qType}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      return {
        providerId: provider.id,
        status: "error",
        records: [],
        ttl: 0,
        latencyMs: performance.now() - start,
        message: `HTTP ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      Status?: number;
      Answer?: { name?: string; type?: number; TTL?: number; data?: string }[];
    };
    const statusCode = data.Status ?? -1;
    if (statusCode === 0) {
      const answer = Array.isArray(data.Answer) ? data.Answer : [];
      return {
        providerId: provider.id,
        status: answer.length ? "ok" : "empty",
        records: answer.map((a) => String(a.data ?? "")).filter(Boolean),
        ttl: answer.length ? Math.min(...answer.map((a) => a.TTL ?? 0)) : 0,
        latencyMs: performance.now() - start,
      };
    }
    if (statusCode === 3) {
      return {
        providerId: provider.id,
        status: "empty",
        records: [],
        ttl: 0,
        latencyMs: performance.now() - start,
        message: "域名不存在（NXDOMAIN）",
      };
    }
    return {
      providerId: provider.id,
      status: "error",
      records: [],
      ttl: 0,
      latencyMs: performance.now() - start,
      message: `DNS 状态码 ${statusCode}`,
    };
  } catch {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      return {
        providerId: provider.id,
        status: "error",
        records: [],
        ttl: 0,
        latencyMs: timeoutMs,
        message: "超时",
      };
    }
    return {
      providerId: provider.id,
      status: "error",
      records: [],
      ttl: 0,
      latencyMs: performance.now() - start,
      message: "请求失败（网络或 CORS 限制）",
    };
  }
}

async function resolveOne(
  host: string,
  qType: DnsType,
  providerId: "auto" | string,
  timeoutMs: number,
): Promise<DnsResult> {
  let order: DnsProvider[];
  if (/^https?:\/\//i.test(providerId)) {
    const url = normalizeEndpoint(providerId);
    order = url ? [{ id: url, name: url, url }] : [];
  } else if (providerId === "auto") {
    order = [...DNS_PROVIDERS];
  } else {
    const p = DNS_PROVIDERS.find((x) => x.id === providerId);
    order = p ? [p] : [];
  }
  let last: QueryOutcome | null = null;
  for (const provider of order) {
    last = await queryOne(host, qType, provider, timeoutMs);
    if (last.status === "ok") break;
  }
  if (!last) {
    return {
      host,
      qType,
      providerId,
      status: "error",
      records: [],
      ttl: 0,
      latencyMs: 0,
      message: "未知 DNS 服务器",
    };
  }
  return {
    host,
    qType,
    providerId: last.providerId,
    status: last.status,
    records: last.records,
    ttl: last.ttl,
    latencyMs: last.latencyMs,
    message: last.message,
  };
}

export async function runDnsBatch(
  tasks: DnsTask[],
  concurrency: number,
  timeoutMs: number,
  onProgress: (result: DnsResult, index: number) => void,
  shouldStop: () => boolean,
): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < tasks.length) {
      if (shouldStop()) return;
      const i = index++;
      const t = tasks[i];
      const result = await resolveOne(t.host, t.qType, t.providerId, timeoutMs);
      onProgress(result, i);
    }
  };
  const n = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}