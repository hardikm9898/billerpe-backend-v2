
const User = require("../model/user")
const { STATUSCODE, MESSAGE, USER_ROLE } = require("../constant/const")

const jwt = require("jsonwebtoken")
const { error, success } = require("../responce/res")
const Hotel = require("../model/hotel")

const Role = require("../model/role_mst")
const cookie = require("cookie")
const HotelUser = require("../model/hotelUser")
const { createLogFile } = require("../logs/log")
const bcrypt = require("bcrypt")
const Merchant = require("../model/merchant")
const { UserSession } = require("../model")

// A `Secure` cookie is silently dropped by the browser on any non-HTTPS
// origin that isn't localhost itself (Chrome only treats localhost as a
// trusted context over plain HTTP) - restaurantLogin/pinLogin's cookies
// were hardcoded `secure: true`, so login worked over http://localhost but
// silently failed (no cookie ever got set, no visible error) from any LAN
// address like http://192.168.1.12:8080, which this POS is routinely
// accessed at on a restaurant's own network. Standard convention: secure
// only when actually deployed (NODE_ENV=production), so it's still
// enforced for a real HTTPS deployment.
const SECURE_COOKIES = process.env.NODE_ENV === "production"

require("dotenv").config()


const userLogin = async (req, res) => {
    try {
        const { password, phoneNumber: number } = req.body
        // console.log(req.body)
        const user = await User.findOne({ where: { number: parseInt(number) } })
        // console.log(user, "user===>")
        if (!user) {
            return res
                .json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND));
        }
        const valid = await bcrypt.compare(password, user.password)
        if (!valid) {
            return res
                .json(error(MESSAGE.CREDENTIAL_FALSE, STATUSCODE.VALIDATION_ERROR));
        }

        const jwtToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY_USER, {
            expiresIn: "15s",
        });
        const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY_USER, { expiresIn: "7d" })
        res.cookie("token", jwtToken, {
            httpOnly: true, maxAge: 1000 * 60 * 14,
            // expires works the same as the maxAge
            sameSite: 'lax'
        })
        res.cookie("refreshToken", refreshToken, { httpOnly: true, maxAge: 604800000, sameSite: 'lax' })

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success("success", { message: MESSAGE.USER_LOGIN }, res.statusCode));

    } catch (err) {
        // createLogFile(req.user, ` userLogin/err Error`, err);
        // console.log(err.message)
        // console.log(err.message, "=====>error")
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const captainLogin = async (req, res) => {
    try {
        const { password, phoneNumber } = req.body
        // console.log(req.body)
        const role = await Role.findOne({ where: { role_name: USER_ROLE.CAPTAIN } })
        const user = await User.findOne({ where: { number: phoneNumber, role_cd: role.role_cd } })
        // console.log(user, "user===>")
        if (!user) {
            return res
                .json(error(MESSAGE.USER_NOT_FOUND, STATUSCODE.NOT_FOUND));
        }
        const valid = await bcrypt.compare(password, user.password)
        if (!valid) {
            return res
                .json(error(MESSAGE.CREDENTIAL_FALSE, STATUSCODE.VALIDATION_ERROR));
        }
        const jwtToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY_CAPTAIN, {
            expiresIn: "15s",
        });
        const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY_CAPTAIN, { expiresIn: "7d" })
        res.cookie("token", jwtToken, {
            httpOnly: true, maxAge: 1000 * 60 * 14,
            // expires works the same as the maxAge
            sameSite: 'lax'
        })
        res.cookie("refreshToken", refreshToken, { httpOnly: true, maxAge: 604800000, sameSite: 'lax' })

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success("success", { message: MESSAGE.USER_LOGIN }, res.statusCode));

    } catch (err) {
        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }

}

const restaurantLogin = async (req, res) => {
    try {
        const { password, mobile, device_id } = req.body

        const hotelUser = await HotelUser.findOne({ where: { number: mobile, active: true } })
        if (!hotelUser) return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));

        const validPassword = await bcrypt.compare(password, hotelUser.password)
        if (!validPassword) {
            return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));
        }

        const accessToken = jwt.sign({ id: hotelUser.id }, process.env.JWT_SECRET_KEY_ADMIN, { expiresIn: "24h" });
        const refreshToken = jwt.sign({ id: hotelUser.id }, process.env.JWT_SECRET_KEY_ADMIN, { expiresIn: "7d" });

        // store refresh token in database
        await HotelUser.update({ refresh_token: refreshToken }, { where: { id: hotelUser.id } })
        // Remove old session for same device (if user logs in again from same browser)
        await UserSession.destroy({ where: { user_id: hotelUser.id, device_id } });

        // Create new session
        await UserSession.create({ user_id: hotelUser.id, device_id, token: accessToken });

        // Fetch all sessions for this user
        const sessions = await UserSession.findAll({
            where: { user_id: hotelUser.id },
            order: [["created_at", "ASC"]] // oldest first
        });

        // If more than 3 sessions, remove oldest ones
        if (sessions.length > 3) {
            const excess = sessions.slice(0, sessions.length - 3);
            for (const s of excess) {
                await UserSession.destroy({ where: { id: s.id } });
            }
        }
        res.cookie("token", accessToken, {
            httpOnly: true,
            secure: SECURE_COOKIES,
            sameSite: "strict",
            maxAge: 24 * 60 * 60 * 1000
        });

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: SECURE_COOKIES,
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json(success("success", { message: "Login Successful", token: accessToken }, STATUSCODE.SUCCESS));

    } catch (err) {
        console.log(err, "err::")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}


