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
const error = (message, statusCode) => {
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
        results: { message },
        code: sCode,
        error: true,
    };
};

module.exports = { success, error, mobileSuccess, mobileError };