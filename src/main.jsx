import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bot,
  Building2,
  Coins,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FilePlus2,
  FileText,
  Globe2,
  Landmark,
  LayoutDashboard,
  MessageCircleMore,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UploadCloud,
  WalletCards,
  Zap
} from "lucide-react";
import "./styles.css";

const samplePayments = [
  { company: "Austin Software Inc.", invoice: "US-33018", amount: "$6,250", route: "GBP → USDG → USD", status: "Settled", time: "12 min ago" },
  { company: "Shenzhen Nova Parts", invoice: "CN-44018", amount: "¥42,000", route: "USD → USDG → CNY", status: "Review", time: "1 hr ago" },
  { company: "Bengaluru Cloud Services", invoice: "IN-77104", amount: "₹405,000", route: "USD → USDG → INR", status: "Settled", time: "2 hrs ago" },
  { company: "London Creative Systems", invoice: "GB-11820", amount: "£4,850", route: "USD → USDG → GBP", status: "Review", time: "Yesterday" },
];

const nav = [
  ["Overview", LayoutDashboard],
  ["Agent", Bot],
  ["33Jack Pay", Landmark],
  ["33Jack Crypto", Coins],
  ["33Jack Invoice", FilePlus2],
  ["Payments", CircleDollarSign],
  ["Beneficiaries", WalletCards],
  ["Approvals", ShieldCheck],
];

const steps = [
  ["Invoice received", "AI extracted supplier, amount, due date and banking instructions.", FileText],
  ["Risk checks", "Duplicate scan, beneficiary-change check and missing-field validation.", ShieldCheck],
  ["Route prepared", "Compared settlement options and prepared an exact payment proposal.", RefreshCw],
  ["Approval", "Human approval is bound to amount, beneficiary, route and expiry.", BadgeCheck],
  ["Settlement", "USDG settles on Solana, then the local payout partner completes delivery.", Zap],
  ["Reconciliation", "Payment evidence is matched back to the invoice automatically.", FileCheck2],
];

const subunits = [
  {
    name: "33Jack Pay",
    eyebrow: "STABLECOIN → FIAT",
    description: "Fund with stablecoins, pay approved vendors in their local currency through payout partners.",
    status: "Sandbox route",
    icon: Landmark,
    bullets: ["USDG / USDC / USDT funding", "FX + payout quote", "Local bank delivery", "Receipt + reconciliation"]
  },
  {
    name: "33Jack Crypto",
    eyebrow: "STABLECOIN → STABLECOIN",
    description: "Invoice-led wallet payouts for vendors, contractors and crypto-native teams.",
    status: "Devnet live",
    icon: Coins,
    bullets: ["USDG on Solana", "Exact approval binding", "Wallet settlement", "Onchain proof"]
  },
  {
    name: "33Jack Invoice",
    eyebrow: "INVOICE INTELLIGENCE",
    description: "Create, read and verify payment instructions before either payment rail is used.",
    status: "Live",
    icon: FilePlus2,
    bullets: ["Groq extraction", "Invoice creator", "Risk + duplicate checks", "Payment status"]
  }
];

function Logo() {
  return <div className="brand"><span className="brand-mark">33</span><span>jack</span><i /></div>;
}

function StatusPill({ status }) {
  const tone = status === "Settled" ? "good" : status === "Flagged" ? "bad" : "warn";
  return <span className={"pill " + tone}>{status}</span>;
}

function Metric({ label, value, sub, accent }) {
  return (
    <div className="metric card">
      <div className="metric-top">
        <span>{label}</span>
        {accent && <span className="metric-accent">{accent}</span>}
      </div>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

async function readApiResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      error: response.ok ? "Unexpected server response" : "Server error",
      detail: text || `HTTP ${response.status}`
    };
  }
}

const STABLECOINS = new Set(["USDG", "USDC", "USDT"]);

