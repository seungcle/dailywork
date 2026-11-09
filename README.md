# DailyWork

일용직 근무자의 출퇴근, 인력 정보, 일당 정산을 관리하는 사내 웹 시스템입니다.
근무자는 등록된 태블릿에 자기 휴대폰 번호를 입력해 출퇴근하고, 관리자는 웹에서 출석을 확인하고 일당을 정산합니다. 엑셀로 내려받는 기능은 없습니다.

- 기술 스택: Next.js(App Router), TypeScript, Tailwind CSS, shadcn/ui, PostgreSQL(Supabase), Vercel
- 관리자 화면: `/dashboard` · 태블릿 화면: `/kiosk` (등록: `/kiosk/setup`)

## 로컬에서 실행하기

Node.js 22 이상과 Docker가 필요합니다.

```bash
npm install
npm run db:up
cp .env.example .env.local
```

`.env.local`에 `DATA_ENCRYPTION_KEY`(`openssl rand -base64 32`로 생성)와 `DEV_ADMIN_PASSWORD`를 채운 뒤 실행합니다.

```bash
npm run db:migrate
npm run db:seed:dev
npm run dev
```

http://localhost:3000 에서 아이디 `admin`과 `DEV_ADMIN_PASSWORD`로 로그인합니다.

## 테스트

```bash
npm run db:up
npm test
```

테스트는 Docker의 실제 PostgreSQL(`dailywork_test`)에서 돌아가며 실행할 때마다 이 DB를 초기화합니다.

## 관리자 계정 발급

일반 회원가입은 없습니다. 아래 명령을 실행하면 아이디와 비밀번호를 차례로 묻습니다. 비밀번호는 화면에 표시되지 않습니다.

```bash
npm run admin:create
```

## 배포 (Supabase + Vercel)

설계와 전체 절차는 [docs/deploy.md](docs/deploy.md)에 있습니다. `.env.deploy`를 채운 뒤 아래 순서로 실행합니다.

```bash
npm run db:migrate:prod
```

```bash
npm run admin:create:prod
```

```bash
npm run deploy:check
```

## 업무 규칙

- **근무일**: 출근 시점의 한국 날짜입니다. 자정을 넘겨 퇴근해도 출근한 날의 근무와 일당으로 집계합니다.
- **출퇴근 시각**: 항상 서버 시각을 쓰며, 태블릿이 보낸 시각은 받지 않습니다.
- **하루 한 번**: 같은 날 다시 출근할 수 없습니다. 잘못된 기록은 관리자가 삭제한 뒤 다시 등록합니다.
- **퇴근 누락**: 출근 후 최대 근무 시간(24시간)이 지나면 누락으로 표시하고, 관리자가 보정할 때까지 그 근무자의 키오스크 출퇴근을 막습니다.
- **일당**: 최종 일당 = 당일 일당 + 추가 지급액. 당일 일당은 기록을 만들 때의 기본 일당으로 시작하며, 나중에 기본 일당을 바꿔도 과거 기록은 변하지 않습니다.
- **정산 확정**: 관리자가 직접 확정해야 합니다. 퇴근 미입력과 0원 건은 확정에서 제외합니다.
- **확정 후 수정**: 확정을 해제(사유 필수)해야 고칠 수 있으며, DB 트리거로도 막습니다.
- **세금·공제**: 계산하지 않습니다. 모든 금액은 공제 전 금액입니다.

## 구조

```
db/migrations/      스키마, 제약조건, 보호 트리거, RLS
scripts/            마이그레이션, 관리자 발급, 로컬 샘플 데이터
src/app/(admin)/    관리자 화면
src/app/kiosk/      태블릿 화면 (서버에서 장치 세션 검증)
src/app/api/admin/  관리자 API (전부 adminRoute 통과)
src/app/api/kiosk/  키오스크 API (setup 외 전부 kioskRoute 통과)
src/server/         인증, 암호화, 업무 로직
tests/              핵심 시나리오 테스트
```

## 보안 메모

- 앱은 서버에서만 DB에 접속합니다. 모든 테이블에 RLS를 켜고 정책을 두지 않아 Supabase 공개 API로는 접근할 수 없습니다. 브라우저에 Supabase 키를 넣지 마세요.
- 계좌번호와 주민등록번호는 AES-256-GCM으로 암호화해 저장합니다. 주민등록번호는 관리자 상세 화면에 바로 보이고, 계좌번호 원문 조회는 이력에 남습니다. 주소는 평문으로 저장합니다.
- 근무자 삭제는 출근 기록과 키오스크 이력이 없을 때만 됩니다. 기록이 있으면 비활성화를 씁니다.
- 휴대폰 번호와 이름은 조회를 위해 평문으로 저장합니다. 번호 하나는 근무자 한 명만 쓸 수 있습니다.
- 휴대폰 번호만으로 출퇴근하는 구조라 다른 사람의 번호로 대리 출퇴근하는 것은 막지 못합니다(베타 범위).
