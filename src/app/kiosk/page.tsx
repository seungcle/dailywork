import { redirect } from "next/navigation";
import { KioskScreen } from "@/components/kiosk/kiosk-screen";
import { currentKiosk } from "@/server/pageAuth";

// 화면도 서버에서 장치 세션을 검증한다. 등록되지 않은 기기는 화면 자체를 받지 못한다.
export default async function KioskPage() {
  const device = await currentKiosk();
  if (!device) redirect("/kiosk/setup");
  return <KioskScreen deviceName={device.name} />;
}
