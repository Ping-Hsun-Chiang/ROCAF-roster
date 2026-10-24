"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";

const LINKS = [
  { href: "/schedule", label: "每日排哨" },
  { href: "/members", label: "人員名冊" },
];

export default function Nav({ email }: { email: string }) {
  const path = usePathname();
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="font-bold">🪖 站哨排班</span>
        <nav className="flex gap-1">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded-md px-3 py-1.5 text-sm ${path.startsWith(l.href) ? "bg-emerald-800 text-white" : "text-stone-700 hover:bg-stone-100"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-stone-500">
          <span className="hidden sm:inline">{email}</span>
          <button className="btn-ghost" onClick={() => supabase().auth.signOut()}>登出</button>
        </div>
      </div>
    </header>
  );
}