const pinLogin = async (req, res) => {
    try {
        const { pin, mobile, device_id } = req.body

        const hotelUser = await HotelUser.findOne({ where: { number: mobile, active: true } })
        if (!hotelUser) return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));
        if (!hotelUser.pin) return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));

        const validPin = await bcrypt.compare(pin, hotelUser.pin)
        if (!validPin) {
            return res.json(error(MESSAGE.NOT_AUTHORIZE, STATUSCODE.UNAUTHORIZED));
        }

        const accessToken = jwt.sign({ id: hotelUser.id }, process.env.JWT_SECRET_KEY_ADMIN, { expiresIn: "24h" });
        const refreshToken = jwt.sign({ id: hotelUser.id }, process.env.JWT_SECRET_KEY_ADMIN, { expiresIn: "7d" });

        await HotelUser.update({ refresh_token: refreshToken }, { where: { id: hotelUser.id } })
        await UserSession.destroy({ where: { user_id: hotelUser.id, device_id } });
        await UserSession.create({ user_id: hotelUser.id, device_id, token: accessToken });

        const sessions = await UserSession.findAll({
            where: { user_id: hotelUser.id },
            order: [["created_at", "ASC"]]
        });
        if (sessions.length > 3) {
            const excess = sessions.slice(0, sessions.length - 3);
            for (const s of excess) {
                await UserSession.destroy({ where: { id: s.id } });
            }
        }

        res.cookie("token", accessToken, {
            httpOnly: true,
            secure: SECURE_COOKIES,
            sameSite: "strict",
            maxAge: 24 * 60 * 60 * 1000
        });
        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: SECURE_COOKIES,
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json(success("success", { message: "Login Successful", token: accessToken }, STATUSCODE.SUCCESS));
    } catch (err) {
        console.log(err, "err::")
        return res.json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const restaurantLogout = async (req, res) => {
    try {

        const { token } = req.cookies;
        if (token) {
            await UserSession.destroy({ where: { token } });
        }
        res.setHeader('Set-Cookie', cookie.serialize('token', '', {
            expires: new Date(0),
            path: '/',
        }));
        res.setHeader('Set-Cookie', cookie.serialize('refreshToken', '', {
            expires: new Date(0),
            path: '/',
        }));

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success("success", { message: "LogOut Successfully" }, STATUSCODE.SUCCESS));

    } catch (err) {
        // createLogFile(req.user, ` restaurantLogout/err Error`, err);
        // console.log(err.message)
        // console.log(err.message, "=====>error")

        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}

const pdf = async (req, res) => {
    console.log("pdf=========================================================>")

    const pdfDir = path.join(__dirname, "public", "pdf");
    const { filename } = req.params;
    const filePath = path.join(pdfDir, `${filename}`);

    // Check if the file exists
    if (fs.existsSync(filePath)) {
        // If the file exists, send it
        res.sendFile(filePath);
    } else {
        // If the file does not exist, return a 404 Not Found error
        res.status(404).send("PDF not found");
    }

}
const merchantLogin = async (req, res) => {
    try {
        const { password, number } = req.body
        if (!password || !number) {
            return res
                .json(error("Password And Number Required", STATUSCODE.BAD_REQUEST));
        }
        const user = await Merchant.findOne({ where: { number: parseInt(number) } })
        if (!user) {
            return res
                .json(error("Merchant Not Fount", STATUSCODE.NOT_FOUND));
        }
        const validPassword = await bcrypt.compare(password, user.password)
        if (!validPassword) {
            return res
                .json(error(MESSAGE.CREDENTIAL_FALSE, STATUSCODE.VALIDATION_ERROR));
        }

        const jwtToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY_MARCHANT, {
            expiresIn: "15s",
        });
        const refreshToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET_KEY_MARCHANT, { expiresIn: "7d" })
        res.cookie("merchantToken", jwtToken, {
            httpOnly: true, maxAge: 1000 * 60 * 14,
            sameSite: 'lax'
        })
        res.cookie("merchantRefreshToken", refreshToken, { httpOnly: true, maxAge: 604800000, sameSite: 'lax' })

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success("success", { message: MESSAGE.USER_LOGIN }, res.statusCode));

    } catch (err) {
        // createLogFile(req.user, ` userLogin/err Error`, err);

        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
const merchantLogout = async (req, res) => {
    try {



        res.setHeader('Set-Cookie', cookie.serialize('token', '', {
            expires: new Date(0),
            path: '/',
        }));
        res.setHeader('Set-Cookie', cookie.serialize('refreshToken', '', {
            expires: new Date(0),
            path: '/',
        }));

        return res
            .status(STATUSCODE.SUCCESS)
            .json(success("success", { message: "LogOut Successfully" }, res.statusCode));

    } catch (err) {
        // createLogFile(req.user, ` restaurantLogout/err Error`, err);
        // console.log(err.message)
        // console.log(err.message, "=====>error")

        return res.status(STATUSCODE.INTERNAL_SERVER_ERROR).json(error(MESSAGE.INTERNAL_SERVER_ERROR, STATUSCODE.INTERNAL_SERVER_ERROR))
    }
}
module.exports = { merchantLogout, merchantLogin, userLogin, pdf, restaurantLogin, captainLogin, restaurantLogout, pinLogin }