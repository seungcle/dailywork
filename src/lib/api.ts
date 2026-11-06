// 브라우저에서 내부 API를 호출하는 공통 함수
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && e?.code === "UNAUTHENTICATED" && typeof window !== "undefined") window.location.replace("/login");
    throw new ApiError(res.status, e?.code ?? "UNKNOWN", e?.message ?? "요청을 처리하지 못했습니다.", e?.details);
  }
  return data as T;
}
