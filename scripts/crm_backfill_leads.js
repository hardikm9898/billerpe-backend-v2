// One-time backfill: mirror existing hms_website_user_msts rows into crm_lead_msts.
// Idempotent — rows already linked via website_user_id are skipped, so it is safe to re-run.
const { webSiteUserData, CrmLead } = require("../model");

async function backfill() {
    const users = await webSiteUserData.findAll();
    console.log(`Found ${users.length} website inquiries to check.`);

    let created = 0;
    let skipped = 0;

    for (const user of users) {
        const existing = await CrmLead.findOne({ where: { website_user_id: user.id } });
        if (existing) {
            skipped++;
            continue;
        }

        await CrmLead.create({
            name: user.name,
            phone_number: user.phone_number,
            email: user.email,
            message: user.message,
            source: "website",
            status: "NEW",
            priority: "P3",
            website_user_id: user.id,
        });
        created++;
    }

    console.log(`Backfill complete — created ${created}, skipped ${skipped} (already linked).`);
    process.exit(0);
}

backfill().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
