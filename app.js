const express = require('express');
const bodyParser = require('body-parser');
const { generatePDF } = require('./pdfservice');

const app = express();
app.use(bodyParser.json());

app.post('/api/generate-pdf', async (req, res) => {
    try {
        const data = req.body;
        const pdfBuffer = await generatePDF(data);
        // console.log(pdfBuffer, "MicroService Buffere::::")
        return res.status(200).json({ pdfBuffer, message: "Success" })
    } catch (err) {

        console.error('PDF generation error:', err);
        res.status(500).json({ error: 'PDF generation failed' });
    }
});

app.listen(3002, () => console.log('PDF microservice running on port 3002')); 
