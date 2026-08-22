const Hotel = require("../model/hotel")
const Table = require("../model/table")
const { MESSAGE, STATUSCODE, USER_ROLE, ORDER_TYPE, STATUS } = require("../constant/const")
const { success, error } = require("../responce/res")
const User = require("../model/user")
const Order = require("../model/order")
const bcrypt = require("bcrypt")
const TableCatagories = require("../model/table_catg")
const { Op } = require("sequelize")
const Role = require("../model/role_mst")
const OrderDetails = require("../model/order_details")
const { sha256 } = require("js-sha256")
const HotelUser = require("../model/hotelUser")
const UserAccess = require("../model/userAccess")
const { createLogFile } = require("../logs/log")
const sequelize = require("../connection/connect")
const InvoiceFormate = require("../model/invoiceFormate")
const ServiceCharge = require("../model/serviceCharge")
const TaxType = require("../model/taxType")
const { updatedRestaurantToRadis, newTableCreatedToRadis, updateTableCategoryToRadis, deleteAllTableByCategoryToRedis, deleteTableCategoryToRedis, deleteTableToRedis, updateTableToRadis, newTableCategoryCreatedToRadis } = require("./redis/redisCrud")
const Subscription = require("../model/subscription/subscription")
const Plan = require("../model/subscription/plan")
const SubscriptionPayment = require("../model/subscription/subscriptionPayment")
const moment = require('moment')
const { superAdminModel, SuperAdminUser, RestaurantSetting, SyncIndexDB } = require("../model")
const saltRounds = 10

