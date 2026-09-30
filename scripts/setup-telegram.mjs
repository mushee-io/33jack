const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const base = String(process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || "").trim().replace(/\/$/, "");

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is required");
if (!base || !/^https:\/\//i.test(base)) {
  throw new Error("PUBLIC_APP_URL must be your deployed HTTPS 33Jack URL");
}

const url = `${base}/api/agent?provider=telegram`;
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ["message", "edited_message"]
  })
});
const data = await response.json();
if (!response.ok || data?.ok === false) {
  throw new Error(data?.description || `Telegram setWebhook failed with HTTP ${response.status}`);
}

const infoResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
const info = await infoResponse.json();

console.log("Telegram webhook configured:", url);
console.log(JSON.stringify(info?.result || info, null, 2));


const dashboardUrl = `${base}/telegram-dashboard.html`;
const menuResponse = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    menu_button: {
      type: "web_app",
      text: "Open 33Jack",
      web_app: { url: dashboardUrl }
    }
  })
});
const menuData = await menuResponse.json();
if (!menuResponse.ok || menuData?.ok === false) {
  throw new Error(menuData?.description || `Telegram setChatMenuButton failed with HTTP ${menuResponse.status}`);
}

console.log("Telegram menu button configured:", dashboardUrl);
