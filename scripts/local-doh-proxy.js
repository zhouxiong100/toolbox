/**
 * local-doh-proxy.js — 本地 DNS-over-HTTPS 代理（Google JSON API 风格）
 *
 * 用途：内网 DNS 不支持 DoH 时，在本机起一个 HTTP 服务，
 *      把 DNS 批量解析工具的「自定义」请求转发给内网 DNS（UDP 53）。
 *
 * 用法：
 *   node local-doh-proxy.js [内网DNS IP] [HTTP端口] [DNS端口]
 *   例如：node local-doh-proxy.js 192.168.1.5 8800          （DNS 走标准 53 端口）
 *          node local-doh-proxy.js 127.0.0.1 8800 5353      （DNS 走自定义端口，常用于调试）
 *
 * 然后在工具页「DNS 服务器」选「自定义」，填入：
 *   http://localhost:8800/resolve
 *
 * 说明：
 *   - 浏览器将 http://localhost 视为可信来源，https 站点也可访问，无需证书
 *   - 内网 DNS 需允许本机地址的查询
 *   - 直接解析 DNS 报文，返回真实 TTL，并区分 NXDOMAIN（Status 3）与「有域名无记录」（Status 0）
 */

"use strict";

const dgram = require("dgram");
const http = require("http");

const DNS_SERVER = process.argv[2] || "127.0.0.1";
const PORT = Number(process.argv[3] || 8800);
const DNS_PORT = Number(process.argv[4] || 53);
const QUERY_TIMEOUT = 5000;

const UDP_FAMILY = /[a-fA-F0-9:]+:[a-fA-F0-9:]+/.test(DNS_SERVER) ? "udp6" : "udp4";

const TYPE_CODE = { A: 1, AAAA: 28, CNAME: 5, MX: 15, TXT: 16, NS: 2, SOA: 6 };
const TYPE_NAME = Object.fromEntries(Object.entries(TYPE_CODE).map(([k, v]) => [v, k]));

// ---- DNS 报文编解码 ----

function encodeName(name) {
  const chunks = [];
  for (const label of name.split(".")) {
    const b = Buffer.from(label, "ascii");
    chunks.push(Buffer.from([b.length]), b);
  }
  chunks.push(Buffer.from([0]));
  return Buffer.concat(chunks);
}

function buildQuery(host, qtype) {
  const id = Math.floor(Math.random() * 65536);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // RD=1，标准查询
  header.writeUInt16BE(1, 4); // QDCOUNT=1
  const question = Buffer.concat([
    encodeName(host),
    Buffer.from([0, TYPE_CODE[qtype]]), // QTYPE
    Buffer.from([0, 1]), // QCLASS=IN
  ]);
  return { buf: Buffer.concat([header, question]), id };
}

