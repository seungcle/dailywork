-- DailyWork 초기 스키마
-- 앱은 서버에서만 DB에 직접 접속한다. Supabase의 공개 API(anon/authenticated)로는
-- 어떤 테이블도 읽거나 쓸 수 없도록 RLS를 켜고 권한을 회수한다(파일 끝 참고).

-- ── 관리자 ──────────────────────────────────────────
CREATE TABLE administrators (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username           text NOT NULL,
  display_name       text NOT NULL,
  password_hash      text NOT NULL,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  is_active          boolean NOT NULL DEFAULT true,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX administrators_username_key ON administrators (lower(username));

CREATE TABLE admin_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  administrator_id uuid NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
  token_hash       text NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_admin_idx ON admin_sessions (administrator_id);

-- ── 근무자 ──────────────────────────────────────────
CREATE SEQUENCE worker_number_seq START WITH 1001;

CREATE TABLE workers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_number   integer NOT NULL UNIQUE DEFAULT nextval('worker_number_seq') CHECK (worker_number > 0),
  name            text NOT NULL CHECK (length(trim(name)) > 0),
  phone           text CHECK (phone ~ '^[0-9]{9,11}$'),
  base_daily_wage integer NOT NULL DEFAULT 0 CHECK (base_daily_wage BETWEEN 0 AND 100000000),
  rrn_enc         text,
  rrn_hash        text,
  memo            text NOT NULL DEFAULT '',
  is_active       boolean NOT NULL DEFAULT true,
  deactivated_at  timestamptz,
  created_by      uuid REFERENCES administrators(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER SEQUENCE worker_number_seq OWNED BY workers.worker_number;
CREATE INDEX workers_name_idx ON workers (name);
CREATE INDEX workers_phone_idx ON workers (phone);
CREATE INDEX workers_rrn_hash_idx ON workers (rrn_hash) WHERE rrn_hash IS NOT NULL;

-- 계좌는 교체 이력을 남기고 현재 계좌만 하나 유지한다.
CREATE TABLE worker_payment_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id           uuid NOT NULL REFERENCES workers(id),
  bank_name           text NOT NULL,
  account_number_enc  text NOT NULL,
  account_number_hash text NOT NULL,
  account_last4       text NOT NULL,
  account_holder      text NOT NULL,
  is_current          boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  replaced_at         timestamptz
);
CREATE UNIQUE INDEX worker_payment_accounts_current_key ON worker_payment_accounts (worker_id) WHERE is_current;
CREATE INDEX worker_payment_accounts_hash_idx ON worker_payment_accounts (account_number_hash) WHERE is_current;

-- ── 키오스크 ────────────────────────────────────────
CREATE TABLE kiosk_devices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL CHECK (length(trim(name)) > 0),
  pairing_code_hash  text UNIQUE,
  pairing_expires_at timestamptz,
  paired_at          timestamptz,
  revoked_at         timestamptz,
  last_seen_at       timestamptz,
  created_by         uuid REFERENCES administrators(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kiosk_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id  uuid NOT NULL REFERENCES kiosk_devices(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kiosk_sessions_device_idx ON kiosk_sessions (device_id);

-- ── 근무 기록 ───────────────────────────────────────
-- work_date는 출근 시점의 한국 날짜다. 자정을 넘겨 퇴근해도 출근한 날의 근무로 집계한다.
CREATE TABLE work_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id           uuid NOT NULL REFERENCES workers(id),
  work_date           date NOT NULL,
  clock_in_at         timestamptz,
  clock_out_at        timestamptz,
  source              text NOT NULL CHECK (source IN ('kiosk', 'manual')),
  clock_in_device_id  uuid REFERENCES kiosk_devices(id),
  clock_out_device_id uuid REFERENCES kiosk_devices(id),
  note                text NOT NULL DEFAULT '',
  created_by          uuid REFERENCES administrators(id),
  deleted_at          timestamptz,
  deleted_by          uuid REFERENCES administrators(id),
  delete_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_records_time_order CHECK (
    clock_out_at IS NULL OR (clock_in_at IS NOT NULL AND clock_out_at > clock_in_at)
  )
);
-- 같은 근무자는 같은 날 기록을 하나만 가진다.
CREATE UNIQUE INDEX work_records_worker_date_key ON work_records (worker_id, work_date) WHERE deleted_at IS NULL;
-- 같은 근무자는 동시에 두 근무를 진행할 수 없다.
CREATE UNIQUE INDEX work_records_one_open_key ON work_records (worker_id)
  WHERE clock_in_at IS NOT NULL AND clock_out_at IS NULL AND deleted_at IS NULL;
CREATE INDEX work_records_date_idx ON work_records (work_date) WHERE deleted_at IS NULL;

-- 기본 일당(workers)과 날짜별 일당을 분리한다. base_wage는 기록 생성 시점의 스냅샷이다.
CREATE TABLE daily_wages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_record_id uuid NOT NULL UNIQUE REFERENCES work_records(id),
  base_wage      integer NOT NULL CHECK (base_wage BETWEEN 0 AND 100000000),
  actual_wage    integer NOT NULL CHECK (actual_wage BETWEEN 0 AND 100000000),
  extra_pay      integer NOT NULL DEFAULT 0 CHECK (extra_pay BETWEEN 0 AND 100000000),
  final_wage     integer GENERATED ALWAYS AS (actual_wage + extra_pay) STORED,
  note           text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed')),
  confirmed_at   timestamptz,
  confirmed_by   uuid REFERENCES administrators(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_wages_confirm_state CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);
CREATE INDEX daily_wages_status_idx ON daily_wages (status);

-- 출퇴근 시도(거절 포함)와 관리자 보정의 원본 이력. 수정·삭제 불가.
CREATE TABLE attendance_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  worker_id        uuid REFERENCES workers(id),
  worker_number    integer,
  work_record_id   uuid REFERENCES work_records(id),
  event_type       text NOT NULL CHECK (event_type IN ('clock_in', 'clock_out', 'manual_create', 'correction', 'delete')),
  outcome          text NOT NULL CHECK (outcome IN ('success', 'rejected')),
  reject_code      text,
  source           text NOT NULL CHECK (source IN ('kiosk', 'admin')),
  kiosk_device_id  uuid REFERENCES kiosk_devices(id),
  administrator_id uuid REFERENCES administrators(id),
  occurred_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX attendance_events_record_idx ON attendance_events (work_record_id);
CREATE INDEX attendance_events_time_idx ON attendance_events (occurred_at DESC);

-- 변경 이력. 민감정보 원문은 넣지 않는다. 수정·삭제 불가.
CREATE TABLE audit_logs (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  administrator_id uuid REFERENCES administrators(id),
  action           text NOT NULL,
  target_type      text NOT NULL,
  target_id        text,
  before           jsonb,
  after            jsonb,
  reason           text,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id);
CREATE INDEX audit_logs_time_idx ON audit_logs (created_at DESC);

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES administrators(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES ('max_shift_hours', '24');

-- 로그인·연결 코드 입력 시도 제한
CREATE TABLE rate_limits (
  key               text PRIMARY KEY,
  count             integer NOT NULL,
  window_started_at timestamptz NOT NULL
);

-- ── 데이터 보호 트리거 ──────────────────────────────
CREATE FUNCTION dw_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER administrators_touch BEFORE UPDATE ON administrators FOR EACH ROW EXECUTE FUNCTION dw_touch_updated_at();
CREATE TRIGGER workers_touch BEFORE UPDATE ON workers FOR EACH ROW EXECUTE FUNCTION dw_touch_updated_at();
CREATE TRIGGER work_records_touch BEFORE UPDATE ON work_records FOR EACH ROW EXECUTE FUNCTION dw_touch_updated_at();
CREATE TRIGGER daily_wages_touch BEFORE UPDATE ON daily_wages FOR EACH ROW EXECUTE FUNCTION dw_touch_updated_at();

-- 고유번호는 발급 후 바꿀 수 없다.
CREATE FUNCTION dw_worker_number_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.worker_number IS DISTINCT FROM OLD.worker_number THEN
    RAISE EXCEPTION '근무자 고유번호는 변경할 수 없습니다.' USING ERRCODE = 'DW002';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workers_number_immutable BEFORE UPDATE ON workers FOR EACH ROW EXECUTE FUNCTION dw_worker_number_immutable();

-- 확정된 일당은 확정 해제 없이 바꾸거나 지울 수 없다.
CREATE FUNCTION dw_protect_confirmed_wage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'confirmed' THEN
      RAISE EXCEPTION '확정된 일당은 삭제할 수 없습니다.' USING ERRCODE = 'DW001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status = 'confirmed' THEN
    RAISE EXCEPTION '확정된 일당은 수정할 수 없습니다.' USING ERRCODE = 'DW001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER daily_wages_protect BEFORE UPDATE OR DELETE ON daily_wages FOR EACH ROW EXECUTE FUNCTION dw_protect_confirmed_wage();

-- 확정된 일당이 연결된 근무 기록의 시각·날짜·삭제 상태는 바꿀 수 없다.
CREATE FUNCTION dw_protect_confirmed_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.worker_id, NEW.work_date, NEW.clock_in_at, NEW.clock_out_at, NEW.deleted_at)
       IS DISTINCT FROM (OLD.worker_id, OLD.work_date, OLD.clock_in_at, OLD.clock_out_at, OLD.deleted_at)
     AND EXISTS (SELECT 1 FROM daily_wages w WHERE w.work_record_id = OLD.id AND w.status = 'confirmed') THEN
    RAISE EXCEPTION '정산 확정된 근무 기록은 수정할 수 없습니다.' USING ERRCODE = 'DW001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_records_protect BEFORE UPDATE ON work_records FOR EACH ROW EXECUTE FUNCTION dw_protect_confirmed_record();

-- 이력 테이블은 추가만 가능하다.
CREATE FUNCTION dw_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '이력 데이터는 수정하거나 삭제할 수 없습니다.' USING ERRCODE = 'DW003';
END $$;
CREATE TRIGGER attendance_events_append_only BEFORE UPDATE OR DELETE ON attendance_events FOR EACH ROW EXECUTE FUNCTION dw_append_only();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION dw_append_only();

-- ── Supabase 공개 API 차단 ──────────────────────────
ALTER TABLE administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE kiosk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_wages ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;
