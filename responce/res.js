const { STATUS } = require("../constant/const");

const success = (status, results, statusCode) => ({ status, error: false, code: statusCode, results })

const mobileSuccess = (status, results, message, statusCode) => ({ status, error: false, code: statusCode, message, results })
const mobileError = (message, statusCode) => {
    let sCode = statusCode;

    // console.log(statusCode)
    // List of common HTTP request code
    const codes = [200, 201, 400, 401, 404, 403, 422, 500];

    // Get matched code
    const findCode = codes.find((code) => code === sCode);


    // console.log(findCode)

    if (!findCode) {
        sCode = 500;
    } else {
        sCode = findCode;
    }

    return {
        status: STATUS.FAIL,
        message,
        results: {},
        code: sCode,
        error: true,
    };
}
// `extra` (optional) is merged into `results` alongside the message, for
// the handful of errors a client must act on differently rather than just
// display - e.g. the device-registration conflict's canReplace/existing
// (controller/localServerRegistration.js), which the POS turns into a
// "replace the other PC?" confirmation. Matches billerpe-local-exe's own
// responce/res.js, which already had this third parameter.
const error = (message, statusCode, extra) => {
    let sCode = statusCode;

    // console.log(statusCode)
    // List of common HTTP request code
    const codes = [200, 201, 400, 401, 404, 403, 422, 500, 409];

    // Get matched code
    const findCode = codes.find((code) => code === sCode);


    // console.log(findCode)

    if (!findCode) {
        sCode = 500;
    } else {
        sCode = findCode;
    }

    return {
        status: STATUS.FAIL,
        results: { message, ...(extra || {}) },
        code: sCode,
        error: true,
    };
};

module.exports = { success, error, mobileSuccess, mobileError };