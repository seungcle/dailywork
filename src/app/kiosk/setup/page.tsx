import { redirect } from "next/navigation";
import { KioskSetup } from "@/components/kiosk/kiosk-setup";
import { currentKiosk } from "@/server/pageAuth";

export default async function KioskSetupPage() {
  if (await currentKiosk()) redirect("/kiosk");
  return <KioskSetup />;
}
