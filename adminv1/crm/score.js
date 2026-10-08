// Lead score 0-100 with the reasons shown on the lead (design doc: Lead
// score). Hot >= 60, Warm >= 30, else Cold. Kept simple and explainable;
// the weights are a setting (Settings -> Lead score, phase 7) and Reports
// shows how often each band wins, so they can be tuned on real data.

const settings = require("../settings");

const DEFAULT_WEIGHTS = settings.DEFAULTS.score;

let cache = null;
let cachedAt = 0;
/** The saved weights, cached for a minute (every lead change rescores). */
async function weights() {
    if (!cache || Date.now() - cachedAt > 60000) {
        const w = await settings.read("score");
        cache = { ...DEFAULT_WEIGHTS, ...w, sources: { ...DEFAULT_WEIGHTS.sources, ...(w.sources || {}) }, stages: { ...DEFAULT_WEIGHTS.stages, ...(w.stages || {}) } };
        cachedAt = Date.now();
    }
    return cache;
}
const resetWeights = () => {
    cache = null;
};

function scoreLead(lead, stageKey, facts = {}, now = new Date(), w = DEFAULT_WEIGHTS) {
    const parts = [];
    const add = (points, why) => {
        if (points) parts.push({ points, why });
    };
    add(w.sources[lead.source] ?? w.otherSource, `Source: ${lead.source}`);
    add(w.stages[stageKey] ?? w.otherStage, `Stage: ${stageKey}`);
    if ((lead.outlets_count || 0) >= 2) add(w.multiOutlet, `${lead.outlets_count} outlets`);
    const details = ["restaurant_name", "city", "business_type", "current_software", "plan_interest", "decision_maker"].filter((k) => lead[k]).length;
    if (details >= 3) add(w.detailsKnown, "Business details known");
    if (lead.plan_interest) add(w.planInterest, `Interested in ${lead.plan_interest}`);
    if (facts.reached) add(Math.min(w.reachedMax, w.reachedBase + facts.reached * w.reachedEach), `Spoken to ${facts.reached} time${facts.reached === 1 ? "" : "s"}`);
    if (facts.demoDone) add(w.demoDone, "Demo done");
    if (facts.waReplies) add(Math.min(w.waMax, w.waBase + facts.waReplies), `Wrote on WhatsApp ${facts.waReplies} time${facts.waReplies === 1 ? "" : "s"}`);
    if (!lead.phone_valid) add(w.badPhone, "Phone number looks wrong");
    const quietFrom = [lead.last_activity_at || lead.createdAt, facts.lastReplyAt].filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0];
    const quietDays = quietFrom ? Math.floor((now - new Date(quietFrom)) / 86400000) : 0;
    if (quietDays > w.quietAfterDays) add(-Math.min(w.quietMax, (quietDays - w.quietAfterDays) * w.quietPerDay), `No contact for ${quietDays} days`);
    const score = Math.max(0, Math.min(100, parts.reduce((a, p) => a + p.points, 0)));
    return { score, band: band(score), reasons: parts };
}

const band = (score) => (score >= 60 ? "hot" : score >= 30 ? "warm" : "cold");

module.exports = { scoreLead, band, weights, resetWeights, DEFAULT_WEIGHTS };
