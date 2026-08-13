# 小工具箱（tools-site）

纯前端在线小工具网站，基于 Next.js（静态导出），部署到 Azure Blob 静态网站。

## 已包含的工具

- **IP 端口测试**（`/ip-port-tester/`）：批量输入 IP/域名与端口，自动选择 HTTP / HTTPS / WebSocket 方式探测连通性，支持并发、超时控制、结果导出 CSV。
- **DNS 批量解析**（`/dns-resolver/`）：批量查询 A / AAAA / CNAME / MX 等记录，支持公共 DoH（阿里 / Cloudflare / Google）、自定义内网 DoH，以及「本机代理」一键使用内网 DNS。

## 技术方案

- Next.js 16（App Router）+ React 19 + Tailwind CSS 4 + TypeScript
- `output: 'export'` 静态导出，`trailingSlash: true`（生成 `xxx/index.html` 结构，适配 Azure Blob）
- 端口探测全部在浏览器端完成，无后端服务：
  - Web 端口（80/443/8080/8443 等）使用 `fetch`（`no-cors` 模式）
  - 其余端口使用 WebSocket 连接探测
  - 受浏览器安全限制，22/25/53 等黑名单端口无法探测

## 本地开发

```bash
npm install
npm run dev      # http://localhost:3000
```

## 构建

```bash
npm run build    # 静态产物输出到 out/
npm run lint
```

## 内网 DNS 解析（本地 DoH 代理）

浏览器无法发起原生 UDP 53 请求。若内网 DNS 不支持 DoH，可在能访问内网 DNS 的机器上运行本代理脚本，把工具的「本机代理」预设请求转发给内网 DNS：

```bash
# 第一个参数为内网 DNS IP，第二个为监听端口（可选，默认 8800）
node scripts/local-doh-proxy.js 192.168.181.51
```

DNS 解析工具页选择「本机代理（内网 DNS）」即可，请求会发往 `http://localhost:8800/resolve`（浏览器把 `localhost` 视为可信来源，无需证书）。

若内网 DNS 支持 DoH 且有公网可信任证书，也可用「自定义」直接填写其 DoH 地址。

## 部署到 Azure Blob 静态网站

### 前置条件

1. 已安装 [Azure CLI](https://aka.ms/installazurecliwindows) 并登录（`az login`）
2. 一个 Azure 存储账户
3. 在 Azure 门户中为该存储账户启用 **静态网站**：
   - 索引文档名：`index.html`
   - 错误文档路径：`404.html`
4. 当前 Azure 登录用户对该存储账户拥有 **Storage Blob Data Contributor**（或 Owner）角色

### 一键部署

```powershell
.\scripts\deploy-azure.ps1 -StorageAccountName <你的存储账户名>
```

脚本会执行 `az storage blob upload-batch` 将 `out/` 上传到 `$web` 容器（覆盖 + 删除多余文件），完成后输出站点访问地址。

也可以手动执行：

```bash
az storage blob upload-batch \
  --account-name <账户名> \
  --auth-mode login \
  --destination '$web' \
  --source out \
  --overwrite \
  --delete-destination
```

### 说明

- 站点 URL 形如 `https://<账户名>.z<编号>.web.core.windows.net/`
- 因 Azure Blob 静态网站仅对以 `/` 结尾的路径自动返回 `index.html`，本项目的所有内链均带尾斜杠（`trailingSlash: true`）。直接访问 `/ip-port-tester`（无斜杠）会 404，属预期行为
- 如需去除尾斜杠限制、自定义域名与 HTTPS，可在前方接入 Azure CDN / Front Door，并添加规则：对不带文件扩展名且不以 `/` 结尾的请求重写/重定向补上 `/`
- 每次改动后重新 `npm run build` 再运行部署脚本即可

## 添加新工具

1. 在 `src/app/<工具路由>/page.tsx` 新建页面（服务端组件导出 `metadata`，渲染对应的客户端组件）
2. 在 `src/app/page.tsx` 的 `TOOLS` 数组中登记，首页即可展示入口卡片
