// Lead score 0-100 with the reasons shown on the lead (design doc: Lead
// score). Hot >= 60, Warm >= 30, else Cold. Kept simple and explainable;
// the weights can be tuned once real win data is in (phase 7 reports).

const SOURCE_POINTS = { manual: 20, referral: 25, website: 18, phone: 18, whatsapp: 14, meta: 8, import: 5 };
const STAGE_POINTS = { new: 0, contacted: 8, qualified: 18, demo: 28, proposal: 35 };

function scoreLead(lead, stageKey, facts = {}, now = new Date()) {
    const parts = [];
    const add = (points, why) => {
        if (points) parts.push({ points, why });
    };
    add(SOURCE_POINTS[lead.source] ?? 5, `Source: ${lead.source}`);
    add(STAGE_POINTS[stageKey] ?? 10, `Stage: ${stageKey}`);
    if ((lead.outlets_count || 0) >= 2) add(12, `${lead.outlets_count} outlets`);
    const details = ["restaurant_name", "city", "business_type", "current_software", "plan_interest", "decision_maker"].filter((k) => lead[k]).length;
    if (details >= 3) add(8, "Business details known");
    if (lead.plan_interest) add(4, `Interested in ${lead.plan_interest}`);
    if (facts.reached) add(Math.min(15, 6 + facts.reached * 3), `Spoken to ${facts.reached} time${facts.reached === 1 ? "" : "s"}`);
    if (facts.demoDone) add(12, "Demo done");
    if (facts.waReplies) add(Math.min(10, 4 + facts.waReplies), `Wrote on WhatsApp ${facts.waReplies} time${facts.waReplies === 1 ? "" : "s"}`);
    if (!lead.phone_valid) add(-25, "Phone number looks wrong");
    const quietFrom = [lead.last_activity_at || lead.createdAt, facts.lastReplyAt].filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0];
    const quietDays = quietFrom ? Math.floor((now - new Date(quietFrom)) / 86400000) : 0;
    if (quietDays > 2) add(-Math.min(30, (quietDays - 2) * 2), `No contact for ${quietDays} days`);
    const score = Math.max(0, Math.min(100, parts.reduce((a, p) => a + p.points, 0)));
    return { score, band: score >= 60 ? "hot" : score >= 30 ? "warm" : "cold", reasons: parts };
}

const band = (score) => (score >= 60 ? "hot" : score >= 30 ? "warm" : "cold");

module.exports = { scoreLead, band };
