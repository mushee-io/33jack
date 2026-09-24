import React, { useMemo, useState } from "react";
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

const payments = [
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

function PaymentFlow({ close }) {
  const [fileName, setFileName] = useState("");
  const [stage, setStage] = useState("upload");
  const [settleStep, setSettleStep] = useState(0);
  const [corridor, setCorridor] = useState("NGN");

  const result = useMemo(() => ({
    supplier: corridor === "CNY" ? "Shenzhen Nova Parts Ltd" : "Lagos Studio Co.",
    amount: corridor === "CNY" ? "¥42,000" : "₦8,250,000",
    funding: "£4,850.00",
    fee: "£21.80",
    eta: corridor === "CNY" ? "Same business day" : "< 10 minutes",
  }), [corridor]);

  function runAnalysis() {
    if (!fileName) setFileName("supplier_invoice_0926.pdf");
    setStage("analyzing");
    setTimeout(() => setStage("review"), 1100);
  }

  function approve() {
    setStage("settling");
    setSettleStep(1);
    setTimeout(() => setSettleStep(2), 700);
    setTimeout(() => setSettleStep(3), 1500);
    setTimeout(() => {
      setSettleStep(4);
      setStage("done");
    }, 2300);
  }

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

        {stage === "upload" && (
          <div className="flow-body">
            <div className="flow-copy">
              <h3>Give 33jack the invoice.</h3>
              <p>The agent will extract the payment instruction, verify it, prepare a route and ask for one exact approval.</p>
            </div>
            <label className="dropzone">
              <UploadCloud size={28} />
              <strong>{fileName || "Drop invoice here"}</strong>
              <span>PDF, PNG, JPG or CSV · Demo accepts any file</span>
              <input type="file" onChange={(e) => setFileName(e.target.files?.[0]?.name || "")} />
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
            <p>Extracting invoice · checking beneficiary · duplicate scan · route discovery</p>
            <div className="progress"><i /></div>
          </div>
        )}

        {stage === "review" && (
          <div className="review-grid">
            <div className="analysis-card">
              <span className="eyebrow">AI RISK REVIEW</span>
              <h3>{fileName || "supplier_invoice_0926.pdf"}</h3>
              <div className="check-list">
                <div><CheckCircle2/><span><b>No duplicate found</b><small>No matching invoice in payment history.</small></span></div>
                <div><CheckCircle2/><span><b>Supplier verified</b><small>Beneficiary matches the approved supplier profile.</small></span></div>
                <div className="warning"><TriangleAlert/><span><b>Bank detail changed</b><small>Account ending ••1840 differs from last payment. Manual acknowledgement required.</small></span></div>
                <div><CheckCircle2/><span><b>Amount within policy</b><small>Below the £10,000 single-payment approval limit.</small></span></div>
              </div>
            </div>
            <div className="proposal">
              <span className="eyebrow">EXACT PAYMENT PROPOSAL</span>
              <h3>{result.supplier}</h3>
              <div className="proposal-amount">{result.amount}</div>
              <div className="proposal-lines">
                <p><span>You fund</span><b>{result.funding}</b></p>
                <p><span>Network</span><b>Solana · USDC</b></p>
                <p><span>Service + FX</span><b>{result.fee}</b></p>
                <p><span>Delivery</span><b>{result.eta}</b></p>
              </div>
              <div className="route">
                <span>GBP</span><ArrowRight/><span>USDC</span><ArrowRight/><span>{corridor}</span>
              </div>
              <label className="ack"><input type="checkbox" defaultChecked/> I acknowledge the beneficiary-detail change.</label>
              <button className="primary wide" onClick={approve}><ShieldCheck size={17}/> Approve exact payment</button>
              <small className="fine">Demo mode — no real funds are moved.</small>
            </div>
          </div>
        )}

        {stage === "settling" && (
          <div className="settlement">
            <span className="eyebrow">LIVE SETTLEMENT</span>
            <h3>Executing approved payment</h3>
            {[
              "Approval locked",
              "USDC settlement submitted on Solana",
              "Local payout initiated",
              "Recipient confirmed + invoice reconciled"
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
            <span className="eyebrow">RECONCILED</span>
            <h2>Payment complete.</h2>
            <p>{result.supplier} received the payout and the settlement evidence is attached to the invoice.</p>
            <div className="receipt">
              <div><span>Solana settlement</span><b>5Tz…8Kq</b></div>
              <div><span>Invoice</span><b>{fileName || "supplier_invoice_0926.pdf"}</b></div>
              <div><span>Status</span><b className="green">Matched ✓</b></div>
            </div>
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
            <Metric label="Payments this month" value="£245,000" sub="Across 4 corridors" accent="+28%"/>
            <Metric label="Invoices processed" value="126" sub="18 handled by agent today"/>
            <Metric label="Risk prevented" value="£18,420" sub="Duplicate + beneficiary flags"/>
            <Metric label="Reconciliation" value="98.7%" sub="Matched automatically"/>
          </section>

          <section className="panel-grid">
            <div className="card recent">
              <div className="card-head"><div><span className="eyebrow">OPERATIONS</span><h3>Recent activity</h3></div><button>View all</button></div>
              <div className="table">
                <div className="tr th"><span>Supplier</span><span>Amount</span><span>Route</span><span>Status</span></div>
                {payments.map((p) => (
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
      {flow && <PaymentFlow close={() => setFlow(false)}/>}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App/>);
