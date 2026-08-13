import type { Metadata } from "next";
import IpPortTester from "@/components/IpPortTester";

export const metadata: Metadata = {
  title: "IP 端口测试",
  description: "批量测试 IP 或域名的端口连通性，支持 HTTP、HTTPS 与 WebSocket 探测。",
};

export default function IpPortTesterPage() {
  return <IpPortTester />;
}
