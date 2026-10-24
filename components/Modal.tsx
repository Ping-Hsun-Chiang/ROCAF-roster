"use client";

import { useEffect } from "react";

/** 簡易警告視窗（不用瀏覽器 alert，避免阻斷頁面） */
export default function Modal({
  open, title, tone = "warning", onClose, children,
}: {
  open: boolean;
  title: string;
  tone?: "warning" | "info";
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className={`rounded-t-xl px-5 py-3 font-bold text-white ${tone === "warning" ? "bg-red-600" : "bg-emerald-800"}`}>
          {tone === "warning" ? "⚠️ " : ""}{title}
        </div>
        <div className="space-y-2 px-5 py-4 text-sm">{children}</div>
        <div className="flex justify-end border-t border-stone-100 px-5 py-3">
          <button className="btn-primary" onClick={onClose} autoFocus>我知道了</button>
        </div>
      </div>
    </div>
  );
}
