"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toolHref, type ToolGroup } from "@/lib/tools";

const STORAGE_KEY = "tools-site.sidebar-collapsed";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getServerSnapshot() {
  return false;
}

function toggleCollapsed() {
  const next = !getSnapshot();
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // ignore
  }
  listeners.forEach((cb) => cb());
}

function useSidebarCollapsed() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

interface SidebarContextValue {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
});

export function SidebarToggle() {
  const { collapsed, toggle } = useContext(SidebarContext);  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
      title={collapsed ? "展开侧栏" : "折叠侧栏"}
      className="hidden h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 md:inline-flex"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {collapsed ? (
          <path d="M4 6h16M4 12h16M4 18h16" />
        ) : (
          <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
        )}
      </svg>
    </button>
  );
}

export default function AppShell({
  groups,
  children,
}: {
  groups: ToolGroup[];
  children: ReactNode;
}) {
  const collapsed = useSidebarCollapsed();
  const pathname = usePathname();

  return (
    <SidebarContext.Provider value={{ collapsed, toggle: toggleCollapsed }}>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
            <SidebarToggle />
            <Link href="/" className="flex items-center gap-2 text-lg font-semibold">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-sm text-white">
                T
              </span>
              小工具箱
            </Link>
            <span className="ml-auto hidden text-sm text-slate-400 sm:block">
              纯前端运行，数据不离开浏览器
            </span>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-1">
          <aside
            className={`shrink-0 overflow-hidden border-r border-slate-200 bg-white transition-all duration-200 ${
              collapsed ? "w-0 border-r-0" : "w-64"
            }`}
            aria-hidden={collapsed}
          >
            <div className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-64 flex-col overflow-y-auto py-4">
              <nav className="flex-1">
                <Link
                  href="/"
                  className={`mx-2 block rounded-md px-3 py-2 text-sm ${
                    pathname === "/"
                      ? "bg-blue-50 font-medium text-blue-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  首页
                </Link>
                {groups.map((group) => (
                  <section key={group.category} className="mt-4">
                    <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {group.category}
                    </div>
                    <ul>
                      {group.tools.map((tool) => {
                        const active =
                          pathname === toolHref(tool.slug) ||
                          pathname.startsWith(`/${tool.slug}/`);
                        return (
                          <li key={tool.slug}>
                            <Link
                              href={toolHref(tool.slug)}
                              className={`mx-2 block rounded-md px-3 py-2 text-sm transition ${
                                active
                                  ? "bg-blue-50 font-medium text-blue-700"
                                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              }`}
                            >
                              {tool.title}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </nav>
              <div className="mt-4 border-t border-slate-100 px-4 pt-3 text-xs text-slate-400">
                {groups.reduce((n, g) => n + g.tools.length, 0)} 个工具
              </div>
            </div>
          </aside>

          <main className="min-w-0 flex-1">{children}</main>
        </div>

        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-6 text-sm text-slate-400">
            <p>小工具箱 - 纯前端运行，数据不会离开浏览器。</p>
            <p>部署于 Azure Blob 静态网站。</p>
          </div>
        </footer>
      </div>
    </SidebarContext.Provider>
  );
}