const { Cluster } = require('puppeteer-cluster');

// Initialize cluster
let cluster;

const initCluster = async () => {
    try {


        if (cluster) return cluster;

        cluster = await Cluster.launch({
            concurrency: Cluster.CONCURRENCY_PAGE, // one browser page per worker
            maxConcurrency: 5,
            puppeteerOptions: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                executablePath: process.env.CHROME_PATH || undefined //! use custom Chrome path 
            },
            timeout: 120000, // max time per task
            monitor: true, // optional: logs CPU usage per worker
        });

        cluster.on('taskerror', (err, data, willRetry) => {
            console.error(`Error generating PDF for data: ${data?.orderId || data?.order_id}, err`);
            throw new Error(err)
        });

        return cluster;
    } catch (error) {
        throw new Error(error)
    }
};

// Generic PDF generation task
const generatePDFTask = async ({ page, data }) => {

    const htmlContent = data.htmlContent;
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        width: data.width || '270px', // customize printer size
        margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
    });

    await page.close(); // free memory
    return pdfBuffer;
};

// Public function to generate PDF using cluster
const generatePDF = async (data) => {
    try {

        const cluster = await initCluster();
        return await cluster.execute({ data }, generatePDFTask);
    } catch (error) {
        throw new Error(error)
    }
};

// Gracefully close cluster on service shutdown
const shutdownCluster = async () => {
    if (cluster) {
        await cluster.idle();
        await cluster.close();
        cluster = null;
    }
};

module.exports = {
    generatePDF,
    shutdownCluster,
};