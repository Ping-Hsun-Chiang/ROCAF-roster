"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import Nav from "./Nav";

/** 未登入時顯示登入表單；帳號請在 Supabase Dashboard → Authentication → Users 建立 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    return (
      <Centered>
        <h1 className="text-lg font-bold">尚未設定 Supabase</h1>
        <p className="mt-2 text-sm text-stone-600">
          請將 <code>.env.local.example</code> 複製為 <code>.env.local</code>，填入 Supabase 專案的 URL 與 anon key 後重新啟動。
        </p>
      </Centered>
    );
  }
  if (session === undefined) return <Centered>載入中…</Centered>;

  if (!session) {
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setError(null);
      const { error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) setError("登入失敗：" + error.message);
      setBusy(false);
    };
    return (
      <Centered>
        <h1 className="text-lg font-bold">營區站哨排班系統</h1>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input className="input w-full" type="email" placeholder="Email" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
          <input className="input w-full" type="password" placeholder="密碼" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "登入中…" : "登入"}</button>
        </form>
      </Centered>
    );
  }

  return (
    <>
      <Nav email={session.user.email ?? ""} />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-6 shadow-sm">{children}</div>
    </div>
  );
}
