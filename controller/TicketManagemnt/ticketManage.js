
const { STATUSCODE, MESSAGE } = require("../../constant/const")
const { superAdminModel, Hotel, HotelUser, Role } = require("../../model")
const RaiseTicket = require("../../model/raiseTicket")
const { error, success } = require("../../responce/res")
const { sendAdminNotifications } = require("../webiste/user")



const genrerateTicket = async (req, res) => {
    try {
        console.log(req.body, "body:::::")
        console.log(req.file, "FIle::::")
        const { issue, ticket_type, call_me_now } = req.body
        let ticket = {}
        console.log(call_me_now)
        if (call_me_now) {
            ticket = await RaiseTicket.create({ issue: "Call Me", ticket_type: "Other", hotel_id: req.user })
        } else {
            if (!issue || !ticket_type) {
                return res.json(error("Isuue And Ticket Type Required", STATUSCODE.INTERNAL_SERVER_ERROR))
            }
            let attachedment = ""
            let attachedment_type = "image"
            if (req.file) {

                if (req.file.mimetype.startsWith("image/")) {
                    console.log("✅ This is an IMAGE");
                    attachedment = `${process.env.SUPER_URL}/images/${req.file.filename}`
                }
                else if (req.file.mimetype.startsWith("video/")) {
                    console.log("✅ This is a VIDEO");
                    attachedment = `${process.env.SUPER_URL}/images/${req.file.filename}`
                    attachedment_type = "video"
                }
                else {
                    return res.json(error('Unsupported file type', STATUSCODE.INTERNAL_SERVER_ERROR))

                }
            }
            ticket = await RaiseTicket.create({ issue, attachedment, attachedment_type, ticket_type, hotel_id: req.user })
        }
        
        const gethotel = await Hotel.findByPk(req.user)
        sendAdminNotifications("Customer Ticket Generated",gethotel?.owner_number||"",ticket?.issue_type||"",`issue - ${ticket?.issue||""}`)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Ticket generated Successfully", ticket }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: while Generating Ticket")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getSingleTicketData = async (req, res) => {
    try {
        const { id } = req.query
        const getData = await RaiseTicket.findOne({ where: { id }, include: [{ model: superAdminModel, attributes: ["name", "number"] }, { model: Hotel, attributes: ['hotel_name', 'owner_number'], include: { model: HotelUser, attributes: ['name', 'number', 'password'], include: { model: Role, where: { role_name: "A" }, attributes: ["role_name"] } } }] })
        if (!getData) return res.json(error("Ticket Not Found", STATUSCODE.BAD_REQUEST))
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { ticket: getData }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: while getting single Ticket")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const hotelWiseTicketGetting = async (req, res) => {
    try {
        let { page = 1 } = req.query; // ✅ default page = 1
        const limit = 10;
        page = Number(page);

        const offset = (page - 1) * limit;

        const hotel_id = req.user; // ✅ assumed extracted from token

        if (!hotel_id) {
            return res
                .status(STATUSCODE.BAD_REQUEST)
                .json(error("Hotel ID missing", STATUSCODE.BAD_REQUEST));
        }

        const getData = await RaiseTicket.findAll({
            where: { hotel_id },
            attributes: {
                exclude: ['comment', 'super_id']
            },
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });
        const totalRecords = await RaiseTicket.count({ where: { hotel_id } })
        return res
            .status(STATUSCODE.SUCCESS)
            .json(
                success(MESSAGE.SUCCESS, {
                    ticket: getData,
                    page,
                    count: getData.length,
                    totalRecords,
                }, STATUSCODE.SUCCESS)
            );

    } catch (err) {
        console.log(err, "Error::: while getting hotel wise tickets");
        return res
            .status(STATUSCODE.INTERNAL_SERVER_ERROR)
            .json(
                error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
            );
    }
};

const startUpdate = async (req, res) => {
    try {

        const { id, star } = req.body
        console.log(id, star)
        await RaiseTicket.update({ star: `${star}`, ratting: true }, { where: { id } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Thank You For Given Your Feedback" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "error:whotel updateing start")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const addComment = async (req, res) => {
    try {
        const { id, comment } = req.body
        const admin = await superAdminModel.findOne({ where: { id: req.user }, attributes: ['name'] })
        console.log(admin, "admin")
        const ticket = await RaiseTicket.findOne({ where: { id } })
        if (!ticket) return res.json(error("Ticket Not Found", STATUSCODE.BAD_REQUEST))
        const newcommit = { name: admin.name, message: comment, date: new Date() }
        console.log(newcommit, "commit::::")
        await ticket.update({ comment: [...ticket.comment, newcommit] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Comments added", newcommit }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "while adding you Comments")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const ticketStatusUpdate = async (req, res) => {
    try {
        const { id, status, super_id } = req.body
        const getTicket = await RaiseTicket.findByPk(id)
        if (!getTicket) return res.json(error("Ticket Not Found", STATUSCODE.BAD_REQUEST))
        if (super_id && status === 'open') {
            await getTicket.update({ super_id, status })

        } else if (status === "close" && getTicket.status === "open") {
            await getTicket.update({ status })
        } else {
            return res.json(error("Something Went Wrong Please Later", STATUSCODE.BAD_REQUEST))
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Ticket Status Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error:while ticket Status Update")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getTicketRoleWise = async (req, res) => {
    try {
        console.log(req.user, "super_id");

        const super_id = req.user;

        const superAdminGet = await superAdminModel.findByPk(super_id);

        if (!superAdminGet) {
            return res
                .status(STATUSCODE.BAD_REQUEST)
                .json(error("Invalid User", STATUSCODE.BAD_REQUEST));
        }

        let tickets = [];

        const commonInclude = [
            {
                model: superAdminModel,
                attributes: ["name", "number"]
            },
            {
                model: Hotel,
                attributes: ["hotel_name", "owner_number"],
                include: {
                    model: HotelUser,
                    attributes: ["name", "number", "password"],
                    include: {
                        model: Role,
                        where: { role_name: "A" },
                        attributes: ["role_name"]
                    }
                }
            }
        ];

        if (superAdminGet.role === "Admin") {
            tickets = await RaiseTicket.findAll({
                include: commonInclude,
                order: [["createdAt", "DESC"]] // ✅ LATEST FIRST
            });
        }
        else if (superAdminGet.role === "User") {
            tickets = await RaiseTicket.findAll({
                include: [
                    {
                        model: superAdminModel,
                        where: { id: super_id },
                        attributes: ["name", "number"],
                        required: true
                    },
                    commonInclude[1]
                ],
                order: [["createdAt", "DESC"]] // ✅ LATEST FIRST
            });
        }
        else {
            return res
                .status(STATUSCODE.BAD_REQUEST)
                .json(error("Not Authenticated User", STATUSCODE.BAD_REQUEST));
        }

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success(MESSAGE.SUCCESS, { tickets }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.log(err, "err while getting tickets");
        return res
            .status(STATUSCODE.INTERNAL_SERVER_ERROR)
            .json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};

const generateTicketFromSuperAdmin = async (req, res) => {
    try {
        const { issue, ticket_type, super_id } = req.body
        console.log(req.body, "body:::::")
        if (!issue || !ticket_type) {
            return res.json(error("Issue, Ticket Type  Required", STATUSCODE.INTERNAL_SERVER_ERROR))
        }
        let attachment = ""
        let attachment_type = "image"
        if (req.file) {
            if (req.file.mimetype.startsWith("image/")) {
                console.log("✅ This is an IMAGE");
                attachment = `${process.env.SUPER_URL}/images/${req.file.filename}`
            }
            else if (req.file.mimetype.startsWith("video/")) {
                console.log("✅ This is a VIDEO");
                attachment = `${process.env.SUPER_URL}/images/${req.file.filename}`
                attachment_type = "video"
            }
        }
        const ticket = await RaiseTicket.create({ status: "open", issue, ticket_type, hotel_id: 1, super_id: super_id ? super_id : req.user, attachment, attachment_type })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Ticket generated Successfully", ticket }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "Error::: while Generating Ticket From Super Admin")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { generateTicketFromSuperAdmin, getSingleTicketData, hotelWiseTicketGetting, startUpdate, addComment, ticketStatusUpdate, getTicketRoleWise, genrerateTicket }