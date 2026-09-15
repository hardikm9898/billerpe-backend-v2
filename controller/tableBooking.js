const { STATUSCODE, MESSAGE, ORDER_TYPE, STATUS, ORDER_DETAILS_TYPE } = require("../constant/const")
const { success, error } = require("../responce/res")
const Hotel = require("../model/hotel")
const { bookTable } = require("../validation/validate")
const TableBooking = require("../model/tablebooking")
const Table = require("../model/table")
const User = require("../model/user")
const sequelize = require("../connection/connect")
const { Op } = require("sequelize")
const TableCatagories = require("../model/table_catg")
const schedule = require("node-schedule")
const OrderDetails = require("../model/order_details")
const Order = require("../model/order")
// const moment = require("moment-timezone")
const moment = require('moment')

const scheduleJobs = async (start_time, end_time, booking_id, booking_date, hotel_id, table_name, user, t) => {
    try {



        // let startDate = moment(booking_date);
        // console.log(start_time)
        // let startTime = moment(start_time).format()

        schedule.scheduleJob(new Date(start_time), async () => {
            try {
                const tableName = []
                for (const TableId of table_name) {
                    const table = await Table.findOne({ where: { id: TableId } })
                    await Table.update({ table_status: "B" }, { where: { id: TableId } })
                    tableName.push(table)
                    const allOrderData = await Order.findAll({ where: { hotel_id: req.user, isOffline: false } })

                    const maxOnlineBillNo = allOrderData.reduce((max, invoice) => {
                        const numericValue = parseInt(invoice.bill_no, 10);
                        return numericValue > max ? numericValue : max;
                    }, 0);
                    await Order.create({ bill_no: `${maxOnlineBillNo + 1}`, status: ORDER_DETAILS_TYPE.IN_PROGRESS, order_type: ORDER_TYPE.DININ, hotel_id, TableId, UserId: user?.id })
                }
                const allTableData = tableName.map(el => {
                    return `Table ${el.table_name}`
                }).join('')


                const tables = await Table.findAll({
                    where: { hotel_id: hotel_id, active: true },
                    include: [
                        { model: TableCatagories },
                        {
                            model: Order,
                            include: [{ model: OrderDetails }],
                            where: {
                                status: {
                                    [Op.in]: [ORDER_TYPE.IN_PROGRESS, ORDER_TYPE.SUCCESS, ORDER_TYPE.HOLD]
                                },
                                payment: STATUS.PENDING,
                                deleted: false
                            },
                            required: false // Use required: false to perform LEFT JOIN instead of INNER JOIN
                        }
                    ], order: ['id']

                });
                // console.log(allTableData, "sedulaerpass The Data")
                io.to(hotel_id).emit("tableBookingStart", { name: allTableData, tables })
            } catch (err) {
                console.log(err)


            }
        })

    } catch (err) {
        console.log(err)
        throw new Error
    }
}
const tableBooking = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        // console.log(hotel)

        const { name, email, number, booking_date, start_time, end_time, no_of_person, totalAmount, gst_no, advance, table_name } = req.body
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const err = bookTable.validate({ name, email, number, booking_date, start_time, end_time, no_of_person, totalAmount, gst_no, advance, table_name }).error


        const timePart = start_time.split('T')[1];
        const combinedDateTimeString = `${booking_date}T${timePart}`;

        const valid = err == null
        if (valid) {

        }
        else {
            console.log(err, "error==>")
            const message = err.details.map((detail) => detail.message).join(",");
            return res.json(error(message, res.statusCode))
        }
        if (parseInt(advance) > parseInt(totalAmount)) {
            return res.json(error("Advance Payment Must Be Less Then or Equal Total Amount", res.statusCode))
        }
        let user = await User.findOne({ where: { number, hotel_id: hotel.id } })
        if (user) {

        } else {
            user = await User.create({ name, number, email, hotel_id: hotel.id }, { transaction: t })
        }

        const lastEntry1 = await TableBooking.findAll({
            where: { hotel_id: req.user, deleted: false }, order: [['id', 'DESC']],
        });
        const lastEntry = lastEntry1[0]
        for (const table of table_name) {
            const checkTableAvailable = await Table.findOne({ where: { id: table, hotel_id: hotel.id } })
            if (checkTableAvailable) {
                const findTableBookAlready = await TableBooking.findOne({
                    where: {
                        TableId: table,
                        start_time: {
                            [Op.lt]: end_time
                        },
                        end_time: {
                            [Op.gt]: start_time
                        }, booking_date: new Date(moment(booking_date)), hotel_id: hotel.id, deleted: false
                    }
                })

                if (findTableBookAlready) {
                    // throw error
                    await t.rollback()
                    return res.json(error(` ${checkTableAvailable.table_name} Is Already Booked In This Time Range`, STATUSCODE.CONFLICT))
                }
                else {
                    await TableBooking.create({ TableId: table, UserId: user.id, name, enter_by: req.userId, email, booking_id: lastEntry ? lastEntry.id + 1 : 1, number, booking_date, start_time, end_time, no_of_person, totalAmount, gst_no, advance, table_name, hotel_id: hotel.id }, { transaction: t })
                }
            } else {
                await t.rollback()
                return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
            }

        }


        await scheduleJobs(combinedDateTimeString, end_time, lastEntry ? lastEntry.id + 1 : 1, booking_date, hotel.id, table_name, user, t)
        await t.commit()

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.T_B }, STATUSCODE.SUCCESS))
    } catch (err) {
        await t.rollback()
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updateBooking = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        // console.log(hotel)
        const { id } = req.params
        const findBookingData = await TableBooking.findOne({ where: { booking_id: parseInt(id) } })
        if (!findBookingData) return res.json(error(MESSAGE.BOOKING_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        await TableBooking.destroy({ where: { booking_id: findBookingData.booking_id } }, { transaction: t })

        const { name, email, number, booking_date, start_time, end_time, no_of_person, totalAmount, gst_no, advance, table_name } = req.body
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const err = bookTable.validate({ name, email, number, booking_date, start_time, end_time, no_of_person, totalAmount, gst_no, advance, table_name }).error

        const valid = err == null
        if (valid) {
        }
        else {
            console.log(err, "error==>")
            const message = err.details.map((detail) => detail.message).join(",");
            return res.json(error(message, res.statusCode))
        }
        if (parseInt(advance) > parseInt(totalAmount)) {
            return res.json(error("Advance Payment Must Be Less Then or Equal Total Amount", res.statusCode))
        }
        let user = await User.update({ name, email, number }, { where: { id: findBookingData.UserId } }, { transaction: t })


        // const lastEntry1 = await TableBooking.findAll({
        //     where: { hotel_id: req.user, deleted: false }, order: [['id', 'DESC']],
        // });
        // const lastEntry = lastEntry1[0]
        for (const table of table_name) {
            const checkTableAvailable = await Table.findOne({ where: { id: table, hotel_id: hotel.id } })
            if (checkTableAvailable) {
                const findTableBookAlready = await TableBooking.findOne({
                    where: {

                        TableId: table,
                        start_time: {
                            [Op.lt]: end_time
                        },
                        end_time: {
                            [Op.gt]: start_time
                        }, hotel_id: hotel.id, deleted: false
                    }
                })

                if (findTableBookAlready) {
                    // throw error
                    await t.rollback()
                    return res.json(error(`${checkTableAvailable.table_name} Is Already Booked In This Time Range`, STATUSCODE.CONFLICT))
                }
                else {
                    await TableBooking.create({ TableId: table, UserId: findBookingData.UserId, name, enter_by: findBookingData.enter_by, modified_by: req.userId, email, booking_id: findBookingData.booking_id, number, booking_date, start_time, end_time, no_of_person, totalAmount, gst_no, advance, table_name, hotel_id: hotel.id }, { transaction: t })
                }
            } else {
                await t.rollback()
                return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
            }

        }
        // Same auto-open scheduling as tableBooking's create path above
        // (scheduleJobs) - this block used to reference `momentTime`, which
        // is never defined anywhere in this file (real ReferenceError,
        // confirmed live on every edit), and tried to
        // schedule.rescheduleJob a job named "booking_id${id}" that
        // create() never actually assigns that name to - schedule
        // .scheduleJob there registers an ANONYMOUS job, so there was
        // never a job under that key to reschedule in the first place.
        // Since this function already deletes and recreates the
        // TableBooking row wholesale (same pattern as create, right
        // above), it registers a fresh job the same way create does
        // instead. `findBookingData.UserId` is used directly (not the
        // `user` variable above - User.update(...) returns an
        // affected-row count, not a user instance, so it has no `.id` to
        // give scheduleJobs).
        
        const timePart = start_time.split('T')[1];
        const combinedDateTimeString = `${booking_date}T${timePart}`;
        await scheduleJobs(combinedDateTimeString, end_time, findBookingData.booking_id, booking_date, hotel.id, table_name, { id: findBookingData.UserId }, t)

        await t.commit()

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.BOOKING_UPDATED }, STATUSCODE.SUCCESS))
    } catch (err) {
        await t.rollback()
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getSingleBookingData = async (req, res) => {
    try {
        const { id } = req.params
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const allBookingData = await TableBooking.findAll({ where: { booking_id: id, hotel_id: hotel.id, deleted: false }, include: [{ model: Table, include: { model: TableCatagories } }, { model: User }] })

        let data = {}
        if (allBookingData.length > 1) {
            data = {
                booking_id: allBookingData[0].booking_id,
                name: allBookingData[0].hms_user_master.name, email: allBookingData[0].hms_user_master.email, no_of_persons: allBookingData[0].no_of_persons, number: allBookingData[0].hms_user_master.number, booking_date: allBookingData[0].booking_date, start_time: allBookingData[0].start_time, end_time: allBookingData[0].end_time, no_of_person: allBookingData[0].no_of_person, totalAmount: allBookingData[0].totalAmount, gst_no: allBookingData[0].gst_no, advance: allBookingData[0].advance, table_name: [allBookingData[0].hms_table_mst]
            }
            for (let i = 1; i < allBookingData.length; i++) {
                const element = allBookingData[i];
                data.table_name.push(element.hms_table_mst)
            }
        } else {
            data = {
                booking_id: allBookingData[0].booking_id,
                name: allBookingData[0].hms_user_master.name, email: allBookingData[0].hms_user_master.email, no_of_persons: allBookingData[0].no_of_persons, number: allBookingData[0].hms_user_master.number, booking_date: allBookingData[0].booking_date, start_time: allBookingData[0].start_time, end_time: allBookingData[0].end_time, no_of_person: allBookingData[0].no_of_person, totalAmount: allBookingData[0].totalAmount, gst_no: allBookingData[0].gst_no, advance: allBookingData[0].advance, table_name: [allBookingData[0].hms_table_mst]
            }
        }
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, data, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getBookingData = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const allBookings = await TableBooking.findAll({ where: { hotel_id: hotel.id, deleted: false }, include: [{ model: Table, include: { model: TableCatagories } }, { model: User }] })

        let bookings = []
        // console.log(allBookings)

        let data = {}

        for (const allBooking of allBookings) {


            const filterBooking = bookings.filter(el => {
                if (el.booking_id == allBooking.booking_id) {
                    return el
                }
            })
            if (filterBooking.length) {
                // console.log(bookings, "before==========>")
                // console.log(allBooking, allBooking.id, "allBookings==========>")

                bookings = bookings.map(el => {
                    if (el.booking_id == allBooking.booking_id) {
                        // console.log(el, "element =============>")
                        el.table_name.push(allBooking.hms_table_mst)
                    }
                    return el
                })

                // console.log(bookings, "after==========>")
            } else {
                data = {
                    booking_id: allBooking.booking_id,
                    name: allBooking.hms_user_master.name, email: allBooking.hms_user_master.email, no_of_persons: allBooking.no_of_persons, number: allBooking.hms_user_master.number, booking_date: allBooking.booking_date, start_time: allBooking.start_time, end_time: allBooking.end_time, no_of_person: allBooking.no_of_person, totalAmount: allBooking.totalAmount, gst_no: allBooking.gst_no, advance: allBooking.advance, table_name: [allBooking.hms_table_mst]
                }
                bookings.push(data)
            }


        }


        // for (const table of allBookings) {
        //     data.table_name.push(table.hms_table_mst)
        // }
        // console.log(bookings)
        return res.json(success(MESSAGE.SUCCESS, { bookings }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const deleteBookings = async (req, res) => {
    try {
        const { id } = req.body
        console.log(id)
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        await TableBooking.update({ deleted: true }, { where: { booking_id: id, hotel_id: hotel.id } })
        schedule.cancelJob(`booking_id${id}`)
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.BOOKING_DELETED }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { getSingleBookingData, deleteBookings, tableBooking, updateBooking, getBookingData }