const { Op } = require("sequelize");
const { AdmUser, AdmTeam } = require("../../model");
const { RuleError } = require("../../appv1/core");

// Which leads a person may see: everyone's (leads.view_all), their team's
// (leads.view_team: their own, people they manage, and members of teams
// they manage), or only their own (leads.view_own).

async function teamIds(userId) {
    const managed = await AdmTeam.findAll({ where: { manager_id: userId }, attributes: ["id"], raw: true });
    const people = await AdmUser.findAll({
        where: { [Op.or]: [{ manager_id: userId }, ...(managed.length ? [{ team_id: managed.map((t) => t.id) }] : [])] },
        attributes: ["id"],
        raw: true,
    });
    return [...new Set([userId, ...people.map((p) => p.id)])];
}

/** null = every lead; else the owner ids this person may see (unassigned leads only with view_all). */
async function visibleOwners(s) {
    if (s.can("leads.view_all")) return null;
    if (s.can("leads.view_team")) return teamIds(s.user.id);
    if (s.can("leads.view_own")) return [s.user.id];
    throw new RuleError("You do not have permission for this.");
}

/** A where clause on crm_leads for this person. */
async function leadWhere(s) {
    const owners = await visibleOwners(s);
    return owners === null ? {} : { owner_id: owners };
}

async function canSee(s, lead) {
    const owners = await visibleOwners(s);
    return owners === null || owners.includes(lead.owner_id);
}

module.exports = { visibleOwners, leadWhere, canSee, teamIds };
