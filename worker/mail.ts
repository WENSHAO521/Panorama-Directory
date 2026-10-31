// Sends the /edit login links through Alibaba Cloud DirectMail (邮件推送)
// over SMTP (implicit TLS on port 465), using a Workers TCP socket.
//
// Needs the sender address set up in DirectMail (ALIYUN_DM_ACCOUNT, a var)
// and its SMTP password (ALIYUN_SMTP_PASSWORD, a secret; set it under 发信地址
// → SMTP 设置). ALIYUN_SMTP_HOST defaults to the Hangzhou server; DirectMail
// in another region uses its own (e.g. smtpdm-ap-southeast-1.aliyun.com).
import { connect } from "cloudflare:sockets";

export interface MailEnv {
  ALIYUN_DM_ACCOUNT?: string;
  ALIYUN_SMTP_PASSWORD?: string;
  ALIYUN_SMTP_HOST?: string;
  // Only for local testing against a plain-text server.
  ALIYUN_SMTP_PORT?: string;
}

const FROM_ALIAS = "Panorama Editorial Directory";

export function mailConfigured(env: MailEnv): boolean {
  return Boolean(env.ALIYUN_DM_ACCOUNT && env.ALIYUN_SMTP_PASSWORD);
}

export async function sendMail(env: MailEnv, mail: { to: string; subject: string; text: string; html: string }): Promise<void> {
  const port = Number(env.ALIYUN_SMTP_PORT || 465);
  const socket = connect(
    { hostname: env.ALIYUN_SMTP_HOST || "smtpdm.aliyun.com", port },
    { secureTransport: port === 465 ? "on" : "off" },
  );
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // One reply, which may span several "250-..." lines, checked against the
  // code the protocol step expects.
  const reply = async (expect: number): Promise<void> => {
    for (;;) {
      const lines = buffer.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          buffer = lines.slice(i + 1).join("\r\n");
          if (Number(lines[i].slice(0, 3)) !== expect) throw new Error(`SMTP: expected ${expect}, got "${lines[i]}"`);
          return;
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP: connection closed");
      buffer += decoder.decode(value, { stream: true });
    }
  };
  const send = (line: string) => writer.write(new TextEncoder().encode(`${line}\r\n`));

  try {
    await reply(220);
    await send("EHLO profiles.panorama-sg.com");
    await reply(250);
    await send("AUTH LOGIN");
    await reply(334);
    await send(base64(env.ALIYUN_DM_ACCOUNT!));
    await reply(334);
    await send(base64(env.ALIYUN_SMTP_PASSWORD!));
    await reply(235);
    await send(`MAIL FROM:<${env.ALIYUN_DM_ACCOUNT}>`);
    await reply(250);
    await send(`RCPT TO:<${mail.to}>`);
    await reply(250);
    await send("DATA");
    await reply(354);
    await send(message(env.ALIYUN_DM_ACCOUNT!, mail));
    await reply(250);
    await send("QUIT");
  } finally {
    await socket.close().catch(() => undefined);
  }
}

function message(from: string, mail: { to: string; subject: string; text: string; html: string }): string {
  const boundary = `b${crypto.randomUUID().replace(/-/g, "")}`;
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap(base64(body))].join("\r\n");
  // Base64 bodies never start a line with ".", so no dot-stuffing is needed.
  return [
    `From: =?UTF-8?B?${base64(FROM_ALIAS)}?= <${from}>`,
    `To: <${mail.to}>`,
    `Subject: =?UTF-8?B?${base64(mail.subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split("@")[1]}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    part("text/plain", mail.text),
    part("text/html", mail.html),
    `--${boundary}--`,
    ".",
  ].join("\r\n");
}

function base64(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function wrap(s: string): string {
  return s.match(/.{1,76}/g)?.join("\r\n") ?? "";
}
