-- 날짜별 일당. 그날 출근한 모든 근무자의 당일 일당이 이 금액이 된다.
CREATE TABLE daily_wage_rates (
  work_date  date PRIMARY KEY,
  wage       integer NOT NULL CHECK (wage BETWEEN 0 AND 100000000),
  updated_by uuid REFERENCES administrators(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE daily_wage_rates ENABLE ROW LEVEL SECURITY;
