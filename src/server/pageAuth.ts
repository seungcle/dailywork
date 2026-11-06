import { cookies } from "next/headers";
import { getSql } from "./db";
import { ADMIN_COOKIE, validateAdminSession } from "./adminAuth";
import { KIOSK_COOKIE, validateKioskSession } from "./services/kioskDevices";

export async function currentAdmin() {
  return validateAdminSession(getSql(), (await cookies()).get(ADMIN_COOKIE)?.value);
}
export async function currentKiosk() {
  return validateKioskSession(getSql(), (await cookies()).get(KIOSK_COOKIE)?.value);
}