const addHotelDetails = async (req, res) => {
    try {
        const finHotel = await Hotel.findOne({ where: { owner_number: JSON.parse(req.body.documents).owner_number } })
        const finUser = await HotelUser.findOne({ where: { number: JSON.parse(req.body.documents).owner_number } })
        // console.log(req.user, "Req.user::::")

        // console.log(req.files.hotel_logo)
        // console.log(req.files.payment_image)
        // console.log(JSON.parse(req.body.documents))

        if (finHotel || finUser) {
            return res.json(
                error(MESSAGE.HOTEL_ALREADY_REGISTEREd, STATUSCODE.CONFLICT)
            )
        }
        const hotel_logo = req?.files?.hotel_logo[0] || ""
        const pyamentImage = req?.files?.payment_image[0] || ""
        const reqData = JSON.parse(req.body.documents)
        const hotelData = {
            ...reqData, plan_end_date: new Date(moment(JSON.parse(req.body.documents).planData.plan_end_date).endOf('day')), plan_start_date: new Date(moment(JSON.parse(req.body.documents).planData.plan_start_date).startOf('day')),
            hotel_logo: hotel_logo.fieldname + '-' + hotel_logo.originalname,
            created_by: req.user,
        }
        const create = await Hotel.create(hotelData)
        await RestaurantSetting.create({ hotel_id: create.id })
        const role = await Role.create({ role_name: USER_ROLE.ADMIN, hotel_id: create.id })
        const hashedOwnerPassword = await bcrypt.hash(JSON.parse(req.body.documents).password, 10)
        const user = await HotelUser.create({ created_by: req.user, role_cd: role.role_cd, hotel_id: create.id, email: JSON.parse(req.body.documents).owner_email_id, number: JSON.parse(req.body.documents).owner_number, name: JSON.parse(req.body.documents).owner_name, active: true, password: hashedOwnerPassword })

        const access = [
            { access_name: 'Order', read: true, create: true, edit: true, delete: true },
            { access_name: 'Table', read: true, create: true, edit: true, delete: true },
            { access_name: 'Menu', read: true, create: true, edit: true, delete: true },
            { access_name: 'DashBoard', read: true, create: true, edit: true, delete: true },
            { access_name: 'Reports', read: true, create: true, edit: true, delete: true },
            { access_name: 'Biller', read: true, create: true, edit: true, delete: true },
            { access_name: 'User', read: true, create: true, edit: true, delete: true },
            { access_name: 'Booking', read: true, create: true, edit: true, delete: true },
            { access_name: 'Stock', read: true, create: true, edit: true, delete: true },
            { access_name: 'Expense', read: true, create: true, edit: true, delete: true },
            { access_name: 'Zomato', read: true, create: true, edit: true, delete: true },
        ]
        for (const cur of access) {
            await UserAccess.create({ access_name: cur.access_name, read: cur.read, create: cur.create, edit: cur.edit, delete: cur.delete, hotel_id: create.id, hotelUser_id: user.id })
        }

        const { discountrate, gst, discount, grandAmount, subTotal, plan_id, gst_calculated, plan_start_date, plan_end_date } = JSON.parse(req.body.documents).planData

        // console.log(new Date(moment(plan_start_date).startOf('day')), new Date(moment(plan_end_date).endOf('day')), "Date:::")
        const newSubscription = await Subscription.create({
            discountrate: +discountrate,
            hotel_id: create.id,
            plan_id: +plan_id,
            start_date: new Date(moment(plan_start_date).startOf('day')),
            end_date: new Date(moment(plan_start_date).add(1, 'year')),
            subTotal,
            discount,
            gst,
            gst_calculated,
            grandAmount,
            subscription_extend_count: 0
        });
        const { payment_method, payment_date, amount_paid, UTR_NO } = JSON.parse(req.body.documents).payment_info
        await SubscriptionPayment.create({
            subscription_id: newSubscription.id,
            payment_method,
            payment_date,
            // payment_image:pyamentImage
            amount_paid: amount_paid,
            UTR_No: UTR_NO,
            payment_image: pyamentImage.fieldname + '-' + pyamentImage.originalname,
            note: "", hotel_id: create.id
        });

        return res.json(
            success(MESSAGE.SUCCESS, { message: MESSAGE.HOTEL_REGISTER }, STATUSCODE.CREATED)
        )

    } catch (err) {
        // createLogFile(req.user, ` addHotelDetails/err Error`, err);
        console.log("error from catch block===>", err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE
            .INTERNAL_SERVER_ERROR))
    }
}
const editHotelDetails = async (req, res) => {
    try {
        const { id, owner_number, owner_email_id, owner_name, password } = JSON.parse(req.body.documents);
        // console.log(JSON.parse(req.body.documents), "Datat:::::::::::")
        // 1. Find existing hotel
        const existingHotel = await Hotel.findByPk(id);
        if (!existingHotel) {
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.NOT_FOUND));
        }

        // 2. Check for duplicate owner_number in other hotels
        const duplicateHotel = await Hotel.findOne({
            where: {
                owner_number,
                id: { [Op.ne]: id } // not the same hotel
            }
        });
        const duplicateUser = await HotelUser.findOne({
            where: {
                number: owner_number,
                hotel_id: { [Op.ne]: id }
            }
        });

        if (duplicateHotel || duplicateUser) {
            return res.json(error("Hotel Already Registedred", STATUSCODE.CONFLICT));
        }

        // 3. Prepare update data
        const reqData = JSON.parse(req.body.documents);
        // console.log(req.file && reqData.hotel_logo, "condifiton:::")
        if (req.file) {
            reqData.hotel_logo = req.file.fieldname + '-' + req.file.originalname;
        } else {
            // If no new file uploaded, retain the existing hotel_logo
            reqData.hotel_logo = existingHotel.hotel_logo;
        }

        // console.log(reqData, "reqwData::")
        // 4. Update hotel
        await Hotel.update({ ...reqData }, { where: { id } });

        // 5. Update hotel user (Admin)
        const adminUser = await HotelUser.findOne({ where: { hotel_id: id }, include: { model: Role, where: { role_name: USER_ROLE.ADMIN }, require: true } });
        console.log(adminUser, "Admin User::::")
        if (adminUser) {
            await HotelUser.update({
                email: owner_email_id,
                number: +owner_number,
                name: owner_name,
                password: password
                // update password only if provided
            }, {
                where: {
                    number: +adminUser.number,
                    hotel_id: id
                }
            });
        }

        return res.json(
            success(MESSAGE.SUCCESS, { message: "Restaurant Updated " }, STATUSCODE.CREATED)
        );

    } catch (err) {
        console.log("Error while editing restaurant:", err);
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR));
    }
};
const getHotel = async (req, res) => {
    try {
        console.log("Here", req.query)
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const search = req?.query?.search || ""

        if (page < 1) {
            return res.status(STATUSCODE.BAD_REQUEST).json(
                error("Page number must be greater than 0", STATUSCODE.BAD_REQUEST)
            );
        }
        const offset = (page - 1) * limit;
        const condition = {};
        if (search) {
            condition.hotel_name = {
                [Op.like]: `%${search}%`
            };
        }
        const paymentData = await Subscription.findOne({ where: { hotel_id: 227 }, include: [{ model: SubscriptionPayment }] })
        // console.log(JSON.parse(JSON.stringify(paymentData)), "Payment Data:::")
        const { count, rows: restaurants } = await Hotel.findAndCountAll({
            where: condition, limit: limit,
            offset: offset, attributes: ['hotel_logo', 'hotel_name', 'id', 'owner_name', 'owner_number', "createdAt", 'menu_uploaded', "traningCompleted_date", "traningCompleted", "menu_uploaded_date"], include: [
                {
                    model: Subscription,
                    required: false,
                    attributes: ['id', 'start_date', 'end_date', 'createdAt', "plan_id", "grandAmount"],
                    include: [{
                        model: SubscriptionPayment, separate: true,   // 🔥 FIX
                        order: [['createdAt', 'ASC']]
                    }, { model: Plan, attributes: ["name"] }],
                    order: [['createdAt', 'DESC']],
                    limit: 1
                }, { model: superAdminModel, attributes: ['name'] }
            ],
            order: [['createdAt', 'DESC']]
        });

        // console.log(JSON.stringify(restaurants.filter(el => el.id == 1)), "Length::")

        const totalPages = Math.ceil(count / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        const responseData = {
            restaurants,
            pagination: {
                currentPage: page,
                totalPages: totalPages,
                totalItems: count,
                itemsPerPage: limit,
                hasNextPage: hasNextPage,
                hasPrevPage: hasPrevPage,
                nextPage: hasNextPage ? page + 1 : null,
                prevPage: hasPrevPage ? page - 1 : null
            }
        };

        // console.log(JSON.parse(JSON.stringify(responseData.restaurants[0].hms_subscription_msts[0])), "Data::::")
        return res.status(STATUSCODE.SUCCESS).json(
            success(MESSAGE.SUCCESS, responseData, STATUSCODE.SUCCESS)
        );

    } catch (err) {
        console.error('Error fetching hotels:', err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(
            error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
        );
    }
};
const updateInvoiceFormate = async (req, res) => {
    try {
        // const user = await HotelUser.findOne({ where: { id: req.user } })

        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        // console.log(req.body)
        const { gst_no, fssai_no, invoiceFormateIncGst, multiLanguage, bill_with_kot, is_token_on, bill_with_token, service_charge, saveBehave } = req.body.hotel
        await Hotel.update({ gst_no, fssai_no, multiLanguage, saveBehave, service_charge, invoiceFormateIncGst, bill_with_kot, is_token_on, bill_with_token }, { where: { id: hotel.id } })
        // setImmediate(() => {

        await updatedRestaurantToRadis(hotel.id)
        // });
        return res.status(200).json(success(MESSAGE.SUCCESS, { message: MESSAGE.INVOICE_FORMATE_CHANGE }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` updateInvoiceFormate/err Error`, err);
        console.log(err.message, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getSingleHotel = async (req, res) => {
    try {
        let syncRecord = await SyncIndexDB.findOne({
            where: { hotel_id: req.user }
        });

        if (!syncRecord) {
            syncRecord = await SyncIndexDB.create({
                hotel_id: req.user,
                menu_version: 1,
                menu_categ_version: 1
            });
        }
        const restaurants = await Hotel.findOne({ where: { id: req.user }, include: [{ model: InvoiceFormate, required: false }, { model: ServiceCharge, required: false }, { model: RestaurantSetting }, { model: SyncIndexDB }, { model: TaxType, where: { active: true }, required: false }] })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, restaurants, STATUSCODE.SUCCESS))
    } catch (err) {
        createLogFile(req.user, ` getSingleHotel/err Error`, err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// ! Table Controller  seprate this all routes

const addTableCategory = async (req, res) => {

    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { table_catag_nm, type = "T" } = req.body
        if (!table_catag_nm) return res.json(error(MESSAGE.TABLE_CATEGORY_REQUIRE, STATUSCODE.CONFLICT))
        if (!/^[A-Za-z0-9\s&.,'()\-\[\]]+$/.test(table_catag_nm)) {
            return res.json(error("Please Enter  Valid  Category Name", STATUSCODE.BAD_REQUEST));
        }
        const tableCategory = await TableCatagories.findOne({ where: { table_catag_nm, hotel_id: req.user, active: true, type } })
        if (tableCategory) return res.json(error(type === "T" ? MESSAGE.TABLE_CATEGORY_ALREADY_AVAILABLE : "Rooms Category Available", STATUSCODE.CONFLICT))
        const category = await TableCatagories.create({ type, table_catag_nm, hotel_id: req.user })
        // setImmediate(() => {

        await newTableCategoryCreatedToRadis(category.id, req.user)
        // });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.TABLE_CATEGORY_ADDED }, STATUSCODE.CREATED))
    } catch (err) {
        //createLogFile(req.user, ` addTableCategory/err Error`, err);
        //console.log(err.message)
        // //console.log(err.message, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }

}
const getTableCatagories = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const tableCatagories = await TableCatagories.findAll({ where: { hotel_id: hotel.id, active: true }, include: { model: Table } });

        return res.json(success(MESSAGE.SUCCESS, { tableCatagories }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` getTableCatagories/err Error`, err);
        console.log(err)
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const editTableCatagories = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })

        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { table_catag_nm, id } = req?.body
        const { type } = req?.body
        const findTableCategory = await TableCatagories.findByPk(id)
        if (!findTableCategory) return res.json(error("Table Category Not Found", STATUSCODE.BAD_REQUEST))

        if (!/^[A-Za-z0-9\s&.,'()\-\[\]]+$/.test(table_catag_nm)) {
            return res.json(error("Please Enter  Valid Table Category Name", STATUSCODE.BAD_REQUEST));
        }
        await TableCatagories.update({ table_catag_nm }, { where: { id: id, active: true, type } })
        // setImmediate(() => {

        await updateTableCategoryToRadis(id, req.user)
        // });
        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: type === "T" ? MESSAGE.Table_CATEGORY_UPDATED : "Rooms category Updated" }, STATUSCODE.SUCCESS))

    } catch (err) {
        //createLogFile(req.user, ` editTableCatagories/err Error`, err);
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const removeTableCatagories = async (req, res) => {
    const t = await sequelize.transaction()
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user }, transaction: t })

        if (!hotel) {
            await t.rollback()
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        }

        const { allId } = req.body
        console.log(allId, req.body.id)
        if (allId) {
            for (const id of allId) {
                let availableCatagories = await TableCatagories.findOne({ where: { id, hotel_id: req.user }, transaction: t })

                if (!availableCatagories) {
                    await t.rollback()
                    return res.json(error(MESSAGE.CATAGORIES_NOT_FOUND, STATUSCODE.NOT_FOUND))
                }
                await TableCatagories.update({ active: false }, { where: { id, hotel_id: req.user }, transaction: t })

                const findRunningTable = await Table.findOne({ where: { table_catag_id: id, hotel_id: req.user, table_status: { [Op.ne]: "F" } }, transaction: t })
                if (findRunningTable) {
                    await t.rollback()
                    return res.json(error("Some Table Are Running On This Table Category", STATUSCODE.INTERNAL_SERVER_ERROR))
                }
                await Table.update({ active: false }, { where: { table_catag_id: id }, transaction: t })
                // setImmediate(() => {

                await deleteAllTableByCategoryToRedis(id, req.user)
                await deleteTableCategoryToRedis(id, req.user)
                // });
            }
            await t.commit()
            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.CATAGORIES_DELETED }, STATUSCODE.SUCCESS))
        }
        let availableCatagories = await TableCatagories.findOne({ where: { id: req.body.id, active: true }, transaction: t })
        console.log(availableCatagories)
        if (!availableCatagories) {
            await t.rollback()
            return res.json(error(MESSAGE.CATAGORIES_NOT_FOUND, STATUSCODE.NOT_FOUND))
        }
        await TableCatagories.update({ active: false }, { where: { id: req.body.id }, transaction: t })
        const findRunningTable = await Table.findOne({ where: { table_catag_id: req.body.id, hotel_id: req.user, table_status: { [Op.ne]: "F" } }, transaction: t })

        if (findRunningTable) {
            await t.rollback()
            return res.json(error("Some Table Are Running On This Table Category", STATUSCODE.INTERNAL_SERVER_ERROR))
        }

        await Table.update({ active: false }, { where: { table_catag_id: req.body.id }, transaction: t })
        await t.commit()
        // setImmediate(() => {

        await deleteAllTableByCategoryToRedis(req.body.id, req.user)
        await deleteTableCategoryToRedis(req.body.id, req.user)
        // });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: MESSAGE.CATAGORIES_DELETED }, STATUSCODE.SUCCESS))

    } catch (err) {
        await t.rollback()
        //createLogFile(req.user, ` removeTableCatagories/err Error`, err);
        console.log(err)
        //console.log(err.message, "=====>error")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const searchByTableCatagories = async (req, res) => {
    try {
        const id = req.user
        // //console.log(req, req.params, req.query, "from api request")
        const { key } = req.params
        const hotel = await Hotel.findOne({ where: { id } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const tables = await Table.findAll({
            where: { hotel_id: req.user, table_catag_id: key, active: true },
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
            ]
        });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tables }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` searchByTableCatagories/err Error`, err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getTable = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const tables = await Table.findAll({
            where: { hotel_id: req.user, active: true },
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
                    required: false
                }
            ],

        });

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tables }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, ` GetTable/err Error`, err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getTableCatagoriesWise = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const tables = await TableCatagories.findAll({
            where: { hotel_id: req.user, active: true },
            include: [
                {
                    model: Table, include: [
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
                            required: false
                        }, { model: TableCatagories }
                    ], required: false
                },

            ],


        });



        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tables }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        //createLogFile(req.user, ` getTableCatagoriesWise/err Error`, err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const liveTable = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { key } = req.params
        let tables
        //console.log(key, "======================================key")
        if (key === "live") {
            // tables = await Table.findAll({ where: { hotel_id: req.user, [Op.or]: [{ table_status: "P" }, { table_status: "R" }], active: true }, include: [{ model: TableCatagories }], })
            tables = await Table.findAll({
                where: { hotel_id: req.user, active: true, [Op.or]: [{ table_status: "P" }, { table_status: "R" }] },
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
        }
        if (key === "free") {
            // tables = await Table.findAll({ where: { hotel_id: req.user, table_status: "F", active: true }, include: [{ model: TableCatagories }] })

            tables = await Table.findAll({
                where: { hotel_id: req.user, active: true, table_status: "F" },
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
        }




        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tables }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        //createLogFile(req.user, ` liveTable/err Error`, err);
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getTableForCaptain = async (req, res) => {
    try {

        // //console.log(req.user, "from get Table===>")
        const role = await Role.findOne({ role_name: USER_ROLE.CAPTAIN })
        const user = await User.findOne({ where: { id: req.user, role_cd: role.role_cd } })
        // //console.log(user, "from get Table====>")

        if (!user) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        // const role = user.role
        // if (role !== "Receptionist") {
        //     return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.BAD_REQUEST))
        // }

        const tables = await Table.findAll({ where: { hotel_id: user.hotel_id } })
        // //console.log(tables, "tables===>")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { tables }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` getTableForCaptain/err Error`, err);

        // //console.log(err.message, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const reservedTable = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        // //console.log(hotel)
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        // const role = user.role
        // if (role !== "Receptionist") {
        //     return res.json(error(MESSAGE.NOT_ACCESS, STATUSCODE.BAD_REQUEST))
        // }

        const tables = await Table.findOne({ where: { tableNumber: req.body.tableNumber, hotel_id: req.user } })
        if (!tables) {
            return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
        }
        const updateTable = await Table.update({ vacant: false }, { where: { tableNumber: req.body.tableNumber, hotel_id: req.user } })
        // //console.log(updateTable, "updatede====>")
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Table Reserved" }, STATUSCODE.SUCCESS))
    } catch (err) {

        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

const addTable = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })

        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        const { startNo, endNo, table_catag_id, type } = req.body

        // const table_number = tableNumber
        // if (!table_catagories) return res.json(error(MESSAGE.TABLE_CATEGORY_REQUIRE, STATUSCODE.CONFLICT))
        const tableCategory = await TableCatagories.findOne({ where: { id: table_catag_id, hotel_id: req.user, active: true, type } })
        if (!tableCategory) return res.json(error(MESSAGE.TABLE_CATEGORY_NOT_AVAILABLE, STATUSCODE.CONFLICT))

        for (let i = +startNo; i <= +endNo; i++) {
            const table = await Table.findOne({ where: { table_catag_id, hotel_id: req.user, table_name: i, type } })
            if (table) {
                await table.update({ active: true }, { id: table.id })
                // setImmediate(() => {
                await newTableCreatedToRadis(table.id, req.user)
                // });
            } else {
                const table = await Table.create({ table_name: parseInt(i), type, table_catag_id, hotel_id: req.user })
                // setImmediate(() => {
                await newTableCreatedToRadis(table.id, req.user)
                await updateTableCategoryToRadis(table_catag_id, req.user)
                // });
            }
        }

        return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.TABLE_ADDED }, STATUSCODE.CREATED))


    } catch (err) {
        //createLogFile(req.user, ` addTable/err Error`, err);
        console.log(err)

        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const removeTable = async (req, res) => {
    const t = await sequelize.transaction()
    try {

        const hotel = await Hotel.findOne({ where: { id: req.user }, transaction: t })
        if (!hotel) {
            await t.rollback()
            return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        }

        const { allId } = req.body
        if (allId) {
            for (const id of allId) {
                let availableCatagories = await Table.findOne({ where: { id, hotel_id: req.user, active: true }, transaction: t })
                if (!availableCatagories) return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
                const table = await Table.findOne({ where: { id }, transaction: t })
                if (table.table_status === "F") {

                    await Table.update({ active: false }, { where: { id }, transaction: t })
                    // setImmediate(() => {

                    await deleteTableToRedis(id, req.user)
                    // });
                } else {
                    await t.rollback()
                    return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))

                }
            }
            await t.commit()
            return res.status(STATUSCODE.CREATED).json(success(MESSAGE.SUCCESS, { message: MESSAGE.CATAGORIES_DELETED }, STATUSCODE.SUCCESS))
        }
        const tables = await Table.findOne({ where: { id: req.body.id, hotel_id: req.user, active: true }, transaction: t })
        if (!tables) {
            await t.rollback()
            return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
        }

        if (tables.table_status !== 'F') {
            await t.rollback()
            return res.json(error(MESSAGE.RESERVED_TABLE_YOU_CAN_NOT_DETELE, STATUSCODE.FORBIDDEN))
        }
        const removeTable = await Table.update({ active: false }, { where: { id: req.body.id, hotel_id: req.user } })

        //TODO remove all Table form hotel const 
        // removeTable = await Table.destroy({ where: { hotel_id: req.user } })
        await t.commit()
        // setImmediate(() => {

        await deleteTableToRedis(req.body.id, req.user)
        // });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Table Remove" }, STATUSCODE.SUCCESS))
    } catch (err) {
        await t.rollback()
        //createLogFile(req.user, ` removeTable/err Error`, err);
        //console.log(err.message, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const editTable = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { table_name, id, table_catag_id, type } = req.body
        const tableCategory = await TableCatagories.findOne({
            where: {
                id: table_catag_id, hotel_id: req.user, active: true,
            }
        })
        if (!tableCategory) return res.json(error(MESSAGE.TABLE_CATEGORY_NOT_AVAILABLE, STATUSCODE.BAD_REQUEST))
        const tables = await Table.findOne({ where: { id, hotel_id: req.user, active: true } })
        if (!tables) {
            return res.json(error(MESSAGE.TABLE_NOT_AVAILABLE, STATUSCODE.NOT_FOUND))
        }
        if (tables.table_status !== "F") {
            return res.json(error("Table Can't Update It's Running", STATUSCODE.BAD_REQUEST))
        }
        await Table.update({ table_name: table_name, table_catag_id }, { where: { id, hotel_id: req.user } })
        // setImmediate(() => {

        await updateTableToRadis(id, req.user)
        // });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: type === "T" ? "Table Updated" : "Room Updated" }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` editTable/err Error`, err);
        //console.log(err.message, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}

const tableWiseRetrieveOrder = async (req, res) => {
    try {
        const table = await Table.findOne({ where: { id: req.body.id, hotel_id: req.user } })
        let order = ""
        if (table.table_status === "R") {
            order = await Order.findOne({ where: { TableId: table.id, status: ORDER_TYPE.IN_PROGRESS, payment: STATUS.PENDING } })
        } else if (table.table_status === "P") {
            order = await Order.findOne({ where: { TableId: table.id, status: ORDER_TYPE.SUCCESS, payment: STATUS.PENDING } })
        } else if (table.table_status === "H") {
            order = await Order.findOne({ where: { TableId: table.id, status: ORDER_TYPE.HOLD, payment: STATUS.PENDING } })
        }
        else {
            return res.json(success(MESSAGE.SUCCESS, true, STATUSCODE.SUCCESS))
        }
        return res.json(success(MESSAGE.SUCCESS, { order }, STATUSCODE.SUCCESS))
    } catch (err) {
        //createLogFile(req.user, ` tableWiseRetrieveOrder/err Error`, err);
        //console.log(err.message, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const jsPrintManager = async (req, res) => {
    try {
        //SET THE LICENSE INFO
        var licence_owner = process.env.LICENCE_OWNER_KEY;
        var licence_key = process.env.LICENCE_PRIVATE_KEY;

        //DO NOT MODIFY THE FOLLOWING CODE
        // var timestamp = req.query.timestamp;
        var licence_hash = sha256(licence_key);

        const soketUrl = process.env.SOCKET_URL.split("//")

        res.send(licence_owner + ";" + soketUrl[1] + "|" + licence_hash);

    } catch (err) {
        console.log(err)
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const getHotelId = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        return res.json(success(MESSAGE.SUCCESS, { hotel_id: hotel.id }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))

    }
}
const setDisplay = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        const { display } = req.body
        if (display === 'T' || display === 'K') {
            await Hotel.update({ display }, { where: { id: req.user } })
            // setImmediate(() => {

            await updatedRestaurantToRadis(req.user)
            // });
            const displaySet = display === 'K' ? 'KeyBoard' : "Touch"
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: displaySet + " " + MESSAGE.D_s }, STATUSCODE.SUCCESS))
        } else {
            return res.json(error(MESSAGE.P_E_V_D_N, STATUSCODE.BAD_REQUEST))
        }
    } catch (err) {
        //createLogFile(req.user, ` setDisplay/err Error`, err);
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const setMenuShow = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        const { show_menu_with_image } = req.body
        // if (show_menu_with_image ) {
        await Hotel.update({ show_menu_with_image }, { where: { id: req.user } })
        // setImmediate(() => {

        await updatedRestaurantToRadis(req.user)
        // });
        // const displaySet = display === 'K' ? 'KeyBoard' : "Touch"
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Set Menu Setting" }, STATUSCODE.SUCCESS))
        // } else {
        // return res.json(error(MESSAGE.P_E_V_D_N, STATUSCODE.BAD_REQUEST))
        // }
    } catch (err) {
        //createLogFile(req.user, ` setDisplay/err Error`, err);
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const addEditServiceCharge = async (req, res) => {
    try {
        const { id,
            active,
            service_charge_type,
            service_charge_value,
            calculation_on,
            service_charge_automatic,
            calculation_on_tax,
            greater_less,
            greater_less_amount } = req.body

        const getServiceCharge = await ServiceCharge.findOne({ where: { hotel_id: req.user } })
        if (getServiceCharge) {

            await ServiceCharge.update({
                active,
                service_charge_type,
                service_charge_value,
                calculation_on,
                service_charge_automatic,
                calculation_on_tax,
                greater_less,
                greater_less_amount
            }, { where: { id, hotel_id: req.user } })
        } else {
            await ServiceCharge.create({
                active,
                service_charge_type,
                service_charge_value,
                calculation_on,
                service_charge_automatic,
                calculation_on_tax,
                greater_less,
                greater_less_amount,
                hotel_id: req.user
            })
        }
        // setImmediate(() => {

        await updatedRestaurantToRadis(req.user)
        // });
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Service Charger Configuration Modified" }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


async function insertDefaultRestaurantSettings() {
    try {


        const hotels = await Hotel.findAll({
            attributes: ["id"],
            raw: true
        });

        if (!hotels.length) {
            console.log("No hotels found");
            return;
        }

        // 2️⃣ Get existing settings
        const existingSettings = await RestaurantSetting.findAll({
            attributes: ["hotel_id"],
            raw: true
        });

        const existingHotelIds = new Set(
            existingSettings.map(s => s.hotel_id)
        );

        // 3️⃣ Prepare missing settings
        const settingsToInsert = hotels
            .filter(h => !existingHotelIds.has(h.id))
            .map(h => ({
                hotel_id: h.id,
                order_sequence_opention: false
            }));

        if (!settingsToInsert.length) {
            console.log("All restaurants already have settings");
            return;
        }
        await RestaurantSetting.bulkCreate(settingsToInsert);
        console.log(
            `Inserted default settings for ${settingsToInsert.length} restaurants`
        );

    } catch (error) {
        console.error("Error inserting default restaurant settings:", error);
    } finally {

    }
}
module.exports = { insertDefaultRestaurantSettings, setMenuShow, editHotelDetails, addEditServiceCharge, setDisplay, getTableCatagoriesWise, getHotelId, jsPrintManager, liveTable, tableWiseRetrieveOrder, searchByTableCatagories, removeTableCatagories, editTableCatagories, addTableCategory, updateInvoiceFormate, getSingleHotel, getTableCatagories, getTableForCaptain, addHotelDetails, getHotel, addTable, getTable, reservedTable, removeTable, editTable }
