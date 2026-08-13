"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DNS_PROVIDERS,
  DNS_TYPES,
  normalizeEndpoint,
  parseDomains,
  providerName,
  runDnsBatch,
  type DnsResult,
  type DnsType,
} from "@/lib/dnsResolver";

const STATUS_LABEL: Record<DnsResult["status"], string> = {
  ok: "成功",
  empty: "无记录",
  error: "失败",
};

const STATUS_STYLE: Record<DnsResult["status"], string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  empty: "bg-slate-100 text-slate-600 ring-slate-500/20",
  error: "bg-rose-50 text-rose-700 ring-rose-600/20",
};

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

const LOCAL_PROXY_URL = "http://localhost:8800/resolve";

export default function DnsResolver() {
  const [domainsText, setDomainsText] = useState("example.com\ndns.google");
  const [qType, setQType] = useState<DnsType>("A");
  const [providerId, setProviderId] = useState("auto");
  const [customUrl, setCustomUrl] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [concurrency, setConcurrency] = useState(10);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<DnsResult[]>([]);

  const stopRef = useRef(false);
  const startTimeRef = useRef(0);
  const resultsRef = useRef<DnsResult[]>([]);

  const domains = useMemo(() => parseDomains(domainsText), [domainsText]);
  const taskCount = domains.length;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setElapsed(Math.round((performance.now() - startTimeRef.current) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [running]);

  const start = async () => {
    if (running) return;
    if (domains.length === 0) {
      setError("请至少填写一个域名。");
      return;
    }
    const effectiveProvider =
      providerId === "custom"
        ? normalizeEndpoint(customUrl)
        : providerId === "local"
          ? normalizeEndpoint(LOCAL_PROXY_URL)
          : providerId;
    if (!effectiveProvider) {
      setError("请填写自定义 DNS 服务器地址，例如 https://192.168.1.5:8443/dns-query");
      return;
    }
    setError("");
    setRunning(true);
    setDoneCount(0);
    setElapsed(0);
    stopRef.current = false;
    startTimeRef.current = performance.now();
    resultsRef.current = [];
    setResults([]);
    setTotal(taskCount);

    const tasks = domains.map((host) => ({
      host,
      qType,
      providerId: effectiveProvider,
    }));

    await runDnsBatch(
      tasks,
      Math.min(concurrency, 50),
      Math.min(Math.max(timeoutMs, 1000), 30000),
      (result, index) => {
        resultsRef.current[index] = result;
        setResults(resultsRef.current.filter(Boolean));
        setDoneCount((c) => c + 1);
      },
      () => stopRef.current,
    );

    setRunning(false);
  };

  const stop = () => {
    stopRef.current = true;
  };

  const clear = () => {
    setResults([]);
    setDoneCount(0);
    setTotal(0);
    setElapsed(0);
    resultsRef.current = [];
  };

  const exportCsv = () => {
    if (results.length === 0) return;
    const header = ["域名", "类型", "记录", "TTL", "服务器", "状态", "耗时(ms)"];
    const rows = results.map((r) => [
      r.host,
      r.qType,
      r.status === "ok" ? r.records.join("; ") : r.message ?? "",
      String(r.ttl),
      providerName(r.providerId),
      STATUS_LABEL[r.status],
      String(Math.round(r.latencyMs)),
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) =>
            /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
          )
          .join(","),
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DNS解析结果_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = useMemo(() => {
    const c = { ok: 0, empty: 0, error: 0 };
    for (const r of results) c[r.status]++;
    return c;
  }, [results]);

  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">DNS 批量解析</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          批量查询域名的 A / AAAA / CNAME / MX 等记录。浏览器无法直接发起原生
          DNS 请求，本工具通过公共 DNS-over-HTTPS（DoH）服务完成解析。
        </p>
      </div>

      {/* 原理与限制说明（页面最上方） */}
      <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        <summary className="cursor-pointer font-medium text-slate-700">
          原理与限制说明
        </summary>
        <div className="mt-3 space-y-2 leading-6">
          <p>
            <strong>解析方式：</strong>
            通过公共 DoH（DNS over HTTPS）JSON 接口查询，可选阿里 DNS、
            Cloudflare、Google。「自动」模式按 阿里 → Cloudflare → Google
            的顺序尝试，成功即停止。
          </p>
          <p>
            <strong>内网解析：</strong>
            浏览器无法发起原生 DNS（UDP 53）请求，内网域名需通过
            「自定义」指定支持 DoH 的内网 DNS 服务器，例如
            <code className="mx-1 rounded bg-slate-100 px-1 font-mono text-xs">
              https://192.168.1.5:8443/dns-query
            </code>
            或 nginx / dnsdist 等 DoH 代理。内网域名（如 *.local）无法用公共 DoH 解析。
          </p>
          <p>
            <strong>网络限制：</strong>
            DoH 请求直接发自浏览器，受本机网络环境影响。部分区域可能无法访问
            Google / Cloudflare 的 DoH，可切换到「阿里 DNS」。自签名证书的内网
            DoH 服务器会因证书校验失败而无法访问。
          </p>
        </div>
      </details>

      {/* 设置区（页面上方） */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="qtype">
              记录类型
            </label>
            <select
              id="qtype"
              value={qType}
              onChange={(e) => setQType(e.target.value as DnsType)}
              className={inputCls}
            >
              {DNS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="provider">
              DNS 服务器
            </label>
            <select
              id="provider"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className={inputCls}
            >
              <option value="auto">自动（失败时切换）</option>
              {DNS_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="custom">自定义（内网 DoH）</option>
              <option value="local">本机代理（内网 DNS）</option>
            </select>
            {providerId === "custom" && (
              <input
                className={`${inputCls} mt-2 font-mono`}
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://192.168.1.5:8443/dns-query"
                spellCheck={false}
              />
            )}
            {providerId === "local" && (
              <p className="mt-2 rounded bg-slate-50 px-2 py-1.5 text-xs leading-5 text-slate-500">
                使用 <code className="font-mono">localhost:8800/resolve</code>
                ，需先运行：
                <code className="mt-1 block rounded bg-slate-100 px-1 py-0.5 font-mono">
                  node scripts/local-doh-proxy.js 192.168.181.51
                </code>
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="timeout">
              超时时间（毫秒）
            </label>
            <input
              id="timeout"
              type="number"
              min={1000}
              max={30000}
              step={500}
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="concurrency">
              并发数
            </label>
            <input
              id="concurrency"
              type="number"
              min={1}
              max={50}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className={inputCls}
            />
          </div>
        </div>
      </section>

      {/* 域名输入区 */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-700">
            域名列表（每行一个，支持逗号分隔；自动去掉 http(s):// 前缀）
          </h2>
        </div>
        <textarea
          className={`${inputCls} min-h-40 font-mono`}
          value={domainsText}
          onChange={(e) => setDomainsText(e.target.value)}
          placeholder={"example.com\ndns.google\napi.example.com:8443"}
          spellCheck={false}
        />
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={running}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? "解析中…" : "开始解析"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!running}
          className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
        >
          停止
        </button>
        {!running && results.length > 0 && (
          <>
            <button
              type="button"
              onClick={exportCsv}
              className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              导出 CSV
            </button>
            <button
              type="button"
              onClick={clear}
              className="rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              清空
            </button>
          </>
        )}
        <p className="text-sm text-slate-500">
          共 <span className="font-medium text-slate-700">{domains.length}</span>{" "}
          个域名 ={" "}
          <span className="font-medium text-slate-700">{taskCount}</span> 次查询
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-slate-600">
              已完成{" "}
              <span className="font-semibold text-slate-900">{doneCount}</span>/
              <span>{total}</span>
              {total > 0 && (
                <span className="ml-1 text-slate-400">（{percent}%）</span>
              )}
            </span>
            {running && <span className="text-slate-400">用时 {elapsed}s</span>}
            <span className="flex items-center gap-3">
              <span className="text-emerald-600">成功 {counts.ok}</span>
              <span className="text-slate-500">无记录 {counts.empty}</span>
              <span className="text-rose-600">失败 {counts.error}</span>
            </span>
          </div>
        </div>

        {total > 0 && (
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}

        {results.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            {running ? "正在解析，请稍候…" : "暂无结果，点击「开始解析」运行。"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">域名</th>
                  <th className="px-3 py-2 font-medium">类型</th>
                  <th className="px-3 py-2 font-medium">记录</th>
                  <th className="px-3 py-2 font-medium">TTL</th>
                  <th className="px-3 py-2 font-medium">服务器</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">耗时</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-slate-100 align-top last:border-0"
                  >
                    <td className="px-3 py-2 font-mono">{r.host}</td>
                    <td className="px-3 py-2 font-mono">{r.qType}</td>
                    <td className="px-3 py-2 font-mono whitespace-pre-line">
                      {r.status === "ok"
                        ? r.records.join("\n")
                        : (r.message ?? "—")}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-500">
                      {r.status === "ok" ? r.ttl : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {providerName(r.providerId)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[r.status]}`}
                      >
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-500">
                      {Math.round(r.latencyMs)} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}