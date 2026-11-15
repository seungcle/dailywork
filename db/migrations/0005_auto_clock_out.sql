-- 18:00 자동 퇴근으로 채운 기록인지 표시한다. 야근 모드로 다시 찍으면 false가 된다.
ALTER TABLE work_records ADD COLUMN clock_out_auto boolean NOT NULL DEFAULT false;

-- 태블릿 연결은 7일만 유지한다. 이미 연결된 태블릿도 지금부터 최대 7일로 줄인다.
UPDATE kiosk_sessions SET expires_at = LEAST(expires_at, clock_timestamp() + interval '7 days') WHERE revoked_at IS NULL;
