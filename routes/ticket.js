const express = require("express")
const router = express.Router()

const { adminAuth } = require("../middleware/adminAuth")
const { getSingleTicketData, hotelWiseTicketGetting, startUpdate, addComment, ticketStatusUpdate, getTicketRoleWise, genrerateTicket } = require("../controller/TicketManagemnt/ticketManage")
const superAdminAuth = require("../middleware/superAdminAuth")
const { uploadSingleTest, uploadSingleAttachedment } = require("../services/upload")
const upload = require("../middleware/upload")



router.get("/getAll", superAdminAuth, getTicketRoleWise)
router.get("/getSingle/:id", superAdminAuth, getSingleTicketData)
router.get("/hotelWiseTicketGetting", adminAuth, hotelWiseTicketGetting)
router.post("/starupdate", adminAuth, startUpdate)
router.post("/addcomment", superAdminAuth, addComment)
router.post("/statusupdate", superAdminAuth, ticketStatusUpdate)
router.post("/generateTicket", adminAuth, upload.single('image'), genrerateTicket)

module.exports = router