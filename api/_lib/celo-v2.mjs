// 33JACK V2: non-custodial Celo Mainnet USDC intent preparation and proof verification.
// No server private keys, custody, simulated receipts or unrestricted agent signing.
export const CHAIN_ID = 42220;
export const CHAIN_HEX = "0xa4ec";
export const USDC = Object.freeze({
  symbol: "USDC",
  address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
  decimals: 6
});
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const lower = (s) => String(s || "").toLowerCase();

export function address(value, label = "address") {
  if (!ADDRESS_RE.test(String(value || "")) || /^0x0{40}$/i.test(String(value))) {
    throw new Error(`Invalid ${label}: expected a non-zero EVM address`);
  }
  return String(value);
}

export function parseUSDC(value) {
  const input = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(input)) {
    throw new Error("USDC amount must be a positive decimal with at most 6 places");
  }
  const [whole, fraction = ""] = input.split(".");
  const units = BigInt(whole) * 1000000n + BigInt((fraction + "000000").slice(0, 6));
  if (units <= 0n || units > (2n ** 256n - 1n)) throw new Error("Invalid USDC amount");
  return units;
}

function maxUSDC() {
  return parseUSDC(process.env.CELO_MAX_USDC_PER_PAYMENT || "100");
}

export function prepareUSDC(body = {}) {
  const to = address(body.recipient, "recipient");
  const from = body.payer ? address(body.payer, "payer") : undefined;
  const amount = String(body.amount || "").trim();
  const units = parseUSDC(amount);
  if (units > maxUSDC()) throw new Error("Amount exceeds the configured V2 per-payment preparation limit");
  const hexTo = to.slice(2).toLowerCase().padStart(64, "0");
  const hexValue = units.toString(16).padStart(64, "0");
  const requestId = String(body.requestId || "").trim();
  if (requestId && !/^[a-zA-Z0-9_-]{1,64}$/.test(requestId)) {
    throw new Error("requestId must contain 1–64 alphanumeric, underscore or dash characters");
  }
  return {
    chainId: CHAIN_ID,
    asset: USDC,
    recipient: to,
    amount,
    amountUnits: units.toString(),
    requestId: requestId || null,
    mode: "unsigned_wallet_approval_required",
    signing: "wallet_only",
    txRequest: {
      ...(from ? { from } : {}),
      to: USDC.address,
      value: "0x0",
      data: "0xa9059cbb" + hexTo + hexValue,
      chainId: CHAIN_HEX
    },
    warning: "This is an unsigned request. The payer must explicitly review and approve it in their wallet; preparing does not pay anyone."
  };
}

const rpcUrl = () => process.env.CELO_RPC_URL || "https://forno.celo.org";
export async function rpc(method, params = []) {
  const response = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Celo RPC is unavailable");
  const result = await response.json();
  if (result.error) throw new Error("Celo RPC rejected the request");
  return result.result;
}
export async function assertMainnet() {
  const actual = await rpc("eth_chainId");
  if (lower(actual) !== CHAIN_HEX) throw new Error("RPC chain ID mismatch: refusing to trust a non-Celo Mainnet response");
}
export async function verifyUSDC(body = {}) {
  const txHash = String(body.txHash || "").trim();
  if (!HASH_RE.test(txHash)) throw new Error("txHash must be a 32-byte transaction hash");
  const recipient = address(body.recipient, "recipient");
  const payer = body.payer ? address(body.payer, "payer") : null;
  const units = parseUSDC(body.amount);
  await assertMainnet();
  const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
  if (!receipt) return { ok: false, state: "pending", txHash };
  if (lower(receipt.status) !== "0x1") return { ok: false, state: "failed", txHash };
  const transfer = (receipt.logs || []).find((log) =>
    lower(log.address) === lower(USDC.address) &&
    lower(log.topics?.[0]) === TRANSFER_TOPIC &&
    log.topics?.length === 3 &&
    lower("0x" + String(log.topics[2]).slice(-40)) === lower(recipient) &&
    (!payer || lower("0x" + String(log.topics[1]).slice(-40)) === lower(payer)) &&
    typeof log.data === "string" && /^0x[0-9a-fA-F]+$/.test(log.data) &&
    BigInt(log.data) === units
  );
  if (!transfer) {
    return { ok: false, state: "mismatch", txHash, reason: "No matching native USDC Transfer event was found" };
  }
  const currentBlockHex = await rpc("eth_blockNumber");
  const confirmations = BigInt(currentBlockHex) - BigInt(receipt.blockNumber) + 1n;
  return {
    ok: true,
    state: "confirmed",
    chainId: CHAIN_ID,
    txHash,
    explorer: "https://celoscan.io/tx/" + txHash,
    blockNumber: Number(BigInt(receipt.blockNumber)),
    confirmations: Number(confirmations > 0n ? confirmations : 0n),
    asset: USDC.symbol,
    from: "0x" + transfer.topics[1].slice(-40),
    to: recipient,
    amount: String(body.amount),
    amountUnits: units.toString(),
    proof: "native_usdc_transfer_event_on_celo_mainnet"
  };
}
