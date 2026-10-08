const { RuleError } = require("../../appv1/core");
const { need } = require("../auth");
const { addActivity } = require("../cs/common");
const invoices = require("./invoices");
const pdf = require("./pdf");
const { money } = require("./common");

// Sending an invoice to the customer on the business WhatsApp: the PDF and,
// while it is unpaid, its PhonePe link. Only inside the 24-hour window
// (Meta rule); otherwise staff copy the link and send it another way.

async function send(s, invoiceId) {
    need(s, "billing.manage");
    const wa = require("../crm/wa");
    const inv = await invoices.getInvoice(invoiceId);
    if (!inv.number) throw new RuleError("Issue the invoice first.");
    const mobile = String(inv.bill_mobile || "").replace(/\D/g, "").slice(-10);
    if (mobile.length !== 10) throw new RuleError("The invoice has no 10-digit mobile to send it to.");
    const chat = await wa.chatFor(mobile, { name: inv.bill_name });
    if (!wa.windowOpen(chat)) throw new RuleError("The 24-hour WhatsApp window is closed (they have not written in the last 24 hours). Copy the payment link and send it another way, or call them.");
    let payUrl = "";
    if (invoices.OPEN.includes(inv.status)) {
        const link = await require("./payments").linkFor(inv.id, s.user.id);
        payUrl = link.url.startsWith("sim:") ? "" : link.url;
    }
    const buf = await pdf.render(await pdf.html(inv));
    const name = `${inv.number.replace(/\//g, "-")}.pdf`;
    const url = await wa.transport.store(Buffer.from(buf), "application/pdf", name);
    const caption = invoices.OPEN.includes(inv.status) ? `Invoice ${inv.number} for ${money(invoices.due(inv))}.${payUrl ? ` Pay online: ${payUrl}` : ""}` : `${inv.kind === "credit_note" ? "Credit note" : "Invoice"} ${inv.number}. Thank you!`;
    const msg = await wa.sendMedia(chat, { url, mime: "application/pdf", fileName: name, caption }, { sender: "user", userId: s.user.id });
    if (msg.status === "failed") throw new RuleError(`WhatsApp did not take the file: ${msg.error}`);
    if (inv.account_id) await addActivity(inv.account_id, inv.hotel_id, "invoice", s.user.id, `Invoice ${inv.number} sent on WhatsApp`, { invoiceId: inv.id });
    return { chatId: chat.id, status: msg.status };
}

module.exports = { send };
