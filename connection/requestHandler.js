
const Orders = require("../model/order");

const requestHandler = (client, io) => {
    try {
        client.on("printMobileBill", async (hotelId) => {
            const hotel_id = hotelId.hotelId
            console.log(hotel_id, "hotel_id from hotel=######===============&&&&&&&&&&&&&&&&&&&=======================================================================>")
            client.join(hotel_id)
        })

        client.on("orders", async (hotelId) => {


            const hotel_id = hotelId.hotelId
            console.log(hotelId, "================================================================================================================================================")
            const lastOrder = await Orders.findAll({ where: { hotel_id }, order: [["id", "DESC"]] })
            // console.log("io++++++++++++++++++++", io)
            io.to(hotel_id).emit("notification", { lastOrder: [lastOrder[0]] });

        })


    } catch (error) {
        console.log(error, "from error block==================>")
    }
}

const printBillMobile = (data, client, io) => {
    return io.to(data.hotel_id).emit("printBill", data)
}

module.exports = requestHandler



