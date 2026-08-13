export interface ToolEntry {
  slug: string;
  title: string;
  description: string;
  tags: string[];
}

export interface ToolGroup {
  category: string;
  tools: ToolEntry[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    category: "网络",
    tools: [
      {
        slug: "ip-port-tester",
        title: "IP 端口测试",
        description: "批量探测 IP/域名端口连通性，支持并发、超时控制与 CSV 导出。",
        tags: ["网络", "批量"],
      },
      {
        slug: "dns-resolver",
        title: "DNS 批量解析",
        description: "批量查询域名 A / AAAA / CNAME / MX 等记录，支持多家公共 DoH 服务器与自动切换。",
        tags: ["网络", "DNS"],
      },
    ],
  },
];

export const toolHref = (slug: string) => `/${slug}/`;