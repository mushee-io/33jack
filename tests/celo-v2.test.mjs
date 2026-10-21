import test from "node:test";
import assert from "node:assert/strict";
import { CHAIN_ID, USDC, parseUSDC, prepareUSDC, verifyUSDC } from "../api/_lib/celo-v2.mjs";

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const TX_HASH = "0x" + "a".repeat(64);
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const toTopic = (address) => "0x" + address.slice(2).toLowerCase().padStart(64, "0");

test("Celo chain and native USDC constants", () => {
  assert.equal(CHAIN_ID, 42220);
  assert.equal(USDC.address.toLowerCase(), "0xceba9300f2b948710d2653dd7b07f33a8b32118c");
  assert.equal(USDC.decimals, 6);
});

test("USDC amount validation is exact, never floating point", () => {
  assert.equal(parseUSDC("0.000001"), 1n);
  assert.equal(parseUSDC("12.345678"), 12345678n);
  for (const input of ["0", "-1", "1.0000001", "1e4", "1.2.3", "NaN", ""]) {
    assert.throws(() => parseUSDC(input), undefined, input);
  }
});

test("unsigned transfer request binds exact recipient, amount and optional payer", () => {
  const prepared = prepareUSDC({recipient:RECIPIENT, payer:PAYER, amount:"2.50", requestId:"test-12"});
  assert.equal(prepared.mode, "unsigned_wallet_approval_required");
  assert.equal(prepared.txRequest.from, PAYER);
  assert.equal(prepared.txRequest.to, USDC.address);
  assert.equal(prepared.txRequest.chainId, "0xa4ec");
  assert.equal(prepared.txRequest.data, "0xa9059cbb" + RECIPIENT.slice(2).padStart(64,"0") + (2500000).toString(16).padStart(64,"0"));
  assert.equal(prepared.amountUnits, "2500000");
  assert.equal(prepared.requestId,"test-12");
});

test("invalid recipients and preparation limits fail closed", () => {
  assert.throws(() => prepareUSDC({recipient:"0x" + "0".repeat(40),amount:"1"}));
  assert.throws(() => prepareUSDC({recipient:"evil",amount:"1"}));
  assert.throws(() => prepareUSDC({recipient:RECIPIENT,amount:"101"}));
  assert.throws(() => prepareUSDC({recipient:RECIPIENT,amount:"1",requestId:"white space"}));
});

test("onchain receipt verification requires native USDC event with exact parameters", async () => {
  const originalFetch = global.fetch;
  try {
    let chainId = "0xa4ec";
    let recipient = RECIPIENT;
    global.fetch = async (_url, options) => {
      const input = JSON.parse(options.body);
      const result = input.method === "eth_chainId" ? chainId :
        input.method === "eth_blockNumber" ? "0x66" :
        input.method === "eth_getTransactionReceipt" ? {
          transactionHash:TX_HASH, status:"0x1", blockNumber:"0x64",
          logs:[{address:USDC.address,topics:[TRANSFER_TOPIC,toTopic(PAYER),toTopic(recipient)],data:"0x" + (2500000n).toString(16)}]
        } : null;
      return {ok:true,json:async()=>({result})};
    };
    const valid = await verifyUSDC({txHash:TX_HASH,recipient:RECIPIENT,payer:PAYER,amount:"2.5"});
    assert.equal(valid.ok,true);
    assert.equal(valid.confirmations,3);
    const wrong = await verifyUSDC({txHash:TX_HASH,recipient:"0x3333333333333333333333333333333333333333",payer:PAYER,amount:"2.5"});
    assert.equal(wrong.state,"mismatch");
    recipient = "0x3333333333333333333333333333333333333333";
    const wrongEvent = await verifyUSDC({txHash:TX_HASH,recipient:RECIPIENT,payer:PAYER,amount:"2.5"});
    assert.equal(wrongEvent.ok,false);
    chainId = "0x1";
    await assert.rejects(verifyUSDC({txHash:TX_HASH,recipient:RECIPIENT,amount:"2.5"}), /chain ID mismatch/i);
  } finally { global.fetch=originalFetch; }
});