function formatMoney(value, currency) {
  const amount = Number(value);
  const code = String(currency || "").trim().toUpperCase();
  if (!Number.isFinite(amount)) return value == null ? "—" : String(value);
  if (!code) return amount.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  if (STABLECOINS.has(code)) {
    return `${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${code}`;
  }
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${code}`;
  }
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("33jack UI render error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#070b10",color:"#eef2f7",padding:24}}>
          <div style={{maxWidth:620,border:"1px solid #263246",background:"#0d141d",borderRadius:16,padding:28}}>
            <span className="eyebrow">33JACK RECOVERY</span>
            <h2 style={{margin:"8px 0"}}>The payment view hit a display error.</h2>
            <p style={{color:"#8491a3",fontSize:11,lineHeight:1.6}}>Your stored payment data is still intact. Reload the interface to continue.</p>
            <button className="primary" onClick={() => window.location.reload()}>Reload 33Jack</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function PaymentFlow({ close, onComplete }) {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [stage, setStage] = useState("upload");
  const [settleStep, setSettleStep] = useState(0);
  const [corridor, setCorridor] = useState("USD");
  const [analysis, setAnalysis] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [error, setError] = useState("");
  const [acknowledgements, setAcknowledgements] = useState({
    duplicate: false,
    beneficiary_changed: false,
    suspicious: false
  });

  const result = useMemo(() => {
    if (!analysis) {
      const demo = {
        USD: { supplier: "Austin Software Inc.", amount: "$6,250", funding: "£4,850.00", eta: "20 min est.", source: "GBP" },
        CNY: { supplier: "Shenzhen Nova Parts Ltd", amount: "¥42,000", funding: "$5,900.00", eta: "4 hr est.", source: "USD" },
        INR: { supplier: "Bengaluru Cloud Services Pvt Ltd", amount: "₹405,000", funding: "$4,850.00", eta: "45 min est.", source: "USD" },
        GBP: { supplier: "London Creative Systems Ltd", amount: "£4,850", funding: "$6,250.00", eta: "20 min est.", source: "USD" }
      }[corridor];
      return {
        supplier: demo.supplier,
        amount: demo.amount,
        funding: demo.funding,
        fee: "Calculated at quote",
        eta: demo.eta,
        route: `${demo.source} → USDG/Solana → ${corridor}`,
        risk: { duplicate: false, beneficiary_changed: false, suspicious: false, missing_fields: [] }
      };
    }
    return {
      supplier: analysis.supplier || "Supplier not extracted",
      amount: analysis.destination_amount || "Quoted at execution",
      funding: analysis.source_amount && analysis.source_currency
        ? formatMoney(analysis.source_amount, analysis.source_currency)
        : "Confirm from invoice",
      fee: analysis.route_options?.best?.estimatedFee != null
        ? `£${Number(analysis.route_options.best.estimatedFee).toFixed(2)} est.`
        : "Calculated at quote",
      eta: analysis.route_options?.best?.etaMinutes
        ? `${analysis.route_options.best.etaMinutes} min est.`
        : corridor === "CNY" ? "Same business day" : "< 10 minutes",
      route: analysis.recommended_route || `${analysis.source_currency || "GBP"} → USDG/Solana → ${analysis.destination_currency || corridor}`,
      risk: analysis.risk || {}
    };
  }, [analysis, corridor]);

  function fileToBase64(selected) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(selected);
    });
  }

  async function runAnalysis() {
    setError("");
    setStage("analyzing");
    try {
      let payload;
      if (file) {
        if (file.size > 3.2 * 1024 * 1024) throw new Error("For the live demo, keep invoices under 3.2 MB.");
        payload = {
          fileName: file.name,
          mimeType: file.type || "application/pdf",
          fileData: await fileToBase64(file),
          corridor
        };
      } else {
        const demos = {
          USD: ["Austin Software Inc.", "GBP 4,850"],
          CNY: ["Shenzhen Nova Parts Ltd", "USD 5,900"],
          INR: ["Bengaluru Cloud Services Pvt Ltd", "USD 4,850"],
          GBP: ["London Creative Systems Ltd", "USD 6,250"]
        };
        const [demoSupplier, demoAmount] = demos[corridor];
        const demoText = `INVOICE 33J-DEMO-0926-${corridor}
Supplier: ${demoSupplier}
Amount due: ${demoAmount}
Target payout currency: ${corridor}
Due: 30 September 2026
Beneficiary details: demo account ending 1840
Please settle this approved supplier invoice.`;
        payload = {
          fileName: "33jack_demo_invoice.txt",
          mimeType: "text/plain",
          fileData: btoa(demoText),
          corridor
        };
        setFileName("33jack_demo_invoice.txt");
      }

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.detail || data.error || "Analysis failed");
      setAnalysis(data);
      setStage("review");
    } catch (e) {
      setError(e.message || "Analysis failed");
      setStage("upload");
    }
  }

  async function approve() {
    setError("");
    setStage("settling");
    setSettleStep(1);
    try {
      const paymentId = analysis?.id || "pay_" + Date.now().toString(36);
      const approvalResponse = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentId,
          acknowledgements,
          amountUsdg: 1
        })
      });
      const approval = await readApiResponse(approvalResponse);
      if (!approvalResponse.ok) {
        if (approvalResponse.status === 409 && approval.refreshedPayout) {
          setQuote(approval.refreshedPayout);
          setError("Quote refreshed automatically. Review the updated amount and approve again.");
          return;
        }
        throw new Error(approval.detail || approval.error || "Approval failed");
      }

      setSettleStep(2);
      const response = await fetch("/api/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalToken: approval.approvalToken })
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.detail || data.error || "Settlement failed");
      setSettleStep(3);
      setSettlement({ ...data, approvalMode: approval.mode });
      setTimeout(() => {
        setSettleStep(4);
        setStage("done");
        onComplete?.();
      }, 700);
    } catch (e) {
      setError(e.message || "Settlement failed");
      setStage("review");
    }
  }

  const duplicateKnown = Boolean(result.risk?.duplicate);
  const beneficiaryChanged = Boolean(result.risk?.beneficiary_changed);
  const suspicious = Boolean(result.risk?.suspicious);
  const missing = Array.isArray(result.risk?.missing_fields) ? result.risk.missing_fields : [];

  return (
    <div className="modal-wrap" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">NEW PAYMENT</span>
            <h2>Invoice → settlement</h2>
          </div>
          <button className="icon-btn" onClick={close}>×</button>
        </div>

        {error && <div style={{margin:"14px 24px 0",padding:"10px 12px",border:"1px solid rgba(255,111,125,.25)",borderRadius:10,color:"#ff8994",fontSize:11}}>{error}</div>}

        {stage === "upload" && (
          <div className="flow-body">
            <div className="flow-copy">
              <h3>Give 33jack the invoice.</h3>
              <p>The agent extracts the payment instruction, checks risk, prepares a route and asks for one exact approval.</p>
            </div>
            <label className="dropzone">
              <UploadCloud size={28} />
              <strong>{fileName || "Drop invoice here"}</strong>
              <span>PDF, PNG, JPG, WEBP or TXT · up to 3.2 MB · Groq live analysis</span>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,application/pdf,image/png,image/jpeg,image/webp,text/plain"
                onChange={(e) => {
                  const selected = e.target.files?.[0] || null;
                  setFile(selected);
                  setFileName(selected?.name || "");
                }}
              />
            </label>
            <div className="corridor-row">
              <button className={corridor === "USD" ? "chip active" : "chip"} onClick={() => setCorridor("USD")}>United States · USD</button>
              <button className={corridor === "CNY" ? "chip active" : "chip"} onClick={() => setCorridor("CNY")}>China · CNY</button>
              <button className={corridor === "INR" ? "chip active" : "chip"} onClick={() => setCorridor("INR")}>India · INR</button>
              <button className={corridor === "GBP" ? "chip active" : "chip"} onClick={() => setCorridor("GBP")}>United Kingdom · GBP</button>
            </div>
            <button className="primary wide" onClick={runAnalysis}><Sparkles size={17}/> Analyse invoice <ArrowRight size={17}/></button>
          </div>
        )}

        {stage === "analyzing" && (
          <div className="analyzing">
            <div className="pulse-orb"><Bot size={30}/></div>
            <h3>33jack is checking the payment</h3>
            <p>Extracting invoice · checking payment risk · preparing settlement route</p>
            <div className="progress"><i /></div>
          </div>
        )}

        {stage === "review" && (
          <div className="review-grid">
            <div className="analysis-card">
              <span className="eyebrow">{analysis?.mode === "groq" ? "LIVE GROQ RISK REVIEW" : "DEMO RISK REVIEW"}</span>
              <h3>{fileName || analysis?.invoice_name || "invoice"}</h3>
              <div className="check-list">
                <div className={duplicateKnown ? "warning" : ""}>
                  {duplicateKnown ? <TriangleAlert/> : <CheckCircle2/>}
                  <span><b>{duplicateKnown ? "Possible duplicate detected" : "No duplicate signal in this analysis"}</b><small>{duplicateKnown ? "Stop and compare against payment history before execution." : "Production duplicate detection also compares stored invoice history."}</small></span>
                </div>
                <div className={suspicious ? "warning" : ""}>
                  {suspicious ? <TriangleAlert/> : <CheckCircle2/>}
                  <span><b>{suspicious ? "Suspicious invoice signal" : "Invoice structure parsed"}</b><small>{result.risk?.summary || "33jack extracted the payment instruction and surfaced uncertainty."}</small></span>
                </div>
                <div className={beneficiaryChanged ? "warning" : ""}>
                  {beneficiaryChanged ? <TriangleAlert/> : <CheckCircle2/>}
                  <span><b>{beneficiaryChanged ? "Beneficiary change needs acknowledgement" : "No beneficiary-change claim"}</b><small>{beneficiaryChanged ? "The proposed payment is blocked behind explicit acknowledgement." : "Historical verification is only definitive when beneficiary history is available."}</small></span>
                </div>
                <div className={missing.length ? "warning" : ""}>
                  {missing.length ? <TriangleAlert/> : <CheckCircle2/>}
                  <span><b>{missing.length ? "Missing information" : "Required fields present"}</b><small>{missing.length ? missing.join(", ") : "No missing fields were reported by the current analysis."}</small></span>
                </div>
              </div>
            </div>
            <div className="proposal">
              <span className="eyebrow">EXACT PAYMENT PROPOSAL</span>
              <h3>{result.supplier}</h3>
              <div className="proposal-amount">{result.amount}</div>
              <div className="proposal-lines">
                <p><span>You fund</span><b>{result.funding}</b></p>
                <p><span>Settlement</span><b>Solana · USDG</b></p>
                <p><span>Service + FX</span><b>{result.fee}</b></p>
                <p><span>Delivery target</span><b>{result.eta}</b></p>
              </div>
              <div className="route">
                <span>{analysis?.source_currency || "GBP"}</span><ArrowRight/><span>USDG</span><ArrowRight/><span>{analysis?.destination_currency || corridor}</span>
              </div>
              {duplicateKnown && (
                <label className="ack">
                  <input
                    type="checkbox"
                    checked={acknowledgements.duplicate}
                    onChange={(e) => setAcknowledgements((v) => ({ ...v, duplicate: e.target.checked }))}
                  />
                  I reviewed the duplicate warning and still want to continue.
                </label>
              )}
              {beneficiaryChanged && (
                <label className="ack">
                  <input
                    type="checkbox"
                    checked={acknowledgements.beneficiary_changed}
                    onChange={(e) => setAcknowledgements((v) => ({ ...v, beneficiary_changed: e.target.checked }))}
                  />
                  I acknowledge the beneficiary-detail change.
                </label>
              )}
              {suspicious && (
                <label className="ack">
                  <input
                    type="checkbox"
                    checked={acknowledgements.suspicious}
                    onChange={(e) => setAcknowledgements((v) => ({ ...v, suspicious: e.target.checked }))}
                  />
                  I reviewed the suspicious-invoice warning.
                </label>
              )}
              <button
                className="primary wide"
                onClick={approve}
                disabled={
                  missing.length > 0 ||
                  (duplicateKnown && !acknowledgements.duplicate) ||
                  (beneficiaryChanged && !acknowledgements.beneficiary_changed) ||
                  (suspicious && !acknowledgements.suspicious)
                }
              >
                <ShieldCheck size={17}/> Approve exact payment
              </button>
              <small className="fine">Devnet-ready: real USDG moves only when the server devnet signer, mint and recipient are configured.</small>
            </div>
          </div>
        )}

        {stage === "settling" && (
          <div className="settlement">
            <span className="eyebrow">SOLANA SETTLEMENT</span>
            <h3>Executing approved payment</h3>
            {[
              "Approval locked",
              "USDG settlement submitted on Solana",
              "Settlement response confirmed",
              "Invoice reconciled"
            ].map((s, i) => (
              <div className={"settle-row " + (settleStep > i ? "complete" : settleStep === i ? "current" : "")} key={s}>
                <span>{settleStep > i ? <Check size={15}/> : i + 1}</span>
                <p>{s}</p>
              </div>
            ))}
          </div>
        )}

        {stage === "done" && (
          <div className="done">
            <div className="done-icon"><Check size={32}/></div>
            <span className="eyebrow">{settlement?.mode === "devnet" ? "DEVNET SETTLED" : "DEMO RECONCILED"}</span>
            <h2>Payment complete.</h2>
            <p>{result.supplier} is linked to the settlement record and the invoice now has an auditable payment state.</p>
            <div className="receipt">
              <div><span>Solana settlement</span><b>{settlement?.signature ? settlement.signature.slice(0, 12) + "…" : "Recorded"}</b></div>
              <div><span>Invoice</span><b>{fileName || analysis?.invoice_name || "invoice"}</b></div>
              <div><span>Mode</span><b>{settlement?.mode === "devnet" ? "Solana Devnet" : "Safe demo"}</b></div>
              <div><span>Status</span><b className="green">Matched ✓</b></div>
            </div>
            {settlement?.explorer && <a className="primary wide" href={settlement.explorer} target="_blank" rel="noreferrer" style={{textDecoration:"none",marginBottom:8}}>View on Solana Explorer <ArrowRight size={16}/></a>}
            <button className="secondary wide" onClick={close}>Back to dashboard</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelPreview() {
  const [channel, setChannel] = useState("WhatsApp");
  return (
    <section className="channel-section">
      <div className="section-head">
        <div>
          <span className="eyebrow">ONE OPERATOR · EVERYWHERE</span>
          <h2>Talk to 33jack where work already happens.</h2>
        </div>
        <div className="channel-tabs">
          {["WhatsApp","Telegram","Web"].map((x) => <button key={x} className={channel === x ? "active" : ""} onClick={() => setChannel(x)}>{x}</button>)}
        </div>
      </div>
      <div className="channel-card">
        <div className="chat-head"><div className="avatar">33</div><div><b>33jack Agent</b><small>{channel} · Business account</small></div><span>online</span></div>
        <div className="chat-body">
          <div className="bubble user">Check this supplier invoice and prepare payment if everything is safe.</div>
          <div className="attachment"><FileText size={18}/><span>NovaParts_0926.pdf<small>1.8 MB</small></span></div>
          <div className="bubble bot">
            <b>Review complete.</b><br/>
            Supplier verified. No duplicate found. I detected a beneficiary detail change and need your acknowledgement before payment.
          </div>
          <div className="bubble bot compact">
            <b>Payment proposal</b>
            <p>£4,850 → USDG/Solana → ¥42,000</p>
            <small>Estimated delivery: same business day</small>
          </div>
          <button className="chat-cta">Review securely <ChevronRight size={15}/></button>
        </div>
      </div>
    </section>
  );
}



function SubunitCards({ onOpen }) {
  return (
    <section className="subunit-section">
      <div className="section-head">
        <div>
          <span className="eyebrow">ONE AGENT · THREE OPERATING UNITS</span>
          <h2>33Jack routes the obligation to the right rail.</h2>
        </div>
        <p>Invoice intelligence sits in front. Stablecoin settlement or local-currency payout happens only after deterministic checks and explicit approval.</p>
      </div>
      <div className="subunit-grid">
        {subunits.map((unit) => {
          const Icon = unit.icon;
          return (
            <button className="subunit-card" key={unit.name} onClick={() => onOpen(unit.name)}>
              <div className="subunit-card-top">
                <span className="subunit-icon"><Icon size={20}/></span>
                <span className={"subunit-status " + (unit.status === "Devnet live" || unit.status === "Live" ? "live" : "")}>{unit.status}</span>
              </div>
              <span className="eyebrow">{unit.eyebrow}</span>
              <h3>{unit.name}</h3>
              <p>{unit.description}</p>
              <div className="subunit-bullets">
                {unit.bullets.map((item) => <span key={item}><Check size={12}/>{item}</span>)}
              </div>
              <div className="subunit-open">Open unit <ArrowRight size={14}/></div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PayWorkspace() {
  const [form, setForm] = useState({
    fundingAsset: "USDG",
    fundingAmount: "10000",
    destinationCurrency: "CNY",
    invoiceRef: "NXD-2026-1008",
    beneficiaryName: "Nexora Digital Co., Ltd.",
    bankName: "Bank of China, Shenzhen Branch",
    accountLast4: "5678",
    country: "China"
  });
  const [quote, setQuote] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadHistory() {
    try {
      const response = await fetch("/api/payments?kind=payouts&limit=8");
      const data = await readApiResponse(response);
      if (response.ok) setHistory(Array.isArray(data.payouts) ? data.payouts : []);
    } catch {
      // Keep the payout workspace usable if history is temporarily unavailable.
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  function patch(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setQuote(null);
    setReceipt(null);
    setError("");
  }

  async function requestQuote(e) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    setReceipt(null);
    try {
      const response = await fetch("/api/payout-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundingAsset: form.fundingAsset,
          fundingAmount: Number(form.fundingAmount),
          destinationCurrency: form.destinationCurrency,
          invoiceRef: form.invoiceRef,
          beneficiary: {
            name: form.beneficiaryName,
            bank_name: form.bankName,
            account_last4: form.accountLast4,
            country: form.country
          }
        })
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.detail || data.error || "Quote failed");
      setQuote(data.payout);
    } catch (e) {
      setError(e.message || "Quote failed");
    } finally {
      setBusy(false);
    }
  }

  async function approveAndPay() {
    if (!quote?.id || busy) return;
    setBusy(true);
    setError("");
    try {
      const approvalResponse = await fetch("/api/payout-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId: quote.id })
      });
      const approval = await readApiResponse(approvalResponse);
      if (!approvalResponse.ok) throw new Error(approval.detail || approval.error || "Approval failed");

      const settleResponse = await fetch("/api/payout-settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalToken: approval.approvalToken })
      });
      const settlement = await readApiResponse(settleResponse);
      if (!settleResponse.ok) throw new Error(settlement.detail || settlement.error || "Payout failed");

      setReceipt(settlement.receipt || {
        id: settlement.payout?.receipt_id,
        status: "PAID (SANDBOX)",
        funding: `${settlement.payout?.funding_amount} ${settlement.payout?.funding_asset}`,
        delivered: `${settlement.payout?.destination_amount} ${settlement.payout?.destination_currency}`,
        beneficiary: settlement.payout?.beneficiary?.name,
        reconciled: true
      });
      setQuote(settlement.payout);
      await loadHistory();
    } catch (e) {
      setError(e.message || "Payout failed");
    } finally {
      setBusy(false);
    }
  }

  const q = quote?.quote || null;
  const destinationAmount = Number(quote?.destination_amount || q?.destinationAmount || 0);
  const fundingAmount = Number(quote?.funding_amount || q?.fundingAmount || 0);
  const feeAmount = Number(quote?.fee_amount || q?.feeAmount || 0);
  const exchangeRate = Number(quote?.exchange_rate || q?.exchangeRate || 0);

  return (
    <section className="workspace-page unit-workspace">
      <div className="unit-hero">
        <div>
          <span className="eyebrow">33JACK PAY · STABLECOIN → FIAT</span>
          <h2>Fund in stablecoins. Deliver local currency.</h2>
          <p>33Jack builds the payout instruction, quotes FX and fees, binds approval to the exact beneficiary and amount, then runs the sandbox payout and reconciles the receipt.</p>
        </div>
        <div className="unit-flow">
          <span>USDG / USDC / USDT</span><ArrowRight/><span>33Jack controls</span><ArrowRight/><span>FX + payout adapter</span><ArrowRight/><span>Vendor bank</span>
        </div>
      </div>

      {error && <div className="pay-error">{error}</div>}

      <div className="pay-builder">
        <form className="card pay-form" onSubmit={requestQuote}>
          <div className="pay-form-head">
            <div><span className="eyebrow">PAYOUT INSTRUCTION</span><h3>Prepare vendor payout</h3></div>
            <span className="sandbox-badge">SANDBOX LIVE</span>
          </div>

          <div className="form-split">
            <label>Funding asset
              <select value={form.fundingAsset} onChange={(e) => patch("fundingAsset", e.target.value)}>
                <option>USDG</option><option>USDC</option><option>USDT</option>
              </select>
            </label>
            <label>Funding amount
              <input type="number" min="1" step="0.01" value={form.fundingAmount} onChange={(e) => patch("fundingAmount", e.target.value)}/>
            </label>
          </div>

          <div className="form-split">
            <label>Destination currency
              <select value={form.destinationCurrency} onChange={(e) => patch("destinationCurrency", e.target.value)}>
                <option>CNY</option><option>GBP</option><option>INR</option><option>USD</option>
              </select>
            </label>
            <label>Invoice reference
              <input value={form.invoiceRef} onChange={(e) => patch("invoiceRef", e.target.value)} placeholder="INV-2026-001"/>
            </label>
          </div>

          <div className="pay-divider">Beneficiary bank</div>
          <label>Beneficiary name
            <input value={form.beneficiaryName} onChange={(e) => patch("beneficiaryName", e.target.value)}/>
          </label>
          <label>Bank name
            <input value={form.bankName} onChange={(e) => patch("bankName", e.target.value)}/>
          </label>
          <div className="form-split">
            <label>Account last 4
              <input maxLength={4} value={form.accountLast4} onChange={(e) => patch("accountLast4", e.target.value.replace(/\D/g, "").slice(0,4))}/>
            </label>
            <label>Country
              <input value={form.country} onChange={(e) => patch("country", e.target.value)}/>
            </label>
          </div>

          <button className="primary wide" disabled={busy}>
            <RefreshCw size={16}/>{busy ? " Preparing…" : " Get / refresh quote"}
          </button>
          <small className="fine">Sandbox only: this stage does not convert stablecoins or transmit fiat through a bank.</small>
        </form>

        <div className="card pay-quote">
          {!quote ? (
            <div className="pay-placeholder">
              <Landmark size={30}/>
              <span className="eyebrow">EXACT PAYOUT QUOTE</span>
              <h3>Route, FX, fee and received amount appear here.</h3>
              <p>The quote becomes immutable once approved. Any change requires a fresh quote.</p>
            </div>
          ) : receipt ? (
            <div className="pay-receipt">
              <div className="done-icon"><Check size={30}/></div>
              <span className="eyebrow">PAYOUT RECONCILED</span>
              <h3>{receipt.status}</h3>
              <div className="receipt">
                <div><span>Receipt</span><b>{receipt.id}</b></div>
                <div><span>Funding</span><b>{receipt.funding}</b></div>
                <div><span>Delivered</span><b>{receipt.delivered}</b></div>
                <div><span>Beneficiary</span><b>{receipt.beneficiary}</b></div>
                <div><span>Bank</span><b>{receipt.bank || form.bankName}</b></div>
                <div><span>Status</span><b className="green">{receipt.reconciled ? "Matched ✓" : "Processing"}</b></div>
              </div>
              <p className="sandbox-note">This receipt proves the 33Jack approval → payout adapter → reconciliation workflow. No real fiat was transmitted.</p>
            </div>
          ) : (
            <>
              <div className="pay-form-head">
                <div><span className="eyebrow">EXACT PAYOUT QUOTE</span><h3>{quote.beneficiary?.name}</h3></div>
                <span className="sandbox-badge">15 MIN QUOTE</span>
              </div>
              <div className="pay-big-amount">
                <small>Vendor receives</small>
                <strong>{destinationAmount.toLocaleString(undefined, {maximumFractionDigits:2})} {quote.destination_currency}</strong>
              </div>
              <div className="proposal-lines">
                <p><span>You fund</span><b>{fundingAmount.toLocaleString()} {quote.funding_asset}</b></p>
                <p><span>Reference FX</span><b>1 USD = {exchangeRate} {quote.destination_currency}</b></p>
                <p><span>Service + FX</span><b>{feeAmount.toFixed(2)} {quote.funding_asset}</b></p>
                <p><span>Delivery target</span><b>{q?.eta || "same business day"}</b></p>
                <p><span>Bank</span><b>{quote.beneficiary?.bank_name} · ••••{quote.beneficiary?.account_last4}</b></p>
                <p><span>Invoice</span><b>{quote.invoice_ref || "No reference"}</b></p>
              </div>
              <div className="route">
                <span>{quote.funding_asset}</span><ArrowRight/><span>33Jack</span><ArrowRight/><span>{quote.destination_currency}</span><ArrowRight/><span>Bank</span>
              </div>
              <div className="pay-action-row">
                <button type="button" className="secondary" onClick={requestQuote} disabled={busy}>
                  <RefreshCw size={16}/> Refresh quote
                </button>
                <button type="button" className="primary" onClick={approveAndPay} disabled={busy}>
                  <ShieldCheck size={16}/>{busy ? " Processing…" : " Approve exact payout"}
                </button>
              </div>
              <small className="fine">Approval is HMAC-bound to funding amount, FX quote, fee, destination amount and beneficiary.</small>
            </>
          )}
        </div>
      </div>

      <div className="card payout-history">
        <div className="card-head">
          <div><span className="eyebrow">33JACK PAY LEDGER</span><h3>Recent fiat payout simulations</h3></div>
          <span className="sandbox-badge">NEON PERSISTED</span>
        </div>
        {history.length ? history.map((p) => (
          <div className="payout-history-row" key={p.id}>
            <span><b>{p.beneficiary?.name || "Beneficiary"}</b><small>{p.invoice_ref || p.id}</small></span>
            <span><b>{Number(p.funding_amount).toLocaleString()} {p.funding_asset}</b><small>funding</small></span>
            <span><b>{Number(p.destination_amount).toLocaleString()} {p.destination_currency}</b><small>destination</small></span>
            <span className="status-raw">{String(p.status || "").replaceAll("_", " ")}</span>
          </div>
        )) : <div className="empty-records">No fiat payout simulations yet.</div>}
      </div>
    </section>
  );
}


function CryptoWorkspace({ onNewPayment }) {
  return (
    <section className="workspace-page unit-workspace">
      <div className="unit-hero">
        <div>
          <span className="eyebrow">33JACK CRYPTO · STABLECOIN → STABLECOIN</span>
          <h2>Stablecoin payouts for vendors, contractors and crypto-native teams.</h2>
          <p>Upload the obligation, verify the destination wallet, approve the exact payment and settle with an auditable onchain receipt.</p>
          <button className="primary" onClick={onNewPayment}><Coins size={16}/> New stablecoin payment</button>
        </div>
        <div className="unit-flow">
          <span>Invoice</span><ArrowRight/><span>Risk + approval</span><ArrowRight/><span>USDG</span><ArrowRight/><span>Solana wallet</span>
        </div>
      </div>
      <div className="unit-panels">
        <div className="card unit-panel live-panel">
          <span className="eyebrow">LIVE DEVNET RAIL</span>
          <h3>USDG · Solana Token-2022</h3>
          <p>Server-side signer, exact approval binding, transaction signature persistence and reconciliation are already implemented.</p>
          <div className="rail-badges"><span>USDG</span><span>Solana Devnet</span><span>Token-2022</span><span>Explorer proof</span></div>
        </div>
        <div className="card unit-panel">
          <span className="eyebrow">NEXT ASSETS</span>
          <h3>Keep the treasury stablecoin-only.</h3>
          <p>USDC and USDT can be added behind the same settlement interface without turning 33Jack into a general volatile-crypto payment app.</p>
        </div>
      </div>
    </section>
  );
}

function InvoiceWorkspace({ onNewPayment }) {
  const [draft, setDraft] = useState({
    supplier: "Nova Systems Ltd",
    customer: "Mushee Labs",
    amount: "5000",
    currency: "USD",
    dueDate: "2026-10-10",
    description: "Engineering services"
  });
  const [invoiceNumber] = useState(() => "33J-" + Date.now().toString(36).toUpperCase());
  const total = Number(draft.amount || 0);

  return (
    <section className="workspace-page unit-workspace">
      <div className="section-head">
        <div><span className="eyebrow">33JACK INVOICE</span><h2>Create a payment-ready invoice.</h2></div>
        <p>The creator generates a structured instruction that can feed directly back into 33Jack Pay or 33Jack Crypto.</p>
      </div>
      <div className="invoice-builder">
        <div className="card invoice-form">
          <label>Supplier<input value={draft.supplier} onChange={(e) => setDraft({...draft, supplier:e.target.value})}/></label>
          <label>Bill to<input value={draft.customer} onChange={(e) => setDraft({...draft, customer:e.target.value})}/></label>
          <div className="form-split">
            <label>Amount<input type="number" value={draft.amount} onChange={(e) => setDraft({...draft, amount:e.target.value})}/></label>
            <label>Currency<select value={draft.currency} onChange={(e) => setDraft({...draft, currency:e.target.value})}><option>USD</option><option>GBP</option><option>CNY</option><option>INR</option><option>USDC</option><option>USDG</option><option>USDT</option></select></label>
          </div>
          <label>Due date<input type="date" value={draft.dueDate} onChange={(e) => setDraft({...draft, dueDate:e.target.value})}/></label>
          <label>Description<textarea value={draft.description} onChange={(e) => setDraft({...draft, description:e.target.value})}/></label>
          <button className="primary" onClick={onNewPayment}><ArrowRight size={15}/> Use this instruction in payment flow</button>
        </div>
        <div className="invoice-preview">
          <div className="invoice-preview-head"><Logo/><span>PAYMENT-READY</span></div>
          <div className="invoice-preview-title"><span>INVOICE</span><b>{invoiceNumber}</b></div>
          <div className="invoice-party"><small>FROM</small><strong>{draft.supplier || "Supplier"}</strong></div>
          <div className="invoice-party"><small>BILL TO</small><strong>{draft.customer || "Customer"}</strong></div>
          <div className="invoice-line"><span>{draft.description || "Services"}</span><b>{draft.currency} {total.toLocaleString()}</b></div>
          <div className="invoice-total"><span>TOTAL DUE</span><strong>{draft.currency} {total.toLocaleString()}</strong></div>
          <div className="invoice-meta"><span>Due {draft.dueDate || "—"}</span><span>33Jack tag · {invoiceNumber}</span></div>
          <div className="invoice-note">Generated as a structured payment instruction. Settlement still requires beneficiary verification and explicit approval.</div>
        </div>
      </div>
    </section>
  );
}

function AgentWorkspace() {
  const [messages, setMessages] = useState([
    { role: "agent", text: "Ask me about payment risk, failures, suppliers, or what needs attention. I am read-only here; money movement stays behind the structured approval flow." }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function askAgent(e) {
    e?.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setMessages((m) => [...m, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.detail || data.error || "Agent failed");
      setMessages((m) => [...m, { role: "agent", text: data.answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "agent", text: "I could not read the finance state right now: " + (e.message || "unknown error") }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace-page">
      <div className="section-head">
        <div>
          <span className="eyebrow">33JACK OPERATOR</span>
          <h2>Ask the business finance state.</h2>
        </div>
        <p>Read-only reasoning over stored payments, risk flags and beneficiary history. Execution stays in the controlled payment flow.</p>
      </div>
      <div className="agent-console card">
        <div className="agent-transcript">
          {messages.map((m, i) => (
            <div key={i} className={"operator-message " + m.role}>
              <span>{m.role === "agent" ? "33" : "YOU"}</span>
              <p>{m.text}</p>
            </div>
          ))}
          {busy && <div className="operator-message agent"><span>33</span><p>Checking live 33jack state…</p></div>}
        </div>
        <form className="operator-input" onSubmit={askAgent}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What payments need my attention?"
            maxLength={2000}
          />
          <button className="primary" disabled={busy || !input.trim()}><Send size={16}/> Ask</button>
        </form>
      </div>
    </section>
  );
}

function RecordsWorkspace({ type, payments, onNewPayment }) {
  const [beneficiaries, setBeneficiaries] = useState([]);

  useEffect(() => {
    if (type !== "Beneficiaries") return;
    fetch("/api/beneficiaries")
      .then((r) => r.json())
      .then((d) => setBeneficiaries(Array.isArray(d.beneficiaries) ? d.beneficiaries : []))
      .catch(() => setBeneficiaries([]));
  }, [type]);

  if (type === "Beneficiaries") {
    return (
      <section className="workspace-page">
        <div className="section-head">
          <div><span className="eyebrow">BENEFICIARY REGISTRY</span><h2>Known supplier payout profiles.</h2></div>
          <p>Profiles are created after successful settlement and only retain limited payout fingerprints such as bank name and last four characters.</p>
        </div>
        <div className="card records-card">
          <div className="records-head"><span>Supplier</span><span>Currency</span><span>Bank / Handle</span><span>Last seen</span></div>
          {beneficiaries.length ? beneficiaries.map((b) => (
            <div className="records-row" key={b.id || b.supplier_name + b.destination_currency}>
              <span><b>{b.supplier_name}</b><small>{b.country || "—"}</small></span>
              <span>{b.destination_currency || "—"}</span>
              <span>{b.bank_name || b.payment_handle || "—"}{b.account_last4 ? " · ••••" + b.account_last4 : ""}</span>
              <span>{b.last_seen_at ? new Date(b.last_seen_at).toLocaleString() : "—"}</span>
            </div>
          )) : <div className="empty-records">No verified beneficiary history yet.</div>}
        </div>
      </section>
    );
  }

  const filtered = type === "Approvals"
    ? payments.filter((p) => ["analyzed", "failed"].includes(String(p.status || "")))
    : payments;

  return (
    <section className="workspace-page">
      <div className="section-head">
        <div>
          <span className="eyebrow">{type.toUpperCase()}</span>
          <h2>{type === "Approvals" ? "Payments waiting for a decision." : "Live finance records."}</h2>
        </div>
        <button className="primary" onClick={onNewPayment}><Plus size={16}/> New payment</button>
      </div>
      <div className="card records-card">
        <div className="records-head"><span>Supplier / Invoice</span><span>Amount</span><span>Status</span><span>Route</span></div>
        {filtered.length ? filtered.map((p) => (
          <div className="records-row" key={p.id}>
            <span><b>{p.supplier || "Unknown supplier"}</b><small>{p.invoice_number || p.invoice_name || p.id}</small></span>
            <span>{p.source_amount && p.source_currency ? formatMoney(p.source_amount, p.source_currency) : p.destination_amount || "—"}</span>
            <span className="status-raw">{String(p.status || "unknown").replaceAll("_", " ")}</span>
            <span>{p.route || "Route pending"}</span>
          </div>
        )) : <div className="empty-records">No records in this view yet.</div>}
      </div>
    </section>
  );
}

function App() {
  const [active, setActive] = useState("Overview");
  const [flow, setFlow] = useState(false);
  const [livePayments, setLivePayments] = useState([]);
  const [persistence, setPersistence] = useState("loading");

  async function refreshPayments() {
    try {
      const response = await fetch("/api/payments?limit=25");
      const data = await readApiResponse(response);
      if (!response.ok) return;
      setLivePayments(Array.isArray(data.payments) ? data.payments : []);
      setPersistence(data.persistence || "unknown");
    } catch {
      setPersistence("unavailable");
    }
  }

  useEffect(() => {
    refreshPayments();
  }, []);

  const dashboardPayments = livePayments.length
    ? livePayments.map((p) => ({
        company: p.supplier || "Unknown supplier",
        invoice: p.invoice_number || p.invoice_name || p.id,
        amount: p.source_amount && p.source_currency
          ? formatMoney(p.source_amount, p.source_currency)
          : p.destination_amount || "—",
        route: p.route || "Route pending",
        status:
          p.status === "settled_devnet" || p.status === "settled_demo" ? "Settled"
          : p.status === "approved" || p.status === "settling" ? "Review"
          : p.risk?.duplicate || p.risk?.beneficiary_changed || p.risk?.suspicious ? "Flagged"
          : "Review",
        time: p.created_at ? new Date(p.created_at).toLocaleString() : "Recorded"
      }))
    : samplePayments;

  const settledCount = livePayments.filter((p) => String(p.status).startsWith("settled_")).length;
  const flaggedCount = livePayments.filter((p) => p.risk?.duplicate || p.risk?.beneficiary_changed || p.risk?.suspicious).length;

  return (
    <div className="app">
      <aside>
        <Logo/>
        <nav>
          {nav.map(([label, Icon]) => (
            <button key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)}>
              <Icon size={18}/><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-agent">
          <div className="mini-orb"><Sparkles size={15}/></div>
          <b>33jack Agent</b>
          <p>Ready to prepare payments and investigate exceptions.</p>
          <button onClick={() => setFlow(true)}>Ask agent</button>
        </div>
        <div className="profile"><div>IN</div><span><b>Mushee Labs</b><small>Business workspace</small></span></div>
      </aside>

      <main>
        <header>
          <div className="search"><Search size={16}/><input placeholder="Search invoices, suppliers, payments…"/></div>
          <div className="header-actions">
            <span className="network-dot">● Solana</span>
            <button className="secondary"><MessageCircleMore size={17}/> Channels</button>
            <button className="primary" onClick={() => setFlow(true)}><Plus size={17}/> New payment</button>
          </div>
        </header>

        <div className="content">
          {active === "Overview" ? <>
          <section className="hero">
            <div>
              <span className="eyebrow">AUTONOMOUS FINANCE OPERATOR</span>
              <h1>Move business forward.<br/><em>33jack handles the money work.</em></h1>
              <p>Verify invoices, catch risk, prepare the best cross-border route, execute with approval and reconcile automatically.</p>
              <div className="hero-actions">
                <button className="primary big" onClick={() => setFlow(true)}><Sparkles size={18}/> Run payment demo</button>
                <span><ShieldCheck size={16}/> Human-approved execution</span>
              </div>
            </div>
            <div className="hero-orbit">
              <div className="orbit-core"><span>33</span><small>AI OPERATOR</small></div>
              <div className="orbit-label a">INVOICE</div>
              <div className="orbit-label b">USDG</div>
              <div className="orbit-label c">SOLANA</div>
              <div className="orbit-label d">LOCAL PAYOUT</div>
            </div>
          </section>

          <SubunitCards onOpen={setActive}/>

          <section className="metrics">
            <Metric label="Payment records" value={livePayments.length || "—"} sub={livePayments.length ? `${persistence} persistence` : "No live records yet"}/>
            <Metric label="Invoices analyzed" value={livePayments.filter((p) => p.status).length || "—"} sub="Stored payment workflow records"/>
            <Metric label="Risk flags" value={flaggedCount || "—"} sub="Duplicate / beneficiary / suspicious"/>
            <Metric label="Settled" value={settledCount || "—"} sub="Devnet + safe demo settlements"/>
          </section>

          <section className="panel-grid">
            <div className="card recent">
              <div className="card-head"><div><span className="eyebrow">OPERATIONS</span><h3>Recent activity</h3></div><button>View all</button></div>
              <div className="table">
                <div className="tr th"><span>Supplier</span><span>Amount</span><span>Route</span><span>Status</span></div>
                {dashboardPayments.map((p) => (
                  <div className="tr" key={p.invoice}>
                    <span><i className="company-icon">{p.company.slice(0,2).toUpperCase()}</i><b>{p.company}</b><small>{p.invoice} · {p.time}</small></span>
                    <span><b>{p.amount}</b></span>
                    <span>{p.route}</span>
                    <span><StatusPill status={p.status}/></span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card agent-card">
              <div className="agent-title"><div className="agent-glow"><Bot size={23}/></div><div><span className="eyebrow">33JACK AGENT</span><h3>Finance work, already prepared.</h3></div></div>
              <div className="agent-task"><TriangleAlert size={18}/><div><b>1 beneficiary change needs review</b><p>Shenzhen Nova Parts · ¥42,000</p></div><ChevronRight size={18}/></div>
              <div className="agent-task"><Clock3 size={18}/><div><b>3 invoices due tomorrow</b><p>£16,770 total · proposals ready</p></div><ChevronRight size={18}/></div>
              <div className="agent-task"><BadgeCheck size={18}/><div><b>8 payments reconciled</b><p>Evidence matched automatically</p></div><ChevronRight size={18}/></div>
              <button className="agent-command" onClick={() => setFlow(true)}><Sparkles size={17}/> Ask 33jack to prepare a payment <ArrowRight size={17}/></button>
            </div>
          </section>

          <section className="workflow">
            <div className="section-head">
              <div><span className="eyebrow">THE 33JACK LOOP</span><h2>From messy instruction to reconciled payment.</h2></div>
              <p>AI prepares. Deterministic controls verify. A human approves. 33jack executes and follows the payment until the books match.</p>
            </div>
            <div className="step-grid">
              {steps.map(([title, body, Icon], i) => <div className="step" key={title}><span className="num">0{i+1}</span><Icon/><h4>{title}</h4><p>{body}</p></div>)}
            </div>
          </section>

          <ChannelPreview/>

          <section className="rail-section">
            <div>
              <span className="eyebrow">GLOBAL RAILS · ONE INSTRUCTION</span>
              <h2>The customer asks for an outcome.<br/>33jack handles the plumbing.</h2>
            </div>
            <div className="rails">
              <div><span className="sol-symbol">S</span><b>Solana</b><small>USDG settlement</small></div>
              <ArrowRight/>
              <div><Banknote/><b>Banks</b><small>Local payouts</small></div>
              <ArrowRight/>
              <div><MessageCircleMore/><b>Wallets</b><small>Approved endpoints</small></div>
              <ArrowRight/>
              <div><Globe2/><b>Global</b><small>More corridors</small></div>
            </div>
          </section>

          <footer><Logo/><p>Autonomous cross-border finance for global businesses.</p><span>Colosseum build · Solana</span></footer>
          </> : active === "Agent" ? (
            <AgentWorkspace/>
          ) : active === "33Jack Pay" ? (
            <PayWorkspace onNewPayment={() => setFlow(true)}/>
          ) : active === "33Jack Crypto" ? (
            <CryptoWorkspace onNewPayment={() => setFlow(true)}/>
          ) : active === "33Jack Invoice" ? (
            <InvoiceWorkspace onNewPayment={() => setFlow(true)}/>
          ) : (
            <RecordsWorkspace type={active} payments={livePayments} onNewPayment={() => setFlow(true)}/>
          )}
        </div>
      </main>
      {flow && <PaymentFlow close={() => setFlow(false)} onComplete={refreshPayments}/>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<AppErrorBoundary><App/></AppErrorBoundary>);
