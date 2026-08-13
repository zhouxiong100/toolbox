import type { Metadata } from "next";
import DnsResolver from "@/components/DnsResolver";

export const metadata: Metadata = {
  title: "DNS 批量解析",
  description: "批量查询域名解析记录（A / AAAA / CNAME / MX 等），支持多公共 DoH 服务器。",
};

export default function DnsResolverPage() {
  return <DnsResolver />;
}