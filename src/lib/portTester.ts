export type ProbeMode = "auto" | "http" | "ws";

export type ProbeMethod = "http" | "https" | "ws" | "wss";

export type ProbeStatus = "open" | "closed" | "timeout" | "error";

export interface ProbeResult {
  host: string;
  port: number;
  method: ProbeMethod;
  status: ProbeStatus;
  latencyMs: number;
}

export interface ProbeTask {
  host: string;
  port: number;
  method: ProbeMethod;
}

const HTTP_PORTS = new Set([80, 8080, 8000, 8888, 3000, 5000, 8001, 9000, 9090]);
const HTTPS_PORTS = new Set([443, 8443, 9443]);

export function resolveMethod(port: number, mode: ProbeMode): ProbeMethod {
  if (mode === "http") return HTTPS_PORTS.has(port) ? "https" : "http";
  if (mode === "ws") return "ws";
  if (HTTPS_PORTS.has(port)) return "https";
  if (HTTP_PORTS.has(port)) return "http";
  return "ws";
}

export function parseHosts(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,;，；、]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

export function parsePorts(input: string): number[] {
  const ports = new Set<number>();
  for (const part of input.split(/[\s,;，；、]+/)) {
    const p = part.trim();
    if (!p) continue;
    const range = p.match(/^(\d{1,5})-(\d{1,5})$/);
    if (range) {
      let lo = parseInt(range[1], 10);
      let hi = parseInt(range[2], 10);
      if (lo > hi) [lo, hi] = [hi, lo];
      hi = Math.min(hi, 65535);
      for (let i = lo; i <= hi; i++) ports.add(i);
    } else if (/^\d{1,5}$/.test(p)) {
      const n = parseInt(p, 10);
      if (n >= 1 && n <= 65535) ports.add(n);
    }
  }
  return Array.from(ports).sort((a, b) => a - b);
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function probeHttp(
  host: string,
  port: number,
  method: "http" | "https",
  timeoutMs: number,
): Promise<Pick<ProbeResult, "status" | "latencyMs">> {
  const start = performance.now();
  const url = `${method}://${formatHost(host)}:${port}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(url, {
      mode: "no-cors",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    return { status: "open", latencyMs: performance.now() - start };
  } catch {
    const aborted = controller.signal.aborted;
    if (aborted) return { status: "timeout", latencyMs: timeoutMs };
    return { status: "closed", latencyMs: performance.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

function probeWs(
  host: string,
  port: number,
  secure: boolean,
  timeoutMs: number,
): Promise<Pick<ProbeResult, "status" | "latencyMs">> {
  return new Promise((resolve) => {
    const start = performance.now();
    const url = `${secure ? "wss" : "ws"}://${formatHost(host)}:${port}/`;
    let settled = false;
    let ws: WebSocket;
    const settle = (status: ProbeStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve({ status, latencyMs: performance.now() - start });
    };
    const timer = setTimeout(() => settle("timeout"), timeoutMs);
    try {
      ws = new WebSocket(url);
      ws.onopen = () => settle("open");
      ws.onerror = () => settle("closed");
      ws.onclose = () => {
        if (!settled) settle("closed");
      };
    } catch {
      settle("error");
    }
  });
}

export async function runBatch(
  tasks: ProbeTask[],
  concurrency: number,
  timeoutMs: number,
  onProgress: (result: ProbeResult, index: number) => void,
  shouldStop: () => boolean,
): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < tasks.length) {
      if (shouldStop()) return;
      const i = index++;
      const t = tasks[i];
      const raw =
        t.method === "http" || t.method === "https"
          ? await probeHttp(t.host, t.port, t.method, timeoutMs)
          : await probeWs(t.host, t.port, t.method === "wss", timeoutMs);
      onProgress({ host: t.host, port: t.port, method: t.method, ...raw }, i);
    }
  };
  const n = Math.min(concurrency, tasks.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

export const BROWSER_RESTRICTED_PORTS = [
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 77, 79, 87,
  95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 139,
  143, 179, 389, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554,
  556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659,
  4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
];

export const COMMON_PORTS: { group: string; ports: number[] }[] = [
  { group: "Web", ports: [80, 443, 8080, 8443] },
  { group: "数据库", ports: [1433, 1521, 3306, 5432, 6379, 27017] },
  { group: "远程/管理", ports: [3389, 5985, 22] },
  { group: "其他", ports: [21, 25, 53, 110, 143, 389, 445, 993, 995, 161] },
];