function readName(buf, start) {
  let pos = start;
  let end = -1;
  const parts = [];
  const visited = new Set();
  while (true) {
    if (pos >= buf.length || visited.has(pos)) throw new Error("bad name");
    visited.add(pos);
    const len = buf[pos];
    if (len === 0) {
      pos++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error("bad pointer");
      if (end === -1) end = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    if (pos + 1 + len > buf.length) throw new Error("label overflow");
    parts.push(buf.toString("ascii", pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return { name: parts.join("."), end: end === -1 ? pos : end };
}

function parseIPv4(buf, start) {
  return `${buf[start]}.${buf[start + 1]}.${buf[start + 2]}.${buf[start + 3]}`;
}

function parseIPv6(buf, start) {
  const words = [];
  for (let i = 0; i < 8; i++) words.push(buf.readUInt16BE(start + i * 2));
  let best = -1;
  let bestLen = 0;
  let cur = -1;
  let curLen = 0;
  for (let i = 0; i < words.length + 1; i++) {
    if (i < words.length && words[i] === 0) {
      if (cur === -1) cur = i;
      curLen++;
    } else {
      if (cur !== -1 && curLen > bestLen) {
        best = cur;
        bestLen = curLen;
      }
      cur = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) {
    return words.map((w) => w.toString(16)).join(":");
  }
  const head = words
    .slice(0, best)
    .map((w) => w.toString(16))
    .join(":");
  const tail = words
    .slice(best + bestLen)
    .map((w) => w.toString(16))
    .join(":");
  return `${head}::${tail}`;
}

function parseRR(buf, start) {
  const owner = readName(buf, start);
  let pos = owner.end;
  if (pos + 10 > buf.length) throw new Error("rr truncated");
  const type = buf.readUInt16BE(pos);
  const ttl = buf.readUInt32BE(pos + 4);
  const rdlength = buf.readUInt16BE(pos + 8);
  const rd = pos + 10;
  const end = rd + rdlength;
  if (end > buf.length) throw new Error("rdata truncated");
  let data;
  switch (type) {
    case 1:
      data = parseIPv4(buf, rd);
      break;
    case 28:
      data = parseIPv6(buf, rd);
      break;
    case 5:
    case 2: {
      const n = readName(buf, rd);
      data = n.name;
      break;
    }
    case 15: {
      const priority = buf.readUInt16BE(rd);
      const ex = readName(buf, rd + 2);
      data = { priority, exchange: ex.name };
      break;
    }
    case 16: {
      const strs = [];
      let p = rd;
      while (p < end) {
        const l = buf[p];
        strs.push(buf.toString("utf8", p + 1, p + 1 + l));
        p += 1 + l;
      }
      data = strs.join("");
      break;
    }
    case 6: {
      const mname = readName(buf, rd);
      const rname = readName(buf, mname.end);
      const base = rname.end;
      data = {
        nsname: mname.name,
        hostmaster: rname.name,
        serial: buf.readUInt32BE(base),
        refresh: buf.readUInt32BE(base + 4),
        retry: buf.readUInt32BE(base + 8),
        expire: buf.readUInt32BE(base + 12),
        minttl: buf.readUInt32BE(base + 16),
      };
      break;
    }
    default:
      data = buf.toString("base64", rd, end);
  }
  return { name: owner.name, type, ttl, data, end };
}

function query(host, qtype) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(UDP_FAMILY);
    const { buf, id: packetId } = buildQuery(host, qtype);
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      fn(val);
    };
    const timer = setTimeout(() => {
      finish(reject, Object.assign(new Error("timeout"), { code: "ETIMEOUT" }));
    }, QUERY_TIMEOUT);
    socket.on("error", (err) => finish(reject, err));
    socket.on("message", (msg) => {
      try {
        if (msg.length < 12) return;
        if (msg.readUInt16BE(0) !== packetId) return;
        const flags = msg.readUInt16BE(2);
        const rcode = flags & 0x000f;
        const qdcount = msg.readUInt16BE(4);
        const ancount = msg.readUInt16BE(6);
        let pos = 12;
        for (let i = 0; i < qdcount; i++) {
          const q = readName(msg, pos);
          pos = q.end + 4;
        }
        const answers = [];
        for (let i = 0; i < ancount; i++) {
          const rr = parseRR(msg, pos);
          pos = rr.end;
          answers.push(rr);
        }
        finish(resolve, { rcode, answers });
      } catch (err) {
        finish(reject, err);
      }
    });
    socket.connect(DNS_PORT, DNS_SERVER, () => {
      socket.send(buf, (err) => {
        if (err) finish(reject, err);
      });
    });
  });
}

function dataToString(qtype, data) {
  switch (qtype) {
    case "MX":
      return `${data.priority} ${data.exchange}`;
    case "SOA":
      return [
        data.nsname,
        data.hostmaster,
        data.serial,
        data.refresh,
        data.retry,
        data.expire,
        data.minttl,
      ].join(" ");
    default:
      return String(data);
  }
}

// ---- HTTP 服务 ----

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/dns-json");

  if (url.pathname !== "/resolve") {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const host = (url.searchParams.get("name") || "").trim().toLowerCase().replace(/\.$/, "");
  const qtype = (url.searchParams.get("type") || "A").toUpperCase();

  if (!host) {
    res.end(JSON.stringify({ Status: 2, Answer: [] }));
    return;
  }
  if (!TYPE_CODE[qtype]) {
    res.end(JSON.stringify({ Status: 2, Answer: [] }));
    return;
  }

  const start = Date.now();
  query(host, qtype).then(
    ({ rcode, answers }) => {
      res.end(
        JSON.stringify({
          Status: rcode,
          Question: [{ name: host, type: TYPE_CODE[qtype] }],
          Answer: answers.map((a) => ({
            name: a.name,
            type: a.type,
            TTL: a.ttl,
            data: dataToString(TYPE_NAME[a.type] || "A", a.data),
          })),
          Comment: rcode === 0 ? null : `${rcode === 3 ? "NXDOMAIN" : "RCODE " + rcode}`,
        }),
      );
    },
    (err) => {
      res.end(
        JSON.stringify({
          Status: 2, // SERVFAIL（含超时）
          Answer: [],
          Comment: `${err.code || "ERROR"} after ${Date.now() - start}ms`,
        }),
      );
    },
  );
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用，请换一个 HTTP 端口：node local-doh-proxy.js ${DNS_SERVER} <新HTTP端口> [DNS端口]`);
  } else {
    console.error(`启动失败：${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log("local-doh-proxy 运行中");
  console.log(`  内网 DNS: ${DNS_SERVER}:${DNS_PORT} (${UDP_FAMILY === "udp6" ? "IPv6" : "IPv4"})`);
  console.log(`  监听:     http://localhost:${PORT}/resolve`);
  console.log(`  在工具页「本机代理（内网 DNS）」中使用，或自定义填入: http://localhost:${PORT}/resolve`);
});
