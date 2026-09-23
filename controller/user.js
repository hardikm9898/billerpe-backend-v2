const Hotel = require("../model/hotel")
const User = require("../model/user")
const { success, error } = require("../responce/res")
const { MESSAGE, STATUSCODE, USER_ROLE, STATUS } = require("../constant/const")
const bcrypt = require("bcrypt")
const Table = require("../model/table")
const Role = require("../model/role_mst")
const TableCatagories = require("../model/table_catg")

const UserAccess = require("../model/userAccess")
const { userSchema, userSchemaUpdate } = require("../validation/validate")
const { Op } = require("sequelize")
const HotelUser = require("../model/hotelUser")

const fs = require('fs')
const path = require("path")
const { number } = require("joi")
const sequelize = require("../connection/connect")
const saltRounds = 10





const createUser = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { name, role, email, number, access_name, password, pin } = req.body

        const err = userSchema.validate(req.body).error
        const valid = err == null
        if (valid) {
        }
        else {
            console.log(err, "error==>")
            const message = err.details.map((detail) => detail.message).join(",");
            return res.json(error(message, STATUSCODE.VALIDATION_ERROR))
        }

        let user = await HotelUser.findOne({ where: { number } })
        if (user) return res.json(error(MESSAGE.MOBILE_ALREADY_USED, STATUSCODE.CONFLICT))
        let roleData = await Role.findOne({ where: { role_name: role, hotel_id: req.user } })
        if (!roleData) {
            roleData = await Role.create({ role_name: role, enter_by: hotel.hotel_name, hotel_id: req.user })
        }
        const hashedPassword = await bcrypt.hash(password, saltRounds)
        const hashedPin = pin ? await bcrypt.hash(pin, saltRounds) : null
        user = await HotelUser.create({ name, role_cd: roleData.role_cd, email, number, active: true, hotel_id: req.user, password: hashedPassword, pin: hashedPin })
        // user = await User.findOne({ where: { email, number, hotel_id: req.user } })
        for (const access of access_name) {
            await UserAccess.create({ access_name: access?.access, create: access.permissions.create, read: access.permissions.read, edit: access.permissions.edit, delete: access.permissions.delete, hotelUser_id: user?.id, hotel_id: req.user })
        }
        return res.json(success(MESSAGE.SUCCESS, { message: MESSAGE.CREATE_USER }, STATUSCODE.CREATED))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}

