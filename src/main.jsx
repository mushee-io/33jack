import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileText,
  Globe2,
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
  { company: "Nairobi Logistics Ltd", invoice: "INV-8821", amount: "£4,850", route: "GBP → USDC → KES", status: "Settled", time: "12 min ago" },
  { company: "Accra Imports", invoice: "INV-2204", amount: "£12,400", route: "GBP → USDC → GHS", status: "Settled", time: "1 hr ago" },
  { company: "Shenzhen Nova Parts", invoice: "CN-44018", amount: "¥42,000", route: "GBP → USDC → CNY", status: "Review", time: "2 hrs ago" },
  { company: "Lagos Studio Co.", invoice: "LS-0192", amount: "£2,100", route: "GBP → USDC → NGN", status: "Flagged", time: "Yesterday" },
];

const nav = [
  ["Overview", LayoutDashboard],
  ["Invoices", ReceiptText],
  ["Payments", CircleDollarSign],
  ["Beneficiaries", WalletCards],
  ["Approvals", ShieldCheck],
  ["Agent", Bot],
];

const steps = [
  ["Invoice received", "AI extracted supplier, amount, due date and banking instructions.", FileText],
  ["Risk checks", "Duplicate scan, beneficiary-change check and missing-field validation.", ShieldCheck],
  ["Route prepared", "Compared settlement options and prepared an exact payment proposal.", RefreshCw],
  ["Approval", "Human approval is bound to amount, beneficiary, route and expiry.", BadgeCheck],
  ["Settlement", "USDC settles on Solana, then the local payout partner completes delivery.", Zap],
  ["Reconciliation", "Payment evidence is matched back to the invoice automatically.", FileCheck2],
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

function PaymentFlow({ close, onComplete }) {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [stage, setStage] = useState("upload");
  const [settleStep, setSettleStep] = useState(0);
  const [corridor, setCorridor] = useState("NGN");
  const [analysis, setAnalysis] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [error, setError] = useState("");
  const [acknowledgements, setAcknowledgements] = useState({
    duplicate: false,
    beneficiary_changed: false,
    suspicious: false
  });

  const result = useMemo(() => {
    if (!analysis) return {
      supplier: corridor === "CNY" ? "Shenzhen Nova Parts Ltd" : "Lagos Studio Co.",
      amount: corridor === "CNY" ? "¥42,000" : "₦8,250,000",
      funding: "£4,850.00",
      fee: "£21.80",
      eta: corridor === "CNY" ? "Same business day" : "< 10 minutes",
      route: `GBP → USDC/Solana → ${corridor}`,
      risk: { duplicate: false, beneficiary_changed: true, suspicious: false, missing_fields: [] }
    };
    return {
      supplier: analysis.supplier || "Supplier not extracted",
      amount: analysis.destination_amount || "Quoted at execution",
      funding: analysis.source_amount && analysis.source_currency
        ? new Intl.NumberFormat("en-GB", { style: "currency", currency: analysis.source_currency }).format(analysis.source_amount)
        : "Confirm from invoice",
      fee: analysis.route_options?.best?.estimatedFee != null
        ? `£${Number(analysis.route_options.best.estimatedFee).toFixed(2)} est.`
        : "Calculated at quote",
      eta: analysis.route_options?.best?.etaMinutes
        ? `${analysis.route_options.best.etaMinutes} min est.`
        : corridor === "CNY" ? "Same business day" : "< 10 minutes",
      route: analysis.recommended_route || `${analysis.source_currency || "GBP"} → USDC/Solana → ${analysis.destination_currency || corridor}`,
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
        const demoText = `INVOICE 33J-DEMO-0926
Supplier: ${corridor === "CNY" ? "Shenzhen Nova Parts Ltd" : "Lagos Studio Co."}
Amount due: GBP 4,850
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
      const data = await response.json();
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
          amountUsdc: 1
        })
      });
      const approval = await approvalResponse.json();
      if (!approvalResponse.ok) throw new Error(approval.detail || approval.error || "Approval failed");

      setSettleStep(2);
      const response = await fetch("/api/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalToken: approval.approvalToken })
      });
      const data = await response.json();
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
              <span>PDF, PNG, JPG or TXT · up to 3.2 MB · or run the built-in demo</span>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"
                onChange={(e) => {
                  const selected = e.target.files?.[0] || null;
                  setFile(selected);
                  setFileName(selected?.name || "");
                }}
              />
            </label>
            <div className="corridor-row">
              <button className={corridor === "NGN" ? "chip active" : "chip"} onClick={() => setCorridor("NGN")}>Nigeria · NGN</button>
              <button className={corridor === "CNY" ? "chip active" : "chip"} onClick={() => setCorridor("CNY")}>China · CNY</button>
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
              <span className="eyebrow">{analysis?.mode === "ai" ? "LIVE AI RISK REVIEW" : "DEMO RISK REVIEW"}</span>
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
                <p><span>Settlement</span><b>Solana · USDC</b></p>
                <p><span>Service + FX</span><b>{result.fee}</b></p>
                <p><span>Delivery target</span><b>{result.eta}</b></p>
              </div>
              <div className="route">
                <span>{analysis?.source_currency || "GBP"}</span><ArrowRight/><span>USDC</span><ArrowRight/><span>{analysis?.destination_currency || corridor}</span>
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
              <small className="fine">Devnet-ready: real USDC moves only when the server devnet signer, mint and recipient are configured.</small>
            </div>
          </div>
        )}

        {stage === "settling" && (
          <div className="settlement">
            <span className="eyebrow">SOLANA SETTLEMENT</span>
            <h3>Executing approved payment</h3>
            {[
              "Approval locked",
              "USDC settlement submitted on Solana",
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
            <p>£4,850 → USDC/Solana → ¥42,000</p>
            <small>Estimated delivery: same business day</small>
          </div>
          <button className="chat-cta">Review securely <ChevronRight size={15}/></button>
        </div>
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
      const data = await response.json();
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
          ? new Intl.NumberFormat("en-GB", { style: "currency", currency: p.source_currency }).format(Number(p.source_amount))
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
              <div className="orbit-label b">USDC</div>
              <div className="orbit-label c">SOLANA</div>
              <div className="orbit-label d">LOCAL PAYOUT</div>
            </div>
          </section>

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
              <div><span className="sol-symbol">S</span><b>Solana</b><small>USDC settlement</small></div>
              <ArrowRight/>
              <div><Banknote/><b>Banks</b><small>Local payouts</small></div>
              <ArrowRight/>
              <div><MessageCircleMore/><b>Wallets</b><small>Approved endpoints</small></div>
              <ArrowRight/>
              <div><Globe2/><b>Global</b><small>More corridors</small></div>
            </div>
          </section>

          <footer><Logo/><p>Autonomous cross-border finance for global businesses.</p><span>Colosseum build · Solana</span></footer>
        </div>
      </main>
      {flow && <PaymentFlow close={() => setFlow(false)} onComplete={refreshPayments}/>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App/>);
