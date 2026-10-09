import assert from "node:assert/strict";
import crypto from "node:crypto";
import agent from "../api/agent.js";
import analyze from "../api/analyze.js";
import approve from "../api/approve.js";
import settle from "../api/settle.js";
import { assignPaymentWorkspace, getOrCreateTelegramWorkspace } from "../api/_lib/db.js";
import { signWeChatLaunch, verifyWeChatLaunch } from "../api/_lib/wechat-auth.js";

process.env.DATABASE_URL = "";
process.env.GROQ_API_KEY = "";
process.env.APPROVAL_HMAC_SECRET = "33jack-wechat-ci-approval-secret-at-least-32-characters";
process.env.WECHAT_TOKEN = "wechat-ci-callback-token";
process.env.WECHAT_APP_ID = "wx33jackci";
process.env.WECHAT_APP_SECRET = "wechat-ci-app-secret";
process.env.WECHAT_ENCODING_AES_KEY = crypto.randomBytes(32).toString("base64").replace(/=$/, "");
process.env.PUBLIC_APP_URL = "https://33jack.example";
delete process.env.WECHAT_REQUIRE_ENCRYPTION;
delete process.env.VERCEL;

function invoke(handler, method, body = undefined, query = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, body, query, headers: {} };
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      setHeader() { return this; },
      send(data) { resolve({ status: this.code, data }); return this; },
      json(data) { resolve({ status: this.code, data }); return this; },
      end(data) { resolve({ status: this.code, data }); return this; }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function invokeRaw(body, query, method = "POST") {
  return new Promise((resolve, reject) => {
    const req = {
      method, query, headers: {},
      async *[Symbol.asyncIterator]() { if (body?.length) yield Buffer.from(body); }
    };
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      setHeader() { return this; },
      send(data) { resolve({ status: this.code, data }); return this; },
      json(data) { resolve({ status: this.code, data }); return this; },
      end(data) { resolve({ status: this.code, data }); return this; }
    };
    Promise.resolve(agent(req, res)).catch(reject);
  });
}

function signedQuery(encrypted = "", extras = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "33jackci";
  const parts = [process.env.WECHAT_TOKEN, timestamp, nonce];
  if (encrypted) parts.push(encrypted);
  const sig = crypto.createHash("sha1").update(parts.sort().join("")).digest("hex");
  return {
    provider: "wechat",
    timestamp, nonce,
    [encrypted ? "msg_signature" : "signature"]: sig,
    ...extras
  };
}