const getCaptainUser = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        const users = await HotelUser.findAll({
            where: { hotel_id: req.user },
            attributes: { exclude: ["password", "pin", "refresh_token"] },
            include: [
                {
                    model: Role,
                    where: { role_name: { [Op.or]: ["C", "A", "B"] } }
                },
                { model: UserAccess },
                // A=Admin B=Biller C=captain
            ]
        })



        return res.json(success(MESSAGE.SUCCESS, { users }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const updateUser = async (req, res) => {
    try {
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const { name, role, email, number, access_name, id, active, password, pin } = req.body
        console.log(id)
        const err = userSchemaUpdate.validate({ name, role, email, number, password, pin }).error
        const valid = err == null
        if (valid) {

        }
        else {
            console.log(err, "error==>")
            const message = err.details.map((detail) => detail.message).join(",");
            return res.json(error(message, STATUSCODE.VALIDATION_ERROR))
        }

        let user = await HotelUser.findOne({ where: { hotel_id: req.user, id } })
        if (!user) return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.BAD_REQUEST))

        // The outlet owner's own login is locked (owner rule, 2026-09-22):
        // never turned off, never moved to another role, permissions never
        // changed - and only the owner may change their own details. Same
        // rule as the exe (billerpe-local-exe/helpers/ownerAccount.js); it has
        // to hold here too, because staff accounts sync down from here.
        const onlyDigits = (v) => String(v ?? "").replace(/\D/g, "")
        const ownerAccount = onlyDigits(hotel.owner_number) && onlyDigits(user.number) === onlyDigits(hotel.owner_number)
        if (ownerAccount) {
            if (active === false || active === "false" || active === 0) {
                return res.json(error("This is the owner's account - it can't be turned off, renamed to another role or have its permissions changed.", STATUSCODE.BAD_REQUEST))
            }
            if (Array.isArray(access_name) && access_name.length) {
                return res.json(error("This is the owner's account - its permissions can't be changed.", STATUSCODE.BAD_REQUEST))
            }
            if (String(req.userId) !== String(user.id)) {
                return res.json(error("Only the owner can change their own name, mobile number or password.", STATUSCODE.FORBIDDEN))
            }
        }

        let roleData = await Role.findOne({ where: { role_name: role, hotel_id: req.user } })
        if (!roleData) {
            roleData = await Role.create({ role_name: role, hotel_id: req.user })
        }


        const updateFields = { name, role_cd: roleData.role_cd, email, number, active }
        if (ownerAccount) {
            updateFields.role_cd = user.role_cd
            updateFields.active = true
            const newNumber = onlyDigits(number)
            if (newNumber && newNumber !== onlyDigits(user.number)) {
                await Hotel.update({ owner_number: newNumber }, { where: { id: req.user } })
            }
        }
        if (password) {
            updateFields.password = await bcrypt.hash(password, saltRounds)
        }
        if (pin) {
            updateFields.pin = await bcrypt.hash(pin, saltRounds)
        }
        await HotelUser.update(updateFields, { where: { hotel_id: req.user, id } })

        for (const access of access_name) {
            const userAccess = await UserAccess.findOne({ where: { hotelUser_id: id, hotel_id: req.user, access_name: access?.access } })
            if (userAccess) {
                await UserAccess.update({ create: access.permissions.create, read: access.permissions.read, edit: access.permissions.edit, delete: access.permissions.delete, }, { where: { id: userAccess.id, hotel_id: req.user, hotelUser_id: id, } })
            } else {
                await UserAccess.create({ access_name: access?.access, create: access.permissions.create, read: access.permissions.read, edit: access.permissions.edit, delete: access.permissions.delete, hotelUser_id: user?.id, hotel_id: req.user })
            }
        }
        return res.json(success(MESSAGE.SUCCESS, { message: MESSAGE.USER_UPDATED }, STATUSCODE.SUCCESS))
    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const createCaptain = async (req, res) => {

    try {
        // console.log((req.body))
        const hotel = await Hotel.findOne({ where: { id: req.user } })
        // console.log(hotel)
        if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
        const userAvailable = await HotelUser.findOne({ where: { number: req.body.phoneNumber } })
        // console.log(userAvailable, "user available====>")
        if (userAvailable) {
            return res.json(error(MESSAGE.USER_ALREADY_REGISTERED, STATUSCODE.CONFLICT))
        }
        const { start, end } = req.body
        for (let i = start; i <= end; i++) {
            const table = await Table.findOne({ where: { table_name: i, hotel_id: hotel.id } })
            if (!table) {
                // console.log(table, i)
                return res.json(error(`Table Number ${i} is not found between ${start} ${end} range`, STATUSCODE.NOT_FOUND))
            }
            else {
                continue;
            }
        }
        const hashPassword = await bcrypt.hash(req.body.password, saltRounds)
        const captainRole = await Role.findOne({ where: { role_name: USER_ROLE.CAPTAIN } })
        if (!captainRole) {
            const captainRole = await Role.create({ role_name: USER_ROLE.CAPTAIN, enter_by: hotel.hotel_name, hotel_id: hotel.id })

            await HotelUser.create({
                email: req.body.email,
                phoneNumber: req.body.phoneNumber,
                start: req.body.start,
                end: req.body.end,
                password: hashPassword,
                role_cd: captainRole.dataValues.role_cd,
                hotel_id: hotel.id
            })
            return res.json(success("Captain Created", STATUSCODE.CREATED))
        }

        await HotelUser.create({
            email: req.body.email,
            number: req.body.phoneNumber,
            start: req.body.start,
            end: req.body.end,
            password: hashPassword,
            role_cd: captainRole.role_cd,
            hotel_id: hotel.id
        })
        return res.json(success(STATUS.SUCCESS, "Captain Created", STATUSCODE.CREATED))
    } catch (err) {
        // console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

// const createTable = async (req, res) => {
//     try {
//         const userAvailable = await Tab.findOne({ where: { number: Number(req.body.number) } })
// console.log(userAvailable, "user available====>")
//         if (userAvailable) {
//             return res.json(error(MESSAGE.USER_ALREADY_REGISTERED, STATUSCODE.CONFLICT))
//         }
//         const user = await User.create(req.body)
// console.log(user)
//         return res.json(success(MESSAGE.SUCCESS, { message: MESSAGE.CREATE_USER }, STATUSCODE.CREATED))
//     } catch (err) {
// console.log(err.message)
//         return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
//     }
// }



const createRole = async (req, res) => {
    try {

        // const {role_name,}


    } catch (err) {
        // console.log(err.message)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const getRole = async (req, res) => {
    try {
        const id = req.user
        const user = await HotelUser.findOne({ where: { id } })

        // console.log(user)

        if (user) {
            return res.json(success(MESSAGE.SUCCESS, { message: user.role }, STATUSCODE.SUCCESS))
        }

        return res.json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND))


    } catch (err) {
        // console.log(err.message)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const checkHotelLogin = async (req, res) => {
    try {
        const id = req.user
        const hotel = await Hotel.findOne({ where: { id } })

        if (hotel) {
            return res.json(success(MESSAGE.SUCCESS, { message: "Login" }, STATUSCODE.SUCCESS))
        }
        return res.json(error(MESSAGE.RESTAURANT_NOT_FOUND, STATUSCODE.NOT_FOUND))
    } catch (err) {
        // console.log(err.message)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const checkCaptainLogin = async (req, res) => {
    try {
        const id = req.user
        const roleName = await Role.findOne({ role_name: "captain" })
        const user = await HotelUser.findOne({ where: { id, role_cd: roleName.role_cd } })
        if (user) {
            return res.json(success(MESSAGE.SUCCESS, { message: "Login" }, STATUSCODE.SUCCESS))
        }
        return res.json(error(MESSAGE.RESTAURANT_NOT_FOUND, STATUSCODE.NOT_FOUND))
    } catch (err) {
        // console.log(err.message)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
    const userAccess = async (req, res) => {
        try {
            const hotel = await Hotel.findOne({ where: { id: req.user } })
            // console.log(hotel)
            if (!hotel) return res.json(error(MESSAGE.HOTEL_NOT_FOUND, STATUSCODE.BAD_REQUEST))
            const userAccess = await HotelUser.findOne({
                where: { id: req.userId },
                attributes: { exclude: ["password", "pin", "refresh_token"] },
                include: [{ model: UserAccess }, { model: Role }],
            })
            // console.log(userAccess)
            return res.json(success(MESSAGE.SUCCESS, { access: userAccess }, STATUSCODE.SUCCESS))
        } catch (err) {
            return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        }
    }
    const getImage = async (req, res) => {
        try {
            const { name } = req.query

            const file = await fs.readFileSync(path.join(__dirname, "../", "public", "images", "eaf9ae941361d173fdbd613ba600197b69471d50-100x88.png"), "",
                { encoding: 'utf8', flag: 'r' });
            // return res.sendFile(file)
            return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { file }, STATUSCODE.SUCCESS))
        } catch (error) {
            console.log(error, "Error")
            return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
        }
    }
    const getNumberSuggestion = async (req, res) => {
        try {
            const { search, page, limit: limitQuery } = req.query;
            const limit = parseInt(limitQuery) || 10;
            const offset = page ? (page - 1) * limit : 0;

            const nonEmptyCondition = {
                [Op.or]: [
                    { name: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
                    { address: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
                    { gstin: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] } },
                    { number: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }, { [Op.ne]: 0 }] } }
                ]
            };

            const whereCondition = {
                hotel_id: req.user,
                ...nonEmptyCondition
            };

            if (search) {
                whereCondition.number = {
                    [Op.like]: `%${Number(search)}%`
                };
            }

            // Get total count of DISTINCT numbers
            const totalCount = await User.count({
                where: whereCondition,
                distinct: true,
                col: 'number'
            });

            // Get paginated results with GROUP BY
            const numbers = await User.findAll({
                where: whereCondition,
                attributes: [
                    'number',
                    [sequelize.fn('MAX', sequelize.col('name')), 'name'],
                    [sequelize.fn('MAX', sequelize.col('address')), 'address'],
                    [sequelize.fn('MAX', sequelize.col('gstin')), 'gstin'],
                    [sequelize.fn('MAX', sequelize.col('id')), 'id']
                ],
                group: ['number'],
                limit,
                offset,
                raw: true
            });

            return res.status(STATUSCODE.SUCCESS).json(
                success(
                    MESSAGE.SUCCESS,
                    { numbers, total: totalCount },
                    STATUSCODE.SUCCESS
                )
            );

        } catch (err) {
            console.error('Error in getNumberSuggestion:', err);
            return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(
                error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR)
            );
        }
    };
const updateCostumerData = async (req, res) => {
    try {
        const { name, number, gstin, address, id } = req.body
        if (number === "") {
            return res.json(error("Name and Number are required fields", STATUSCODE.BAD_REQUEST))
        }
        await User.update({ name, number, gstin, address }, { where: { id, hotel_id: req.user } })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Customer Data Updated" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const createCustomerData = async (req, res) => {
    try {
        const { name, number, gstin, address } = req.body
        if (number) {
            const user = await User.findOne({ where: { number, hotel_id: req.user } })
            if (user) {
                return res.json(error("Customer Number Already Created", STATUSCODE.BAD_REQUEST))
            }
        }
        await User.create({ name, number, gstin, address, hotel_id: req.user })

        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { message: "Customer Data Created" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err)
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const moment = require('moment');
const ExcelJS = require('exceljs');
const { Sequelize } = require('sequelize');
const Order = require("../model/order")  

const generateHotelActivityExcel = async (req, res) => {
    try {
        // Step 1: Generate date range
        const dates = [];
        for (let i = 0; i < 365; i++) {
            dates.push(moment().subtract(i, 'days').format('YYYY-MM-DD'));
        }
        dates.reverse();

        // Step 2: Get hotel list
        const hotels = await Hotel.findAll({
            attributes: ['id', 'hotel_name'],
            raw: true
        });

        // Step 3: Get orders data
        const orders = await Order.findAll({
            attributes: [
                'hotel_id',
                [Sequelize.fn('DATE', Sequelize.literal(`CONVERT_TZ(createdAt, '+00:00', '+05:30')`)), 'order_date']
            ],
            where: {
                createdAt: {
                    [Op.gte]: moment().subtract(365, 'days').toDate()
                }
            },
            raw: true
        });

        // Step 4: Build order map
        const orderMap = {};
        orders.forEach(order => {
            const key = `${order.hotel_id}_${order.order_date}`;
            orderMap[key] = true;
        });

        // Step 5: Build final pivot data
        const pivotData = hotels.map(hotel => {
            const row = {
                hotel_id: hotel.id,
                hotel_name: hotel.hotel_name
            };

            dates.forEach(date => {
                const key = `${hotel.id}_${date}`;
                row[date] = orderMap[key] ? 'TRUE' : 'FALSE';
            });

            return row;
        });

        // Step 6: Create Excel file using ExcelJS
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Hotel Activity');

        // Add header row
        worksheet.columns = [
            { header: 'Hotel ID', key: 'hotel_id', width: 10 },
            { header: 'Hotel Name', key: 'hotel_name', width: 25 },
            ...dates.map(date => ({ header: date, key: date, width: 12 }))
        ];

        // Add data rows
        pivotData.forEach(data => {
            worksheet.addRow(data);
        });

        // Step 7: Send Excel as response
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=hotel_activity_${Date.now()}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error(err);
        res.status(500).send('Something went wrong');
    }
}
const getUserName = async (req, res) => {
    try {
        const user = await HotelUser.findOne({ where: { id: req.userId } })
        return res.status(STATUSCODE.SUCCESS).json(success(MESSAGE.SUCCESS, { userName: user.name || "" }, STATUSCODE.SUCCESS))

    } catch (err) {
        console.log(err, "Error getting user Name::::")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
function buildSafeUpdate(existing, incoming) {
    const payload = {};

    for (const key of ["name", "number", "address", "gstin"]) {
        if (incoming[key] !== undefined) {
            if (incoming[key] !== "" || existing[key] === "") {
                payload[key] = incoming[key];
            }
        }
    }

    // If any real data exists → no longer placeholder
    if (payload.name || payload.number) {
        payload.isPlaceholder = false;
    }

    return payload;
}
async function findExistingUser(input, orderId = null) {
    const { name, number, address, gstin, hotel_id } = input;

    // Order-based lookup ONLY
    if (orderId) {
        const order = await Order.findOne({
            where: { id: orderId },
            attributes: ["UserId"],
        });

        if (!order) throw new Error("Order not found");
        console.log("Finding user by order:", orderId, "UserId:", order.UserId);
        return await User.findOne({
            where: {
                id: order.UserId,
                hotel_id,
            },
        });
    }

    // Strong identity match
    if (number?.trim()) {
        return await User.findOne({
            where: {
                hotel_id,
                number: number.trim(),
                isPlaceholder: false,
            },
        });
    }

    // Weak match
    const orConditions = [];
    if (name?.trim()) orConditions.push({ name: name.trim() });
    if (gstin?.trim()) orConditions.push({ gstin: gstin.trim() });
    if (address?.trim()) orConditions.push({ address: address.trim() });

    if (orConditions.length) {
        return await User.findOne({
            where: {
                hotel_id,
                isPlaceholder: false,
                [Op.or]: orConditions,
            },
        });
    }

    return null;
}
async function findAndUpdateUser(data, orderId) {
    const { hotel_id } = data;
    console.log("findAndUpdateUser called with data:", data, "and orderId:", orderId);
    return sequelize.transaction(async (t) => {
        const user = await findExistingUser(data, orderId);

        if (!user) throw new Error("User not found");

        // Case 1: Placeholder user → real user upgrade
        if (
            user.isPlaceholder &&
            (data.name?.trim() || data.number?.trim())
        ) {
            const newUser = await User.create(
                {
                    ...data,
                    hotel_id,
                    isPlaceholder: false,
                },
                { transaction: t }
            );

            await Order.update(
                { UserId: newUser.id },
                { where: { id: orderId }, transaction: t }
            );

            return newUser;
        }

        // Case 2: Normal safe update
        const updatePayload = buildSafeUpdate(user, data);

        if (Object.keys(updatePayload).length) {
            await User.update(updatePayload, {
                where: { id: user.id, hotel_id },
                transaction: t,
            });
        }

        return user;
    });
}

module.exports = { findAndUpdateUser, getUserName, generateHotelActivityExcel, createCustomerData, updateCostumerData, getNumberSuggestion, getImage, userAccess, getCaptainUser, updateUser, createCaptain, createUser, getRole, checkHotelLogin, checkCaptainLogin }