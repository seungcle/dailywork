import { kstDate } from "@/lib/format";
import { AttendanceBoard } from "./board";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const { date } = await searchParams;
  const valid = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
  return <AttendanceBoard date={valid ? date : kstDate()} />;
}
