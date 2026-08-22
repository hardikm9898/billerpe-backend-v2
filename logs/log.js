const fs = require('fs');
const path = require('path');
const moment = require("moment")

const createLogFile = (hotelName, message, data = '') => {
    // Get current date
    const currentDate = moment();
    const dateString = currentDate.format('DD-MM-YY');
    // const dateString = currentDate.toISOString().slice(0, 10); // Format: YYYY-MM-DD

    // Create directory for hotel logs if it doesn't exist
    const hotelLogDir = path.join(__dirname, 'logs', `${hotelName}`);
    if (!fs.existsSync(hotelLogDir)) {
        fs.mkdirSync(hotelLogDir, { recursive: true });
    }

    // Construct log file path
    const logFilePath = path.join(hotelLogDir, `${dateString}.log`);

    // Format log message
    const timeStamp = currentDate.format('DD/MM/YY hh:mm:ss A');
    const logMessage = `[${timeStamp}] ${message}`;

    // Create log entry with message and optional data
    const logEntry = data ? `${logMessage}Data: ${data}}\n` : logMessage;

    // Write log entry to file
    fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) {
            console.error('Error writing to log file:', err);
        } else {
            console.log(`Log entry added to ${logFilePath}`);
        }
    });
}


module.exports = { createLogFile }