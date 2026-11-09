function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`환경변수 ${name}가 설정되지 않았습니다.`);
  return v;
}
export const env = {
  get databaseUrl() { return required("DATABASE_URL"); },
  get encryptionKey() {
    const key = Buffer.from(required("DATA_ENCRYPTION_KEY"), "base64");
    if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY는 32바이트 base64여야 합니다.");
    return key;
  },
  get secureCookies() { return process.env.NODE_ENV === "production"; },
};
