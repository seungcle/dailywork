// 관리자 계정 발급: npm run admin:create (운영 DB는 npm run admin:create:prod)
// 아이디와 비밀번호를 차례로 입력받는다. 비밀번호는 화면과 터미널 기록에 남지 않는다.
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { createAdministrator, MIN_PASSWORD_LENGTH } from "@/server/adminAuth";
import { createSql } from "@/server/db";
import { pgCode } from "@/server/errors";

/** 파이프 입력에서도 줄 단위로 읽을 수 있도록 한 번만 만드는 줄 대기열 */
function lineQueue() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];
  const waiters: ((s: string | null) => void)[] = [];
  let closed = false;
  rl.on("line", (l) => { const w = waiters.shift(); if (w) w(l); else lines.push(l); });
  rl.on("close", () => { closed = true; waiters.splice(0).forEach((w) => w(null)); });
  return {
    next: () => new Promise<string | null>((resolve) => {
      if (lines.length) resolve(lines.shift()!);
      else if (closed) resolve(null);
      else waiters.push(resolve);
    }),
    close: () => rl.close(),
  };
}

/** 터미널 입력기. 줄 편집은 readline에 맡기고, 비밀번호를 받는 동안에는 화면 출력만 막는다. */
function terminalPrompter() {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  rl.on("SIGINT", () => { process.stdout.write("\n"); process.exit(130); });
  // 안내 문구는 question으로 넘겨야 한다. 먼저 출력해 두면 readline이 줄을 다시 그리면서 지운다.
  const question = (label: string) => new Promise<string>((resolve) => rl.question(label, resolve));
  return {
    ask: async (label: string) => (await question(label)).trim(),
    askSecret: async (label: string) => {
      const pending = question(label);
      muted = true; // 안내 문구를 그린 뒤부터 입력 내용을 가린다.
      const answer = await pending;
      muted = false;
      process.stdout.write("\n");
      return answer;
    },
    close: () => rl.close(),
  };
}

function pipedPrompter() {
  const queue = lineQueue();
  const read = async (label: string) => {
    process.stdout.write(`${label}\n`);
    const line = await queue.next();
    if (line === null) throw new Error("입력이 끝났습니다.");
    return line;
  };
  return { ask: async (label: string) => (await read(label)).trim(), askSecret: read, close: () => queue.close() };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  console.log(`대상 DB: ${new URL(url).host}`);

  const { ask, askSecret, close } = process.stdin.isTTY ? terminalPrompter() : pipedPrompter();

  let username = "";
  while (!/^\S{2,50}$/.test(username)) {
    username = await ask("아이디: ");
    if (!/^\S{2,50}$/.test(username)) console.log("아이디는 공백 없이 2~50자로 입력해 주세요.");
  }
  const displayName = (await ask(`표시 이름 (비우면 ${username}): `)) || username;

  let password = "";
  for (;;) {
    password = await askSecret(`비밀번호 (${MIN_PASSWORD_LENGTH}자 이상, 화면에 표시되지 않음): `);
    if (password.length < MIN_PASSWORD_LENGTH) { console.log(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`); continue; }
    if ((await askSecret("비밀번호 확인: ")) === password) break;
    console.log("비밀번호가 일치하지 않습니다. 다시 입력해 주세요.");
  }
  close();

  const sql = createSql(url);
  try {
    await createAdministrator(sql, { username, displayName, password });
    console.log(`관리자 ${username} 계정을 만들었습니다.`);
  } catch (e) {
    if (pgCode(e) === "23505") throw new Error(`이미 있는 아이디입니다: ${username}`);
    throw e;
  } finally {
    await sql.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
