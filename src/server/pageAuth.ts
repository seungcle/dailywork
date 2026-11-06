import { cookies } from "next/headers";
import { getSql } from "./db";
import { ADMIN_COOKIE, validateAdminSession } from "./adminAuth";
import { KIOSK_COOKIE, validateKioskSession } from "./services/kioskDevices";

// 쿠키를 먼저 읽어야 Next.js가 이 페이지를 요청 시점에 렌더링한다.
// 순서가 바뀌면 빌드 중에 DB 연결을 시도해 환경변수 없는 빌드가 실패한다.
export async function currentAdmin() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return token ? validateAdminSession(getSql(), token) : null;
}
export async function currentKiosk() {
  const token = (await cookies()).get(KIOSK_COOKIE)?.value;
  return token ? validateKioskSession(getSql(), token) : null;
}