function encrypt(message) {
  const key = Buffer.from(process.env.WECHAT_ENCODING_AES_KEY + "=", "base64");
  const raw = Buffer.from(message, "utf8");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(raw.length);
  const payload = Buffer.concat([
    crypto.randomBytes(16), size, raw, Buffer.from(process.env.WECHAT_APP_ID)
  ]);
  const pad = 32 - (payload.length % 32);
  const padded = Buffer.concat([payload, Buffer.alloc(pad, pad)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

const originalFetch = globalThis.fetch;
const outgoing = [];
globalThis.fetch = async (url, options = {}) => {
  const path = String(url);
  if (path.includes("/cgi-bin/token")) {
    return new Response(JSON.stringify({ access_token: "ci-wechat-access", expires_in: 7200 }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }
  if (path.includes("/cgi-bin/message/custom/send")) {
    outgoing.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  }
  throw new Error("Unexpected external request: " + path);
};

try {
  const echo = "33jack-ci-verified";
  const goodGet = await invoke(agent, "GET", undefined, { ...signedQuery(), echostr: echo });
  assert.equal(goodGet.status, 200);
  assert.equal(goodGet.data, echo);

  const badGet = await invoke(agent, "GET", undefined, {
    ...signedQuery(), signature: "invalid", echostr: echo
  });
  assert.equal(badGet.status, 403);

  const stale = signedQuery();
  stale.timestamp = String(Math.floor(Date.now() / 1000) - 3600);
  const staleGet = await invoke(agent, "GET", undefined, { ...stale, echostr: echo });
  assert.equal(staleGet.status, 403);

  const xml = (id, content = "hello") =>
    `<xml><ToUserName><![CDATA[gh_33jack_ci]]></ToUserName><FromUserName><![CDATA[openid_ci]]></FromUserName><CreateTime>1760000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content}]]></Content><MsgId>${id}</MsgId></xml>`;

  const badPost = await invokeRaw(xml("wxci-bad"), {
    ...signedQuery(), signature: "invalid"
  });
  assert.equal(badPost.status, 401);

  const first = await invokeRaw(xml("wxci-1"), signedQuery());
  assert.equal(first.status, 200);
  assert.equal(first.data, "success");
  assert.equal(outgoing.length, 1);
  assert.match(outgoing[0].text.content, /33Jack on WeChat/);

  const duplicate = await invokeRaw(xml("wxci-1"), signedQuery());
  assert.equal(duplicate.status, 200);
  assert.equal(outgoing.length, 1, "duplicate callback must not send a second response");

  process.env.WECHAT_REQUIRE_ENCRYPTION = "true";
  const blockedPlain = await invokeRaw(xml("wxci-plain-blocked"), signedQuery());
  assert.equal(blockedPlain.status, 401);

  const encryptedEcho = encrypt(echo);
  const getAes = await invoke(agent, "GET", undefined, {
    ...signedQuery(encryptedEcho), echostr: encryptedEcho, encrypt_type: "aes"
  });
  assert.equal(getAes.status, 200);
  assert.equal(getAes.data, echo);

  const cipher = encrypt(xml("wxci-2", "status"));
  const aesPost = await invokeRaw(`<xml><Encrypt><![CDATA[${cipher}]]></Encrypt></xml>`,
    signedQuery(cipher, { encrypt_type: "aes" }));
  assert.equal(aesPost.status, 200);
  assert.equal(outgoing.length, 2);
  assert.match(outgoing[1].text.content, /33Jack status/);

  const wrongAppId = process.env.WECHAT_APP_ID;
  process.env.WECHAT_APP_ID = "wx-mismatched";
  const wrongIdResponse = await invokeRaw(`<xml><Encrypt><![CDATA[${cipher}]]></Encrypt></xml>`,
    signedQuery(cipher, { encrypt_type: "aes" }));
  assert.equal(wrongIdResponse.status, 400);
  process.env.WECHAT_APP_ID = wrongAppId;

  const identity = "wechat:openid_ci";
  const member = await getOrCreateTelegramWorkspace({ id: identity, first_name: "WeChat CI" });
  const rawInvoice = Buffer.from("INVOICE WX-CI-77\\nSupplier: Shenzhen Example Ltd\\nAmount due: GBP 1250\\nTarget: CNY").toString("base64");
  const analysis = await invoke(analyze, "POST", {
    fileName: "wechat-ci-invoice.txt", mimeType: "text/plain",
    fileData: rawInvoice, corridor: "CNY"
  });
  assert.equal(analysis.status, 200);
  await assignPaymentWorkspace(analysis.data.id, member.workspace.id);

  const token = signWeChatLaunch({
    paymentId: analysis.data.id, wechatOpenId: "openid_ci",
    workspaceId: member.workspace.id
  });
  assert.equal(verifyWeChatLaunch(token, analysis.data.id).wechatOpenId, "openid_ci");
  assert.throws(() => verifyWeChatLaunch(token + "tampered"), /signature/);
  assert.throws(() => verifyWeChatLaunch(token, "different-payment"), /match/);

  const review = await invoke(agent, "GET", undefined, {
    provider: "wechat-review", paymentId: analysis.data.id, token
  });
  assert.equal(review.status, 200);
  assert.equal(review.data.workspace.canApprove, true);

  const approved = await invoke(approve, "POST", {
    channel: "wechat", paymentId: analysis.data.id, wechatLaunchToken: token,
    amountUsdg: 1, acknowledgements: {}
  });
  assert.equal(approved.status, 200);
  const priorReceipts = outgoing.length;
  const settled = await invoke(settle, "POST", { approvalToken: approved.data.approvalToken });
  assert.equal(settled.status, 200);
  assert.equal(settled.data.mode, "demo");
  assert.equal(settled.data.wechatReceipt.ok, true);
  assert.equal(outgoing.length, priorReceipts + 1);
  assert.match(outgoing.at(-1).text.content, /33Jack payment complete/);

  const replay = await invoke(settle, "POST", { approvalToken: approved.data.approvalToken });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.wechatReceipt.idempotent, true);
  assert.equal(outgoing.length, priorReceipts + 1);

  const goodSecret = process.env.APPROVAL_HMAC_SECRET;
  delete process.env.WECHAT_REVIEW_SECRET;
  delete process.env.APPROVAL_HMAC_SECRET;
  assert.throws(() => signWeChatLaunch({
    paymentId: "p1", wechatOpenId: "openid_ci", workspaceId: "ws1"
  }), /at least 32 characters/);
  process.env.APPROVAL_HMAC_SECRET = goodSecret;

  console.log("33jack WeChat smoke: plaintext + AES callbacks, dedupe, signed review, approval, receipt PASS");
} finally {
  globalThis.fetch = originalFetch;
}
