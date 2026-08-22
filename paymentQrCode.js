const qrcode = require('qrcode');
const { createLogFile } = require('./logs/log');
const puppeteer = require("puppeteer")
const fs = require('fs')
const generateInvoicePDF = async (data, outputPath) => {
    try {
        let browser = await puppeteer.launch();     // !local


        // Generate UPI QR Code
        const upiId = "7434993463@ybl"; // Replace with your UPI ID
        const merchantName = encodeURIComponent("hardik Makwana"); // Using first line of header as merchant name
        const transactionNote = encodeURIComponent(`Bill Payment - ${12}`);
        const amount = 480;

        // Construct UPI URL
        const upiUrl = `upi://pay?pa=${upiId}&pn=${merchantName}&tn=${transactionNote}&am=${amount}&cu=INR`;

        // Generate QR code as base64
        const qrCodeImage = await qrcode.toDataURL(upiUrl, {
            width: 150,
            margin: 2
        });

        const page = await browser.newPage();

        // Modify HTML content to include QR code
        const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;600&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans&display=swap" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@100..900&family=Tiro+Devanagari+Hindi:ital@0;1&display=swap" rel="stylesheet">
        <style>
            /* ... (previous styles remain the same) ... */

            .qr-code-section {
                text-align: center;
                margin-top: 10px;
                padding: 10px 0;
                border-top: 1px solid #000;
            }

            .qr-code-section img {
                width: 150px;
                height: 150px;
            }

            .qr-code-section p {
                margin: 5px 0;
                font-size: 12px;
                font-weight: 500;
            }
        </style>
        </head>
        <body>
            <div class="invoice">
                <!-- ... (previous invoice content remains the same until footer) ... -->

                <div class="qr-code-section">
                    <p>Scan to pay via UPI</p>
                    <img src="${qrCodeImage}" alt="Payment QR Code"/>
                    <p>Amount: ₹${480}</p>
                    <p>Merchant: ${decodeURIComponent(merchantName)}</p>
                </div>

            
            </div>
        </body>
        </html>
        `;

        // Set content to page
        await page.setContent(htmlContent);
        const pdf = await page.pdf();
        await browser.close();
        fs.writeFile('test.pdf', pdf, err => {
            if (err) {
                console.error(err);
            } else {
                // file written successfully
            }
        })
    } catch (error) {
        // createLogFile(1, `generateInvoicePDF /err Error`, error);
        console.log(error, "Error from puppeteer======================>")
        return error;
    }
}

generateInvoicePDF()