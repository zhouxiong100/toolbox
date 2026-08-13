import Link from "next/link";
import { TOOL_GROUPS, toolHref } from "@/lib/tools";

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12">
      <section className="py-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          简洁在线小工具
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-slate-500">
          纯前端实现，数据不离开浏览器。持续添加更多实用工具。
        </p>
      </section>

      {TOOL_GROUPS.map((group) => (
        <section key={group.category} className="mt-10">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            {group.category}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.tools.map((tool) => (
              <Link
                key={tool.slug}
                href={toolHref(tool.slug)}
                className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold group-hover:text-blue-600">
                    {tool.title}
                  </h3>
                  <span aria-hidden>→</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {tool.description}
                </p>
                <div className="mt-4 flex gap-2">
                  {tool.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}