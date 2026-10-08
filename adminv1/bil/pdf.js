const { BilInvoiceLine, BilPayLink } = require("../../model");
const { need } = require("../auth");
const invoices = require("./invoices");
const { billingSettings, STATE_NAME, moment, TZ, parse } = require("./common");

// The invoice / credit note as an A4 PDF (HTML printed by the server's
// Chrome, like the outlets' e-bills; CHROME_PATH when Chrome is not the
// bundled one). Everything printed comes from the invoice as issued.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rs = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n) {
    return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}
function three(n) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return [h ? `${ONES[h]} Hundred` : "", r ? two(r) : ""].filter(Boolean).join(" ");
}
/** 14159 -> "Rupees Fourteen Thousand One Hundred Fifty Nine Only" (Indian grouping). */
function inWords(amount) {
    let n = Math.round(Number(amount) || 0);
    if (!n) return "Rupees Zero Only";
    const parts = [];
    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    if (crore) parts.push(`${three(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (n) parts.push(three(n));
    return `Rupees ${parts.join(" ")} Only`;
}

async function html(inv) {
    const lines = await BilInvoiceLine.findAll({ where: { invoice_id: inv.id }, order: [["sort", "ASC"], ["id", "ASC"]], raw: true });
    const sel = parse(inv.seller) || {};
    const cfg = await billingSettings();
    const credit = inv.kind === "credit_note";
    const link = !credit && invoices.OPEN.includes(inv.status) ? await BilPayLink.findOne({ where: { invoice_id: inv.id, state: "PENDING" }, order: [["id", "DESC"]], raw: true }) : null;
    const d = (v) => (v ? moment(v).tz(TZ).format("D MMM YYYY") : "-");
    const intra = inv.supply_state === sel.state;
    const rate = lines[0] ? Number(lines[0].gst_rate) : 18;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1e1714;font-size:11.5px;margin:0;padding:28px 34px}
h1{font-size:20px;margin:0 0 2px}.muted{color:#6b615b}.row{display:flex;justify-content:space-between;gap:24px}
.box{border:1px solid #d9cfc7;border-radius:8px;padding:10px 12px}table{width:100%;border-collapse:collapse;margin-top:14px}
th{background:#f5f1ec;text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;padding:7px 8px;border-bottom:1px solid #d9cfc7}
td{padding:7px 8px;border-bottom:1px solid #eee5de;vertical-align:top}.r{text-align:right}.tot td{border:0;padding:4px 8px}
.grand td{font-size:14px;font-weight:bold;border-top:2px solid #1e1714}.demo{position:fixed;top:38%;left:12%;font-size:110px;color:rgba(174,10,30,.10);transform:rotate(-24deg);font-weight:bold}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;font-weight:bold;font-size:10.5px}.paid{background:#e3f3e8;color:#1f5a36}.due{background:#fbe7e8;color:#ae0a1e}
</style></head><body>
${inv.demo ? '<div class="demo">DEMO</div>' : ""}
<div class="row"><div><h1>${esc(sel.name || "BillerPe")}</h1><div class="muted">${esc(sel.address || "")}</div><div>GSTIN: <b>${esc(sel.gstin || "")}</b>${inv.demo ? " (demo - not valid for tax)" : ""} · State: ${esc(sel.stateName || "")} (${esc(sel.state || "")})</div></div>
<div style="text-align:right"><h1>${credit ? "Credit Note" : "Tax Invoice"}</h1><div><b>${esc(inv.number || "DRAFT")}</b></div><div class="muted">Date: ${d(inv.issued_at)}</div>${credit ? "" : `<div class="muted">Due: ${d(inv.due_at)}</div>`}
${credit ? "" : inv.status === "paid" ? '<span class="tag paid">PAID</span>' : inv.status === "cancelled" ? '<span class="tag due">CANCELLED</span>' : `<span class="tag due">DUE Rs ${rs(invoices.due(inv))}</span>`}</div></div>
<div class="row" style="margin-top:16px"><div class="box" style="flex:1"><div class="muted">Bill to</div><b>${esc(inv.bill_name)}</b><div>${esc(inv.bill_address)}</div>${inv.bill_gstin ? `<div>GSTIN: <b>${esc(inv.bill_gstin)}</b></div>` : ""}<div>${esc([inv.bill_mobile, inv.bill_email].filter(Boolean).join(" · "))}</div></div>
<div class="box" style="width:230px"><div class="muted">Place of supply</div><b>${esc(STATE_NAME.get(inv.supply_state) || "")} (${esc(inv.supply_state)})</b>${credit && inv.note ? `<div class="muted" style="margin-top:6px">${esc(inv.note)}</div>` : ""}</div></div>
<table><thead><tr><th>#</th><th>Description</th><th>SAC/HSN</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
${lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}${l.period_from ? `<div class="muted">Period ${d(l.period_from)} to ${d(l.period_to)}</div>` : ""}</td><td>${esc(l.sac || "-")}</td><td class="r">${Number(l.qty)}</td><td class="r">${rs(l.unit_price)}</td><td class="r">${rs(l.amount)}</td></tr>`).join("")}
</tbody></table>
<div class="row" style="margin-top:8px"><div style="flex:1;padding-top:8px"><div class="muted">Amount in words</div><b>${inWords(inv.total)}</b>
${link && !link.url.startsWith("sim:") ? `<div style="margin-top:10px">Pay online: <a href="${esc(link.url)}">${esc(link.url.slice(0, 80))}</a></div>` : ""}
${cfg.bankDetails ? `<div style="margin-top:10px"><div class="muted">Bank details</div>${esc(cfg.bankDetails)}</div>` : ""}</div>
<table style="width:300px;margin-top:0" class="tot"><tbody>
<tr><td>Subtotal</td><td class="r">${rs(inv.subtotal)}</td></tr>
${Number(inv.discount) ? `<tr><td>Discount (${Number(inv.discount_pct)}%)</td><td class="r">-${rs(inv.discount)}</td></tr>` : ""}
<tr><td>Taxable value</td><td class="r">${rs(inv.taxable)}</td></tr>
${intra ? `<tr><td>CGST ${rate / 2}%</td><td class="r">${rs(inv.cgst)}</td></tr><tr><td>SGST ${rate / 2}%</td><td class="r">${rs(inv.sgst)}</td></tr>` : `<tr><td>IGST ${rate}%</td><td class="r">${rs(inv.igst)}</td></tr>`}
${Number(inv.round_off) ? `<tr><td>Round off</td><td class="r">${rs(inv.round_off)}</td></tr>` : ""}
<tr class="grand"><td>Total</td><td class="r">Rs ${rs(inv.total)}</td></tr>
${!credit && Number(inv.paid) ? `<tr><td>Paid</td><td class="r">${rs(inv.paid)}</td></tr>` : ""}
</tbody></table></div>
<p class="muted" style="margin-top:22px">${esc(cfg.terms || "")}</p>
<p class="muted">This is a computer-made ${credit ? "credit note" : "invoice"} and needs no signature.</p>
</body></html>`;
}

let browser = null;
async function render(markup) {
    const puppeteer = require("puppeteer");
    if (!browser || !browser.connected) browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"], executablePath: process.env.CHROME_PATH || undefined });
    const page = await browser.newPage();
    try {
        await page.setContent(markup, { waitUntil: "load" });
        return await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
    } finally {
        await page.close().catch(() => {});
    }
}

/** The PDF as base64 for the panel (download / print). */
async function pdf(s, id) {
    need(s, "billing.view");
    const inv = await invoices.getInvoice(id);
    const buf = await render(await html(inv));
    return { name: `${(inv.number || `draft-${inv.id}`).replace(/\//g, "-")}.pdf`, mime: "application/pdf", data: Buffer.from(buf).toString("base64") };
}

async function close() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
}

module.exports = { pdf, html, render, inWords, close };
