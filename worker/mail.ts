// Sends the /edit login links through Alibaba Cloud DirectMail (邮件推送),
// using its SingleSendMail HTTP API with the RPC (HMAC-SHA1) signature.
//
// Needs ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET as secrets (a RAM
// user with only the AliyunDirectMailFullAccess policy), and in
// wrangler.jsonc the sender address set up in DirectMail (ALIYUN_DM_ACCOUNT)
// and its region (ALIYUN_DM_REGION, e.g. cn-hangzhou or ap-southeast-1).

export interface MailEnv {
  ALIYUN_ACCESS_KEY_ID?: string;
  ALIYUN_ACCESS_KEY_SECRET?: string;
  ALIYUN_DM_ACCOUNT?: string;
  ALIYUN_DM_REGION?: string;
}

const FROM_ALIAS = "Panorama Editorial Directory";

export function mailConfigured(env: MailEnv): boolean {
  return Boolean(env.ALIYUN_ACCESS_KEY_ID && env.ALIYUN_ACCESS_KEY_SECRET && env.ALIYUN_DM_ACCOUNT);
}

export async function sendMail(env: MailEnv, mail: { to: string; subject: string; text: string; html: string }): Promise<void> {
  const region = env.ALIYUN_DM_REGION || "cn-hangzhou";
  const host = region === "cn-hangzhou" ? "dm.aliyuncs.com" : `dm.${region}.aliyuncs.com`;
  const params: Record<string, string> = {
    Action: "SingleSendMail",
    Version: "2015-11-23",
    Format: "JSON",
    RegionId: region,
    AccessKeyId: env.ALIYUN_ACCESS_KEY_ID!,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    AccountName: env.ALIYUN_DM_ACCOUNT!,
    AddressType: "1",
    ReplyToAddress: "false",
    FromAlias: FROM_ALIAS,
    ToAddress: mail.to,
    Subject: mail.subject,
    TextBody: mail.text,
    HtmlBody: mail.html,
  };
  const query = Object.keys(params)
    .sort()
    .map((k) => `${percent(k)}=${percent(params[k])}`)
    .join("&");
  const toSign = `POST&${percent("/")}&${percent(query)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${env.ALIYUN_ACCESS_KEY_SECRET}&`),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign)));
  const signature = btoa(String.fromCharCode(...sig));

  const res = await fetch(`https://${host}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `${query}&Signature=${percent(signature)}`,
  });
  if (!res.ok) console.error(`DirectMail: ${res.status} ${await res.text()}`);
}

// RFC 3986 encoding, as the signature requires (encodeURIComponent leaves
// !'()* alone).
function percent(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
