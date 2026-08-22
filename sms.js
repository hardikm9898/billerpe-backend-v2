const axios = require('axios')
axios.get('https://backend.billerpe.com/sms').then(res => {
    console.log(res)
}).catch(err => {
    console.log(err)
})