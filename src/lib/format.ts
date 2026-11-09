// 서버와 브라우저에서 함께 쓰는 표시·변환 함수. 모든 시각은 한국 시간 기준이다.
const TZ = "Asia/Seoul";

const timeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});

function parts(value: string | Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}

export function kstDate(value: string | Date = new Date()) {
  return parts(value).date;
}
export function formatTime(value: string | null | undefined) {
  return value ? timeFmt.format(new Date(value)) : "-";
}
/** 근무일(workDate)과 날짜가 다르면 날짜까지 함께 보여 준다(자정 넘김 표시). */
export function formatClock(value: string | null | undefined, workDate?: string) {
  if (!value) return "-";
  const p = parts(value);
  return workDate && p.date !== workDate ? `${p.date.slice(5).replace("-", "/")} ${p.time}` : p.time;
}
export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const p = parts(value);
  return `${p.date} ${p.time}`;
}
/** ISO 시각 → datetime-local 입력값(한국 시간) */
export function toKstInput(value: string | null | undefined) {
  if (!value) return "";
  const p = parts(value);
  return `${p.date}T${p.time}`;
}
/** datetime-local 입력값(한국 시간) → ISO 시각 */
export function fromKstInput(value: string) {
  return value ? new Date(`${value}:00+09:00`).toISOString() : null;
}
export function formatWon(n: number | null | undefined) {
  return `${(n ?? 0).toLocaleString("ko-KR")}원`;
}
export function formatPhone(p: string | null | undefined) {
  if (!p) return "-";
  if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`;
  if (p.length === 10) return p.startsWith("02") ? `${p.slice(0, 2)}-${p.slice(2, 6)}-${p.slice(6)}` : `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}`;
  if (p.length === 9) return `${p.slice(0, 2)}-${p.slice(2, 5)}-${p.slice(5)}`;
  return p;
}
/** 입력 중인 휴대폰 번호에 하이픈을 넣는다: 01012345678 → 010-1234-5678 */
export function formatPhoneInput(input: string) {
  const d = input.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
/** 주민등록번호 표시: 9001011234567 → 900101-1234567 */
export function formatRrn(r: string | null | undefined) {
  if (!r) return "-";
  return r.length === 13 ? `${r.slice(0, 6)}-${r.slice(6)}` : r;
}
/** 키오스크 화면용 이름 가림: 홍길동 → 홍*동, 이산 → 이* */
export function maskName(name: string) {
  const c = [...name.trim()];
  if (c.length <= 1) return name;
  if (c.length === 2) return `${c[0]}*`;
  return `${c[0]}${"*".repeat(c.length - 2)}${c[c.length - 1]}`;
}
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function normalizePhone(input: unknown): string | null {
  let d = String(input ?? "").replace(/\D/g, "");
  if (!d) return null;
  // 엑셀 숫자 셀에서 앞자리 0이 사라진 휴대폰 번호 복원 (1012345678 → 01012345678)
  if (d.length === 10 && d.startsWith("1")) d = `0${d}`;
  return d;
}
export function parseMoney(input: unknown): number | null {
  if (typeof input === "number") return Number.isInteger(input) && input >= 0 ? input : null;
  const s = String(input ?? "").replace(/[,\s원]/g, "");
  if (s === "") return 0;
  return /^\d+$/.test(s) ? Number(s) : null;
}

const PAIRING_HASH_KEY = "code";
/** 연결 QR에 담는 주소. 코드는 # 뒤에 넣어 서버 로그와 Referer에 남지 않게 한다. */
export function pairingLink(origin: string, code: string) {
  return `${origin}/kiosk/setup#${PAIRING_HASH_KEY}=${encodeURIComponent(code)}`;
}
/** 주소의 # 부분에서 연결 코드를 꺼낸다. 형식이 맞지 않으면 null. */
export function parsePairingHash(hash: string) {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get(PAIRING_HASH_KEY);
  if (!value) return null;
  const code = value.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return /^[2-9A-HJ-NP-Z]{8}$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : null;
}
