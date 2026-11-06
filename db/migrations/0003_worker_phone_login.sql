-- 근무자는 키오스크에서 휴대폰 번호로 본인을 찾는다.
-- 번호 하나가 한 사람만 가리켜야 하므로 필수·유일 값으로 강제한다.
ALTER TABLE workers ALTER COLUMN phone SET NOT NULL;
ALTER TABLE workers ADD CONSTRAINT workers_phone_mobile CHECK (phone ~ '^010[0-9]{8}$');
DROP INDEX workers_phone_idx;
CREATE UNIQUE INDEX workers_phone_key ON workers (phone);
