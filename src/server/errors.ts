/** 사용자에게 그대로 보여 줄 수 있는 업무 오류 */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
    this.name = "AppError";
  }
}
export const notFound = (m = "대상을 찾을 수 없습니다.") => new AppError(404, "NOT_FOUND", m);
export const badRequest = (m: string, details?: unknown) => new AppError(400, "BAD_REQUEST", m, details);
export const conflict = (code: string, m: string, details?: unknown) => new AppError(409, code, m, details);

/** PostgreSQL 오류 코드 확인 */
export function pgCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}
