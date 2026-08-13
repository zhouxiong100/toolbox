"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMMON_PORTS,
  BROWSER_RESTRICTED_PORTS,
  parseHosts,
  parsePorts,
  resolveMethod,
  runBatch,
  type ProbeMode,
  type ProbeResult,
} from "@/lib/portTester";

const STATUS_LABEL: Record<ProbeResult["status"], string> = {
  open: "开放",
  closed: "关闭",
  timeout: "超时",
  error: "错误",
};

const STATUS_STYLE: Record<ProbeResult["status"], string> = {
  open: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  closed: "bg-rose-50 text-rose-700 ring-rose-600/20",
  timeout: "bg-amber-50 text-amber-700 ring-amber-600/20",
  error: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const METHOD_LABEL: Record<ProbeResult["method"], string> = {
  http: "HTTP",
  https: "HTTPS",
  ws: "WS",
  wss: "WSS",
};

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

interface TargetRow {
  id: number;
  host: string;
  ports: string;
}

let rowSeq = 0;

export default function IpPortTester() {
  const [rows, setRows] = useState<TargetRow[]>([
    { id: rowSeq++, host: "192.168.1.1", ports: "80,443,3389,3306" },
  ]);
  const [activeRowId, setActiveRowId] = useState<number | null>(0);
  const [mode, setMode] = useState<ProbeMode>("auto");
  const [timeoutMs, setTimeoutMs] = useState(3000);
  const [concurrency, setConcurrency] = useState(10);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState<ProbeResult[]>([]);

  const stopRef = useRef(false);
  const startTimeRef = useRef(0);
  const resultsRef = useRef<ProbeResult[]>([]);

  const targets = useMemo(
    () => rows.filter((r) => r.host.trim() && r.ports.trim()),
    [rows],
  );
  const taskCount = useMemo(
    () =>
      targets.reduce((n, r) => n + parseHosts(r.host).length * parsePorts(r.ports).length, 0),
    [targets],
  );

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setElapsed(Math.round((performance.now() - startTimeRef.current) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [running]);

  const addRow = () => {
    setRows((prev) => [...prev, { id: rowSeq++, host: "", ports: "" }]);
  };

  const removeRow = (id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const updateRow = (id: number, field: "host" | "ports", value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const appendPortsToActive = (portsToAdd: number[]) => {
    setRows((prev) => {
      const target =
        prev.find((r) => r.id === activeRowId) ?? prev[prev.length - 1];
      if (!target) return prev;
      const existing = parsePorts(target.ports);
      const merged = Array.from(new Set([...existing, ...portsToAdd])).sort(
        (a, b) => a - b,
      );
      return prev.map((r) => (r.id === target.id ? { ...r, ports: merged.join(",") } : r));
    });
  };

  const start = async () => {
    if (running) return;
    if (targets.length === 0) {
      setError("请至少填写一行：目标地址 + 端口。");
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

    const tasks = [];
    for (const row of targets) {
      for (const host of parseHosts(row.host)) {
        for (const port of parsePorts(row.ports)) {
          tasks.push({ host, port, method: resolveMethod(port, mode) });
        }
      }
    }

    await runBatch(
      tasks,
      Math.min(concurrency, 50),
      Math.min(Math.max(timeoutMs, 500), 30000),
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
    const header = ["目标", "端口", "方式", "状态", "耗时(ms)"];
    const rows = results.map((r) => [
      r.host,
      String(r.port),
      METHOD_LABEL[r.method],
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
    a.download = `端口测试结果_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = useMemo(() => {
    const c = { open: 0, closed: 0, timeout: 0, error: 0 };
    for (const r of results) c[r.status]++;
    return c;
  }, [results]);

  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">IP 端口测试</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          批量探测 IP/域名的端口连通性。纯浏览器运行，自动选择 HTTP、HTTPS 或
          WebSocket 方式：Web 端口用 HTTP(S) 探测，其余端口用 WebSocket 探测。
        </p>
      </div>

      {/* 原理与限制说明（页面最上方） */}
      <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm">
        <summary className="cursor-pointer font-medium text-slate-700">
          原理与限制说明
        </summary>
        <div className="mt-3 space-y-2 leading-6">
          <p>
            <strong>探测方式：</strong>
            对 80、443、8080、8443 等常见 Web 端口使用 HTTP(S) 请求（no-cors
            模式）探测；其余端口使用 WebSocket 连接探测。连接成功判定为
            “开放”，连接被拒绝判定为“关闭”，超时判定为“超时”。
          </p>
          <p>
            <strong>HTTPS 提示：</strong>
            若目标为自签名证书或证书无效，HTTPS 探测可能误判为“关闭”，建议此类目标改用 HTTP 方式。
          </p>
          <p>
            <strong>浏览器限制：</strong>
            受浏览器安全策略限制，以下端口无法通过浏览器直接探测，会显示为“关闭”：
            {BROWSER_RESTRICTED_PORTS.slice(0, 30).join("、")} 等
            （含 22/SSH、25/SMTP、53/DNS、445/SMB）。
          </p>
        </div>
      </details>

      {/* 设置区（页面上方） */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              探测方式
            </span>
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["auto", "自动"],
                  ["http", "仅 HTTP(S)"],
                  ["ws", "仅 WebSocket"],
                ] as [ProbeMode, string][]
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-1.5"
                >
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="accent-blue-600"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="timeout">
              超时时间（毫秒）
            </label>
            <input
              id="timeout"
              type="number"
              min={500}
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

      {/* 目标输入区（表格形式） */}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-700">
            目标列表（每行一个 IP/域名 + 端口）
          </h2>
        </div>

        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <div className="px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            目标地址（IP 或域名）
          </div>
          <div className="px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
            端口
          </div>
          <div aria-hidden />
          {rows.map((row) => (
            <div key={row.id} className="contents">
              <input
                className={`${inputCls} font-mono`}
                value={row.host}
                placeholder="192.168.1.1"
                spellCheck={false}
                onChange={(e) => updateRow(row.id, "host", e.target.value)}
              />
              <input
                className={`${inputCls} font-mono`}
                value={row.ports}
                placeholder="80,443,8000-8005"
                spellCheck={false}
                onFocus={() => setActiveRowId(row.id)}
                onChange={(e) => updateRow(row.id, "ports", e.target.value)}
              />
              <button
                type="button"
                aria-label="删除该行"
                onClick={() => removeRow(row.id)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="mt-3 w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-600"
        >
          + 添加一行
        </button>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          <span className="mr-1 text-xs text-slate-400">
            常用端口（填入当前选中的行）：
          </span>
          {COMMON_PORTS.map((g) => (
            <span
              key={g.group}
              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs"
            >
              <span className="text-slate-500">{g.group}</span>
              {g.ports.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => appendPortsToActive([p])}
                  className="rounded px-1 font-mono text-blue-600 hover:bg-blue-50"
                >
                  {p}
                </button>
              ))}
            </span>
          ))}
        </div>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={start}
          disabled={running}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? "测试中…" : "开始测试"}
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
          共 <span className="font-medium text-slate-700">{targets.length}</span>{" "}
          行目标 ={" "}
          <span className="font-medium text-slate-700">{taskCount}</span> 次探测
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
              <span className="text-emerald-600">开放 {counts.open}</span>
              <span className="text-rose-600">关闭 {counts.closed}</span>
              <span className="text-amber-600">超时 {counts.timeout}</span>
              <span className="text-slate-500">错误 {counts.error}</span>
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
            {running ? "正在测试，请稍候…" : "暂无结果，点击「开始测试」运行。"}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">目标</th>
                  <th className="px-3 py-2 font-medium">端口</th>
                  <th className="px-3 py-2 font-medium">方式</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">耗时</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-3 py-2 font-mono">{r.host}</td>
                    <td className="px-3 py-2 font-mono">{r.port}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {METHOD_LABEL[r.method]}
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