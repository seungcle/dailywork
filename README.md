# DailyWork

일용직 근무자의 출퇴근, 인력 정보, 일당 정산을 관리하는 사내 웹 시스템입니다.
근무자는 등록된 태블릿에 고유번호를 입력해 출퇴근하고, 관리자는 웹에서 출석을 확인하고 일당을 집계해 Excel로 내려받습니다.

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

## 배포 (Supabase + Vercel)

1. **Supabase 프로젝트 생성**: 리전은 서울(`ap-northeast-2`)을 권장합니다.
2. **스키마 적용**: Session pooler(포트 5432) 또는 Direct 연결 문자열로 실행합니다.
   ```bash
   MIGRATION_DATABASE_URL="<연결 문자열>" npm run db:migrate
   ```
3. **Vercel 환경변수 설정**
   | 이름 | 값 |
   | --- | --- |
   | `DATABASE_URL` | Supabase **Transaction pooler**(포트 6543) 연결 문자열 |
   | `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32`로 만든 운영 전용 키 |
   | `RRN_COLLECTION_ENABLED` | `false` (법적 근거 확인 전까지 유지) |
4. **Vercel 배포**: `vercel.json`에 서울 리전(`icn1`)이 지정되어 있습니다.
5. **첫 관리자 계정 발급**: 일반 회원가입은 없습니다. 비밀번호는 입력 프롬프트로 받습니다.
   ```bash
   DATABASE_URL="<연결 문자열>" DATA_ENCRYPTION_KEY="<운영 키>" npm run admin:create -- <아이디> "<표시 이름>"
   ```
6. **태블릿 연결**: 관리자 화면 > 키오스크 관리에서 코드를 발급하고, 태블릿의 `/kiosk/setup`에 입력합니다.

> `DATA_ENCRYPTION_KEY`를 잃어버리면 저장된 계좌번호와 주민등록번호를 복구할 수 없습니다. 비밀번호 관리 도구 등에 따로 보관하세요.

## 업무 규칙

- **근무일**: 출근 시점의 한국 날짜입니다. 자정을 넘겨 퇴근해도 출근한 날의 근무와 일당으로 집계합니다.
- **출퇴근 시각**: 항상 서버 시각을 쓰며, 태블릿이 보낸 시각은 받지 않습니다.
- **하루 한 번**: 같은 날 다시 출근할 수 없습니다. 잘못된 기록은 관리자가 삭제한 뒤 다시 등록합니다.
- **퇴근 누락**: 출근 후 최대 근무 시간(기본 24시간, 설정에서 변경)이 지나면 누락으로 표시하고, 관리자가 보정할 때까지 그 근무자의 키오스크 출퇴근을 막습니다.
- **일당**: 최종 일당 = 당일 일당 + 추가 지급액. 당일 일당은 기록을 만들 때의 기본 일당으로 시작하며, 나중에 기본 일당을 바꿔도 과거 기록은 변하지 않습니다.
- **정산 확정**: 관리자가 직접 확정해야 합니다. 퇴근 미입력과 0원 건은 확정에서 제외합니다. 지급 자료 Excel에는 확정 금액만 들어갑니다.
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
- 계좌번호와 주민등록번호는 AES-256-GCM으로 암호화해 저장합니다. 원문 조회와 계좌번호가 포함된 Excel 다운로드는 이력에 남습니다.
- 전화번호와 이름은 검색을 위해 평문으로 저장합니다.
- 고유번호만으로 출퇴근하는 구조라 다른 사람의 번호로 대리 출퇴근하는 것은 막지 못합니다(베타 범위).
