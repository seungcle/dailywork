-- 근무자 주소. 암호화하지 않고 평문으로 보관한다.
ALTER TABLE workers ADD COLUMN address text NOT NULL DEFAULT '' CHECK (char_length(address) <= 200);
