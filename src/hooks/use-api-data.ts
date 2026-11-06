"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type State<T> = { url: string | null; data: T | null; error: string | null };

/**
 * GET 데이터를 불러온다. pollMs를 주면 화면이 보이는 동안 주기적으로 갱신한다.
 * 조건이 바뀌어 새로 불러오는 동안에는 이전 데이터를 유지한다(loading = true).
 */
export function useApiData<T>(url: string | null, opts: { pollMs?: number } = {}) {
  const [state, setState] = useState<State<T>>({ url: null, data: null, error: null });
  const latest = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const target = latest.current;
    if (!target) return;
    try {
      const data = await api<T>(target);
      // 응답이 오기 전에 조건이 바뀌었으면 오래된 응답은 버린다.
      if (latest.current === target) setState({ url: target, data, error: null });
    } catch (e) {
      if (latest.current === target) setState((s) => ({ url: target, data: s.data, error: (e as Error).message }));
    }
  }, []);

  useEffect(() => {
    latest.current = url;
    if (url) void reload();
  }, [url, reload]);

  useEffect(() => {
    if (!opts.pollMs || !url) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, url, reload]);

  return { data: state.data, error: state.error, loading: !!url && state.url !== url, reload };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
