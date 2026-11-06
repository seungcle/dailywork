import { z } from "zod";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다.").refine((s) => !Number.isNaN(Date.parse(s)), "날짜 형식이 올바르지 않습니다.");
export const isoTime = z.string().datetime({ offset: true, message: "시각 형식이 올바르지 않습니다." }).transform((s) => new Date(s));
export const workerNumber = z.coerce.number().int().positive().max(99999999);
export const money = z.number({ message: "금액을 숫자로 입력해 주세요." }).int("금액은 원 단위 정수로 입력해 주세요.").min(0, "금액은 0원 이상이어야 합니다.").max(100_000_000, "금액이 너무 큽니다.");
export const uuid = z.string().uuid();
