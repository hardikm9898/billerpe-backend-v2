
const { Op } = require("sequelize");
const { SyncIndexDB, sequelize, TimeLine } = require("../model")

const syncMenuVersion = async ({ hotel_id, type = null, action = "compare", clientVersion = 0 }) => {
    try {
        // Validate type
        const fieldMap = {
            menu: "menu_version",
            menu_categ: "menu_categ_version"
        };
        console.log(type)
        const field = fieldMap[type];
        if (!field) return { success: false, message: "Invalid type" };

        // Find or create sync record
        let record = await SyncIndexDB.findOne({ where: { hotel_id } });

        if (!record) {
            record = await SyncIndexDB.create({
                hotel_id,
                menu_version: 1,
                menu_categ_version: 1
            });
        }

        // ACTION: increment (called when merchant updates/deletes menu)
        if (action === "increment") {
            const newVersion = Number(record[field]) + 1;
            await record.update({ [field]: newVersion });

            return {
                success: true,
                latestVersion: newVersion
            };
        }

        // ACTION: compare (called from POS / singleHotel check)
        if (action === "compare") {
            const latestVersion = Number(record[field]);
            return {
                success: true,
                updateRequired: Number(clientVersion) < latestVersion,
                latestVersion
            };
        }

        return { success: false, message: "Invalid action" };

    } catch (err) {
        console.error("syncMenuVersion error:", err);
        return { success: false, message: "Internal error" };
    }
};
const updateViaSocket = async (hotel_id) => {
    let syncRecord = await SyncIndexDB.findOne({
        where: { hotel_id }
    });

    if (!syncRecord) {
        syncRecord = await SyncIndexDB.create({
            hotel_id,
            menu_version: 1,
            menu_categ_version: 1
        });
    }
    await io.to(hotel_id).emit("updateMenu", { hms_sync_index_mst: syncRecord })
}
const deleteOldTimeline = async () => {
    const transaction = await sequelize.transaction();

    try {
        const FIFTEEN_DAYS_AGO = new Date();
        FIFTEEN_DAYS_AGO.setDate(FIFTEEN_DAYS_AGO.getDate() - 15);

        console.log("Deleting timeline older than:", FIFTEEN_DAYS_AGO);

        const deleted = await TimeLine.destroy({
            where: {
                createdAt: {
                    [Op.lt]: FIFTEEN_DAYS_AGO,
                },
            },
            transaction,
        });

        await transaction.commit();

        console.log(`Deleted ${deleted} old timeline records`);
    } catch (error) {
        await transaction.rollback();
        console.error("Timeline cleanup failed:", error);
    }
};
module.exports = { deleteOldTimeline, syncMenuVersion, updateViaSocket }