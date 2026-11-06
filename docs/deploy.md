# Supabase · Vercel 배포 설계와 절차

## 구성

```
태블릿 / 관리자 PC ── HTTPS ──> Vercel (서울 icn1, Next.js)
                                  │ Transaction pooler (6543), TLS
                                  ▼
                               Supabase PostgreSQL (서울 ap-northeast-2)
```

## 설계 결정

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| Supabase 사용 범위 | PostgreSQL만 사용 | 인증, 권한, 업무 규칙은 모두 서버 코드와 DB 제약조건에 있습니다. |
| Supabase Auth | 사용 안 함 | 사전 발급 ID/PW와 태블릿 세션을 자체 테이블로 관리합니다. |
| 공개 API(anon 키) | 차단 | 브라우저가 DB에 직접 접근할 일이 없습니다. 키를 앱에 넣지 않습니다. |
| Realtime, Storage | 사용 안 함 | 출석부는 15초 갱신으로 충분하고, Excel 파일은 저장하지 않습니다. |
| 앱 접속 | Transaction pooler(6543) | 서버리스 함수마다 직접 연결하면 연결 수가 고갈됩니다. 앱은 prepared statement를 끄고 인스턴스당 연결을 3개로 제한합니다. |
| 마이그레이션 접속 | Session pooler(5432) 또는 Direct | 스키마 변경은 트랜잭션 풀러를 거치지 않습니다. |
| 리전 | 서울로 통일 | 개인정보 저장 위치와 응답 속도 때문입니다. Vercel은 `vercel.json`에 지정되어 있습니다. |
| 시간대 | DB는 기본값 그대로 | 근무일 계산은 쿼리에서 `Asia/Seoul`을 명시합니다. |

### 공개 API 차단

Supabase는 `public` 스키마를 공개 API로 노출하고, 새 테이블에 `anon`, `authenticated` 권한을 자동으로 줍니다. 그래서 다음을 모두 적용합니다.

1. 모든 테이블에 RLS를 켜고 정책을 두지 않습니다.
2. 두 역할의 테이블·시퀀스·함수·스키마 권한을 회수합니다(`0002_supabase_lockdown.sql`).
3. 앞으로 만들 테이블에도 자동 권한이 붙지 않게 기본 권한을 회수합니다.

`service_role` 키는 RLS를 우회하므로 어디에도 넣지 않습니다. 테스트는 이 기본 권한 상태를 재현해 돌리고, `npm run deploy:check`가 실제 DB에서 같은 내용을 확인합니다.

### 환경변수

| 이름 | 어디에 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | Vercel, `.env.deploy` | Transaction pooler 연결 문자열 |
| `DATA_ENCRYPTION_KEY` | Vercel, `.env.deploy` | 계좌번호·주민등록번호 암호화 키. 운영 전용 |
| `RRN_COLLECTION_ENABLED` | Vercel, `.env.deploy` | 법적 근거 확인 전까지 `false` |
| `MIGRATION_DATABASE_URL` | `.env.deploy`만 | Session pooler 연결 문자열 |

`DATA_ENCRYPTION_KEY`를 잃어버리면 저장된 계좌번호를 복구할 수 없습니다. 비밀번호 관리 도구에 따로 보관하세요. `.env.deploy`는 Git에 올라가지 않습니다.

## 배포 절차

### 1. Supabase 프로젝트 만들기

서울 리전으로 만들고, DB 비밀번호를 안전하게 보관합니다. 프로젝트 설정에서 Data API를 끌 수 있다면 꺼 두는 것을 권장합니다.

### 2. 운영 값 준비

```bash
cp .env.deploy.example .env.deploy
```

암호화 키를 만듭니다.

```bash
openssl rand -base64 32
```

Supabase의 Connect 화면에서 연결 문자열을 복사해 `.env.deploy`를 채웁니다. 비밀번호에 특수문자가 있으면 URL 인코딩해야 합니다.

### 3. 스키마 적용과 관리자 발급

```bash
npm run db:migrate:prod
```

```bash
npm run admin:create:prod
```

### 4. 점검

```bash
npm run deploy:check
```

DB 상태를 읽기만 하며, 비밀값은 출력하지 않습니다. `점검 통과`가 나와야 합니다.

### 5. Vercel 연결

1. Vercel에서 GitHub 저장소 `seungcle/dailywork`를 Import 합니다. Next.js로 인식되면 빌드 설정은 기본값 그대로 둡니다.
2. Production 브랜치가 `main`인지 확인합니다.
3. 위 표의 Vercel 항목 3개를 **Production 환경에** 넣습니다. Preview 환경에는 운영 값을 넣지 마세요. PR마다 만들어지는 미리보기 주소가 운영 DB에 붙게 됩니다.
4. 배포합니다.

### 6. 배포 후 확인

1. `/kiosk`를 열면 `/kiosk/setup`으로 이동하는지 확인합니다.
2. `/login`에서 관리자로 로그인합니다.
3. 키오스크 관리에서 태블릿을 등록하고, 화면의 QR을 실제 태블릿 카메라로 찍어 연결합니다. 카메라를 쓸 수 없으면 `/kiosk/setup`에 코드를 직접 입력합니다.
4. 근무자를 한 명 등록해 출근, 퇴근을 해 보고 출석부에 반영되는지 봅니다.
5. 태블릿 브라우저의 "홈 화면에 추가"를 쓰면 전체 화면으로 쓸 수 있습니다. 기기에 따라 홈 화면 앱은 브라우저와 로그인 정보를 공유하지 않으니, 앱을 연 뒤 등록 화면이 나오면 코드를 직접 입력해 연결합니다.

## 운영 시 유의점

- **스키마 변경:** `db/migrations`에 새 파일을 추가하고, 앱을 배포하기 전에 `npm run db:migrate:prod`를 실행합니다.
- **백업과 일시 중지:** 자동 백업 범위와 비활성 프로젝트 일시 중지 정책은 Supabase 요금제마다 다릅니다. 운영 전에 현재 요금제의 내용을 확인하세요. 급여 자료를 다루므로 복구 수단을 정해 두는 것이 좋습니다.
- **태블릿 분실:** 키오스크 관리에서 바로 연결을 해제합니다.
