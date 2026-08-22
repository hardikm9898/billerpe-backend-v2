import React, { useEffect, useState, useRef, } from 'react';
import { useNavigate, useLocation } from "react-router-dom";
import KeyBoardDisplay from './KeyBoardDisplay'
import TouchDisplay from './TouchDisplay'
import axios from 'axios'
import config from '../../../../config'
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { Buffer } from 'buffer';
import moment from 'moment';
import redBin from "../../../../assets/images/logos/red_bin.svg";
import { JSPrintManager, ClientPrintJob, InstalledPrinter, PrintFilePDF, FileSourceType, WSStatus } from 'jsprintmanager-latest';
import Loading from '../../../../Loading'
import { clearIndexedDBStore, getActiveTableCatagoriesWise, getAllFromDB, getFromDB, setToDB, updateInDB } from '../../Offline/Idb';
import { dateWiseClearData, editOrderFromIdb, holdOrderOperations, KotOrderOperations, kotRePrint, orderPlaceOperations, removeKotAlready, settleBill, updatedTableDataOrderDataAndOrderDetails } from '../../Services.js/Biller';
import { checkInternetConnection } from '../../Offline/CheckConnectionStatus';
import PrintingLoader from "../../../../layouts/loader/PrinterLoader";
import zomoto from '../../../../assets/images/logos/zomato-1.svg'
import bike from '../../../../assets/images/logos/delivery-bike.png'
import { TbNotes } from "react-icons/tb";
import Tooltip from '@mui/material/Tooltip';
import PreparationTime from './PreparationTime';
import { log } from 'console';


function Biller({ onlineOrderDetails, setOnlineOrderDetails, setNewOrderClick, hotelId, setHeaderChange, updatedData, setUpdateData, newOrderClick }) {
    const [display, setDisplay] = useState('T')

    // ! Socket Connection Don't Touch It
    log(config.SOCKET_URL, hotelId, "socket Url================>")


    const [fetching, setFetching] = useState(true)
    const [allOrders, setAllOrders] = useState([])
    const [pickupOrder, setPickupOrder] = useState([])
    const [dinInOrder, setDinInOrder] = useState([])
    const [deliveryOrder, setDeliveryOrder] = useState([])

    const [product, setProduct] = useState([])
    const [helo, setHello] = useState([])
    const [hotel, setHotel] = useState({})
    const [showTable, setShowTable] = useState([])
    const [tableOnceClick, setTableOnceClick] = useState(false)
    const [showProduct, setShowProduct] = useState([])
    const [moveKotDetails, setMoveKotDetails] = useState({
        tableId1: 0,// to ,
        tableId2: 0,//from,
        kotNumber: 0
    })
    const defaultPriceEdit = { id: 0, price: 0, name: "", open: false }
    const [openPriceEditPopUp, setOpenPriceEditPopUp] = useState(defaultPriceEdit)
    const [newPrice, setNewPrice] = useState(0)
    // kot move
    const [moveKotConfirmPopUp, setMoveKotConfirmPopUp] = useState(false)
    const [showTablesOnMove, setShowTableOnMove] = useState([])
    const [moveKotPopUp, setMoveKotPopup] = useState(false)
    const [onlineOrders, setOnlineOrders] = useState([])
    const [openOnlineOrderPopup, setOpenOnlineOrderPopup] = useState({ status: false, id: 0 })
    //table move

    const [moveTableDetails, setMoveTableDetails] = useState({
        tableId1: 0,
        tableId2: 0,
    })
    const [moveTableConfirmPopUp, setMoveTableConfirmPopUp] = useState(false)
    const [showTablesOnMoveTable, setShowTableOnMoveTable] = useState([])
    const [moveTablePopUp, setMoveTablePopup] = useState(false)

    const [tableSelect, setTableSelect] = useState(false)
    const [tables, setTables] = useState([])
    const [tableCategory, setTableCatagories] = useState([])

    const [editOrder, setEditOrder] = useState(false)
    const [addItem, setAddItem] = useState(false)

    const defaultCart = {
        totalItems: 0,
        totalQty: 0,
        items: [],
        totalBill: 0,
        myAmount: 0,
        grandAmount: 0,
        totalDiscount: 0,
        totalExcGstAmount: 0,
        gst: 0
    }
    const [cart, setCart] = useState(defaultCart)

    const navigate = new useNavigate()

    const defaultform = {
        cash: 0, card: 0, upi: 0, due: 0,
        paymentMode: "",
        tableNumber: "",
        userName: "",
        mobile: "",
        gstin: '',
    }
    const [catagories, setCatagories] = useState([])
    const [orderType, setOrderType] = useState("")
    const [formValue, setFormValue] = useState(defaultform)
    const [dueAmount, setDueAmount] = useState(0)
    const [orderId, setOrderId] = useState(0)
    // popup useState


    const defaultSettlePopupData = { id: 0, cash: 0, upi: 0, card: 0, due: 0, totalAmount: 0, time: new Date(), mobile: 0 }
    const [paymentModeSelect, setPaymentModeSelect] = useState([])
    const [settlePopupData, setSettlePopupData] = useState(defaultSettlePopupData)
    const [splitActive, setActiveSplit] = useState(false)
    const [customerPaid, setCustomerPaid] = useState(0)
    const [activeBox, setActiveBox] = useState("");
    const [activeOrderType, setActiveOrdertype] = useState("")
    const [activeSideBarOrderType, setActiveSideBArOrderType] = useState('dinin')
    const [showSideBarOrder, setShowSideBarOrder] = useState([])
    const [emptyValue, setEmptyValue] = useState({})
    const [activeCategories, setActiveCategories] = useState("all")
    const [activeOrderDetailsIcon, setActiveOrderDetailsIcon] = useState("")
    const [loading, setLoading] = useState(false)
    const [printLoader, setPrintLoader] = useState(false)
    const [showTableCatagoriesWise, setShowTableCatagoriesWise] = useState([])
    const [tableCatagoriesWise, setTableCatagoriesWise] = useState([])
    const [headerContent, setHeaderContent] = useState(0)
    const [settleBillPopup, setSettleBillPopup] = useState(false)
    const [functionCalled, setFunctionCalled] = useState(false)
    const [removeKotPopUp, setRemoveKotPopUp] = useState(false)
    const [notPermissionPopUp, setNotPermissionPopUp] = useState(false)
    const [menuIdAndOrderIdforRemoveKot, setMenuIdAndOrderIdforRemoveKot] = useState({ MenuId: 0, OrderId: 0, kotNumber: 0 })
    const [notAuthorized, setNotAuthorized] = useState(false)
    const [access, setAccess] = useState([])
    // table Booking 
    const [openTableBookingTimeEndPopUp, setOpenTableBookingTimeEndPopUp] = useState(false)
    const [tableBookingStarPopUp, setTableBookingStarPopUp] = useState(false)
    const [kotwiseDropDown, setKotwiseDropDown] = useState(0)
    const defaultDiscountform = {
        discount: "fix", amount: 0
    }


    const [discountPopup, setDiscountPopup] = useState(false)
    const [discountform, setDiscountform] = useState(defaultDiscountform)
    const getPickUpOrders = async () => {
        // axios.get(`${config.API_URL}/pickupOrder`, { withCredentials: true }).then(res => {

        const res = await getAllFromDB('hms_order_mst')

        if (res) {

            setAllOrders(() => {
                return [...res]
            })


            const pickUpOrders = res.filter((el) => {
                if (el.order_type === "pickup" && el.payment === "pending" && el.deleted === false) {
                    return el
                }
            })

            const dinInOrder = res.filter((el) => {
                if (el.order_type === "dinin" && el.status !== "success" && el.deleted === false) {
                    return el
                }
            })


            setDinInOrder(() => {
                return [...dinInOrder]
            })
            setPickupOrder(() => {
                return [...pickUpOrders]
            })

            setShowSideBarOrder(() => {
                return [...dinInOrder]
            })


        } else {

        }

    }
    const getUserAccessData = async () => {
        const access = await getAllFromDB('hms_userAccess_mst')
        return access[0]
    }

    const changeHeaderContent = () => {
        setHeaderContent(pre => pre + 1)
    }
    // let functionCalled = false


    const getAllTable = async () => {
        const tableData = await getAllFromDB('hms_table_mst')
        setTables(() => {
            return [...tableData]
        })
        setShowTable(() => {
            return [...tableData]
        })

    }
    const handleBoxClick = (targetId) => {
        setActiveOrderDetailsIcon(targetId)
        if (targetId === activeBox) {
            setActiveBox("")
        } else {
            setActiveOrderDetailsIcon(targetId)
            setActiveBox(targetId);
        }
    };


    const getTableCatagoriesWiseOrder = async () => {
        const tableDat = await getActiveTableCatagoriesWise()
        setTableCatagoriesWise(() => {
            return [...tableDat]
        })

        setShowTableCatagoriesWise(() => {
            return [...tableDat]
        })
        setLoading(false)
    }
    const getTables = async () => {
        await getPickUpOrders()
        setActiveCategories("all")
        setLoading(true)
        await getAllTable()
        // axios.get(`${config.API_URL}/table`, { withCredentials: true }).then((res) => {
        //     if (res.data.code === 200) {
        //         if (res.data.results) {
        //             setTables(() => {
        //                 return [...res.data.results.tables]
        //             })
        //             setShowTable(() => {
        //                 return [...res.data.results.tables]
        //             })
        //         }
        //     } else {
        //         setLoading(false)
        //         // //console.log(res.data.results)
        //     }
        // }).catch(err => {
        //     // //console.log(err)
        // })

        await getTableCatagoriesWiseOrder()

        // axios.get(`${config.API_URL}/getTableCatagoriesWise`, { withCredentials: true }).then((res) => {
        //     console.log(res.data.results, " get TablesCatagoriesWise======> v1 ")
        //     if (res.data.code === 200) {
        //         if (res.data.results) {
        //             setTableCatagoriesWise(() => {
        //                 return [...res.data.results.tables]
        //             })

        //             setShowTableCatagoriesWise(() => {
        //                 return [...res.data.results.tables]
        //             })
        //             setLoading(false)
        //         }
        //     } else {
        //         setLoading(false)
        //         // //console.log(res.data.results)
        //     }
        // }).catch(err => {
        //     // //console.log(err)
        // })
    }

    const handlePaymentModeChange = (e, amount) => {
        if (e.target.name === "mobile") {
            setSettlePopupData((pre) => {
                return { ...pre, mobile: e.target.value }
            })
            return
        }
        setSettlePopupData((pre) => {
            return { ...pre, cash: 0, upi: 0, card: 0, due: 0 }
        })

        setSettlePopupData((pre) => {
            return { ...pre, [e.target.value]: amount }
        })
    }
    const closeSettlePopup = () => {
        const element = document.getElementById("settlePopup")
        //console.log(element)
        element.classList.add("hide")
        setTimeout(() => {
            setSettleBillPopup(false)
        }, 200)
        document.getElementById('overlay').style.display = 'none';
    }
    const openSettlePopup = (data) => {
        setSettlePopupData(data)
        setSettleBillPopup(true)
        // document.getElementById()
        document.getElementById('overlay').style.display = 'block';
    }
    const settleBills = async () => {
        setPrintLoader(true)
        const enterAmount = +settlePopupData.upi + +settlePopupData.cash + +settlePopupData.card + +settlePopupData.due
        if (settlePopupData.upi < 0 || settlePopupData.cash < 0 || settlePopupData.card < 0 || settlePopupData.due < 0) {
            setPrintLoader(false)
            toast.error("Enter Valid Amount")
            return
        }
        if (enterAmount !== settlePopupData.amount) {
            if (splitActive) {
                setPrintLoader(false)
                toast.error("Please Enter Amount As Same As Payable Amount")
                return
            }
            else {
                setPrintLoader(false)
                toast.error("Please Select PaymentMode")
                return
            }
        } else {
            // axios.post(`${config.API_URL}/settleBills`, settlePopupData, { withCredentials: true }).then((res) => {
            const connection = await checkInternetConnection()
            if (connection) {
                axios.post(`${config.API_URL}/settleBills`, settlePopupData, { withCredentials: true }).then(async (res) => {
                    if (res.data.code === 200) {
                        setPrintLoader(false)
                        setActiveSplit(false)
                        setHeaderChange(true)
                        toast.success("Bill Settle")
                        setPaymentModeSelect((pre) => {
                            return []
                        })
                        closeSettlePopup()
                        changeHeaderContent()
                        const resw = await updatedTableDataOrderDataAndOrderDetails("F", settlePopupData.id)
                        if (resw.status === 200) {

                        } else {
                            toast.error(resw.message)
                        }
                        setTableSelect(false)
                        await getTables()
                        setOrderId(0)
                    } else {
                        setPrintLoader(false)
                        toast.error(res.data.results.message, "something wrong in settle bill")
                    }
                }).catch(err => {
                    toast.error(err.message)
                    setPrintLoader(false)
                })




            } else {
                settleBill(settlePopupData).then(res => {
                    if (res.status === 200) {
                        setActiveSplit(false)
                        setHeaderChange(true)
                        toast.success(res.message)
                        setPaymentModeSelect((pre) => {
                            return []
                        })
                        closeSettlePopup()
                        changeHeaderContent()
                        setTableSelect(false)
                        getTables()
                        setOrderId(0)

                    } else {
                        toast.error(res.message)
                    }
                }).catch(err => {
                    toast.error(err.message)
                })
            }
        }
    }
    const getAdminCart = (totalDiscount) => {
        setCart(defaultCart)
    }

    const formatInvoiceData = (data) => {
        let commands = '';

        // Center alignment
        commands += '\x1B\x61\x01'; // Center alignment
        data.headerText.forEach(el => {
            if (el) {
                if (el.title === 'hotel_name') {
                    if (el.value) {

                        commands += '\x1B\x45\x01'; // Bold on
                        commands += '\x1D\x21\x10';
                        commands += '\x1B\x4D\x02';
                        commands += `${el.value} \n`;
                        commands += '\x1D\x21\x00';
                        commands += '\x1B\x45\x00';
                    } else {

                    }
                } else {
                    if (el.value) {
                        commands += `${el.value}\n`
                    } else {

                    }
                }
            } else {
            }
        })
        commands += '\x1B\x61\x00';

        commands += '------------------------------------------------\n';
        // Customer Information

        if (data.tableAndUserInfo) {
            commands += '\x1B\x45\x01';
            commands += `${data.tableAndUserInfo}\n`;
            commands += '\x1B\x45\x01';
        }
        if (data.customerNumber) {
            commands += ` Number: ${data.customerNumber}\n`;
        }
        if (data.customerName) {
            commands += ` Name: ${data.customerName}\n`;
        }
        if (data.gstin) {
            commands += `GST NO.: ${data.gstin}\n`;
        }
        commands += '------------------------------------------------\n';

        // Date and Bill Number
        commands += '\x1B\x45\x01'; // Bold on
        commands += '\x1D\x21\x08';

        commands += `Bill No: ${data.orderId}\n`;
        commands += '\x1D\x21\x00';

        commands += '\x1B\x45\x00'; // Bold off
        commands += `Date: ${data.dateAndTime}           ${data.type}\n`;
        commands += '------------------------------------------------\n';

        // Table Header
        commands += 'Item                       Qty  Price   Amt\n';
        commands += '------------------------------------------------\n';

        // Items
        data.items.forEach(item => {
            let itemName = item.item_name;
            while (itemName.length > 24) {
                commands += `${itemName.slice(0, 24)}\n`;
                itemName = itemName.slice(24);
            }

            commands += `${itemName.padEnd(24, ' ')} ${item.qty.toString().padStart(3, ' ')}   ${(+item.price).toFixed(2).padStart(6, ' ')}   ${item.totalAmount.toFixed(2).padStart(6, ' ')}\n\n`;
        });

        commands += '------------------------------------------------\n';

        // Totals and Taxes
        commands += '\x1B\x61\x02';
        commands += `Total Qty: ${data.totalQty} Sub Total: ${+data.subtotal.toFixed(2) + data.totalDiscount}\n`;
        if (+data.gst) {

            commands += `                            CGST @2.5%: + ${(+data.gst / 2).toFixed(2)}\n`;
            commands += `                            SGST @2.5%: + ${(+data.gst / 2).toFixed(2)}\n`;
        }
        if (data.totalDiscount) {
            commands += `                           Discount: - ${(+data.totalDiscount).toFixed(2)}\n`;
        }
        commands += '------------------------------------------------\n';

        commands += '\x1B\x45\x01'; // Bold on
        commands += '\x1D\x21\x10';
        commands += '\x1B\x61\x01'; // Center alignment
        commands += `Grand Total: RS. ${Math.round(data.totalBill)}\n`;
        commands += '\x1B\x45\x00'; // Bold off
        commands += '\x1D\x21\x00';
        commands += '------------------------------------------------\n';


        // Footer

        data?.footerText?.forEach(el => {
            if (el) {
                if (el.title === 'hotel_name') {
                    if (el.value) {

                        commands += '\x1B\x45\x01'; // Bold on
                        commands += '\x1D\x21\x10';
                        commands += '\x1B\x4D\x02';
                        commands += `${el.value} \n`;
                        commands += '\x1D\x21\x00';
                        commands += '\x1B\x45\x00';
                    } else {

                    }
                } else {
                    if (el.value) {
                        commands += `${el.value}\n`
                    } else {

                    }
                }
            } else {

            }
        })
        commands += '\n\n'
        commands += '\n\n'
        commands += '\x1D\x56\x00'

        return commands;
    };
    const formateKotData = async (data) => {
        try {

            let printerCommands = ''

            let commands = '';
            commands += printerCommands;
            commands += '\x1c\x7D\x60\x01';
            commands += '\x1B\x61\x01';
            commands += '\x1D\x21\x14';
            commands += `${data.userOrTableNo}\n`
            commands += '\x1D\x21\x00';
            commands += `KOT No. ${data.order_id}\n`
            commands += `${data.order_type}\n`
            commands += '\x1B\x61\x00';
            commands += '------------------------------------------------\n';
            commands += 'Item               Qty      Special Note\n';
            commands += '------------------------------------------------\n';
            data.items.forEach(item => {
                let itemName = item.item_name;
                while (itemName.length > 20) {
                    commands += `${itemName.slice(0, 20)}\n`;
                    itemName = itemName.slice(24);
                }
                commands += `${itemName.toString().padEnd(20, ' ')} ${item.qty.toString().padStart(3, ' ')}   ${item?.comment ? item.comment.toString().padStart(6, ' ') : ''} \n\n`;
            });
            commands += '\n\n'
            commands += '\n\n'
            commands += '\x1D\x56\x00'
            return commands
        } catch (error) {
            console.log(error)
        }
    }
    const orderPlace = async ({ cart, due = 0, cash = 0, card = 0, upi = 0, order_type, userName, gstin, mobile, tableNumber, order_id }) => {
        // setLoading(true)
        setActiveSideBArOrderType('dinin')
        setPrintLoader(true)
        const check = validation(order_type)
        if (check) {

            let bodyObject = {}
            if (order_type === "pickup") {
                if (upi < 0 || cash < 0 || card < 0 || due < 0) {
                    toast.error("Enter Valid Amount")
                    setPrintLoader(false)
                    return
                }
                const enterAmount = +upi + +cash + +card + +due

                console.log(upi, card, +card, +due)
                if (enterAmount !== +cart.grandAmount) {

                    console.log(splitActive, "split Active")
                    if (splitActive) {
                        toast.error("Please Enter Amount As Same As grandAmount")
                        setPrintLoader(false)
                        return
                    }
                    toast.error("Please Select PaymentMode")
                    setPrintLoader(false)
                    return
                }

                if (due > 0 && !mobile) {
                    toast.error("Mobile Number Require On Due Payment")
                    setPrintLoader(false)
                    return
                }
                bodyObject = { cart, order_type, userName, gstin, mobile, order_id, cash, card, upi, due }
            } else {
                bodyObject = { cart, order_type, tableNumber, mobile, userName, gstin, cash, card, upi, due, order_id }
            }
            const connection = await checkInternetConnection()
            if (connection) {
                await axios.post(`${config.API_URL}/adminOrder`, bodyObject, { withCredentials: true }).then(async (res) => {
                    if (res.data.code === 201) {
                        setDueAmount(0)
                        const updatedTableDataOrderDataAndOrderDetailsId = res.data.results.orderId
                        toast.success(res.data.results.message)
                        await axios.post(`${config.API_URL}/adminBillData`, { orderId: res.data.results.orderId }, { withCredentials: true }).then(async (res) => {
                            // ! order Place
                            if (res.data.code === 200) {
                                const { data, multiLanguage, logoAvailable } = res.data.results
                                if (!multiLanguage && !logoAvailable) {

                                    setOrderId(0)
                                    setFormValue(defaultform)
                                    setTableSelect(false)
                                    setCart(defaultCart)
                                    setFunctionCalled(false)
                                    const resw = await updatedTableDataOrderDataAndOrderDetails("P", updatedTableDataOrderDataAndOrderDetailsId)
                                    if (resw.status === 200) {

                                    } else {
                                        toast.error(resw.message)
                                    }
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    setHeaderChange(true)
                                    getTables()
                                    navigate("/")

                                    function jspmWSStatus(status) {
                                        if (status === WSStatus.Open)
                                            return true;
                                        else if (status === WSStatus.Closed) {
                                            alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                            return false;
                                        }
                                        else if (status === WSStatus.Blocked) {
                                            alert('JSPM has blocked this website!');
                                            return false;
                                        }
                                    }
                                    async function print(printerName, data) {
                                        try {
                                            var clientPrinters = null;
                                            JSPrintManager.auto_reconnect = true;
                                            const timestamp = Date.now();
                                            JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                            await JSPrintManager.start();
                                            JSPrintManager.WS.onStatusChanged = function () {
                                                if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                                    JSPrintManager.getPrintersInfo().then(function (printersList) {
                                                        clientPrinters = printersList;
                                                    });
                                                }
                                            };

                                            const result = jspmWSStatus(JSPrintManager.websocket_status)
                                            if (result) {
                                                var cpj = new ClientPrintJob();
                                                var myPrinter = new InstalledPrinter(printerName);
                                                cpj.clientPrinter = myPrinter;
                                                cpj.printerCommands = await formatInvoiceData(data);

                                                await cpj.sendToClient();
                                                return true
                                            }
                                        } catch (error) {
                                            console.log(error, "From Catch Block=========>")
                                            toast.error(error)
                                            return false
                                        }
                                    }


                                    print(data?.printer?.printer_name, data).then(resr => {
                                        if (resr) {
                                            toast.success("Invoice Printed")
                                        } else {
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            toast.error("return print function false")
                                        }

                                    }).catch(err => {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error("error while printing Kot", err)
                                    })
                                }
                                else {
                                    axios.post(`${config.API_URL}/generateInvoicePdf`, data, { withCredentials: true }).then(async (res) => {
                                        // ! order Place

                                        if (res.data.code === 200) {
                                            setOrderId(0)
                                            setFormValue(defaultform)
                                            setTableSelect(false)
                                            setCart(defaultCart)
                                            setFunctionCalled(false)
                                            const resw = await updatedTableDataOrderDataAndOrderDetails("P", updatedTableDataOrderDataAndOrderDetailsId)
                                            if (resw.status === 200) {

                                            } else {
                                                toast.error(resw.message)
                                            }
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            setHeaderChange(true)
                                            getTables()
                                            navigate("/")

                                            function jspmWSStatus(status) {

                                                if (status === WSStatus.Open)
                                                    return true;
                                                else if (status === WSStatus.Closed) {
                                                    alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                                    return false;
                                                }
                                                else if (status === WSStatus.Blocked) {
                                                    alert('JSPM has blocked this website!');
                                                    return false;
                                                }
                                            }
                                            async function print(printerName, pdf, copies) {
                                                try {
                                                    const base64String = Buffer.from(pdf).toString('base64');
                                                    var clientPrinters = null;
                                                    JSPrintManager.auto_reconnect = true;
                                                    const timestamp = Date.now();
                                                    JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                                    await JSPrintManager.start();
                                                    JSPrintManager.WS.onStatusChanged = function () {
                                                        if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                                            JSPrintManager.getPrintersInfo().then(function (printersList) {
                                                                clientPrinters = printersList;
                                                            });
                                                        }
                                                    };

                                                    const result = jspmWSStatus(JSPrintManager.websocket_status)
                                                    if (result) {
                                                        var cpj = new ClientPrintJob();
                                                        var myPrinter = new InstalledPrinter(printerName);
                                                        cpj.clientPrinter = myPrinter;
                                                        var my_file = new PrintFilePDF(base64String, FileSourceType.Base64, 'MyFile.pdf', copies);

                                                        cpj.files.push(my_file);
                                                        await cpj.sendToClient();
                                                        return true
                                                    }
                                                } catch (error) {
                                                    console.log(error, "Erro From Else Block---------------->")
                                                    toast.error(error)
                                                    return false
                                                }
                                            }
                                            const { number_of_copies, printer_name } = data?.printer
                                            const { pdf } = res.data.results
                                            print(printer_name, pdf.data, number_of_copies).then(resr => {
                                                if (resr) {
                                                    toast.success("Invoice Printed")


                                                } else {
                                                    // setLoading(false)
                                                    setPrintLoader(false)
                                                    toast.error("return print function false")
                                                }

                                            }).catch(err => {
                                                // setLoading(false)
                                                setPrintLoader(false)
                                                toast.error("error while printing Kot", err)
                                            })

                                        } else {
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            toast.error(res.data.results.message)
                                        }
                                    }).catch(err => {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error(err.message)
                                    })
                                }
                            } else {
                                // setLoading(false)
                                setPrintLoader(false)
                                toast.error(res.data.results.message)
                            }
                        }).catch(err => {
                            // setLoading(false)
                            setPrintLoader(false)
                            toast.error(err.message)
                        })
                    } else {
                        // setLoading(false)
                        setPrintLoader(false)
                        toast.error(res.data.results.message)
                    }
                }).catch((err) => {
                    // setLoading(false)
                    setPrintLoader(false)
                    toast.error(err.message)

                })
            }
            else {

                orderPlaceOperations(bodyObject).then(res => {
                    if (res.status === 200) {
                        setHeaderChange(true)
                        toast.success(res.message)
                        setOrderId(0)
                        // setLoading(false)
                        setPrintLoader(false)
                        setFormValue(defaultform)
                        setTableSelect(false)
                        getTables()
                        setCart(defaultCart)

                        setFunctionCalled(false)
                        navigate("/")

                    }
                    else if (res.status === 201) {

                        const { generateInvoicePdfData, server } = res

                        if (!server) {

                            setOrderId(0)
                            // setLoading(false)
                            setPrintLoader(false)
                            setFormValue(defaultform)
                            setTableSelect(false)
                            getTables()
                            setCart(defaultCart)
                            setHeaderChange(true)
                            setFunctionCalled(false)
                            navigate("/")

                            function jspmWSStatus(status) {
                                if (status === WSStatus.Open)
                                    return true;
                                else if (status === WSStatus.Closed) {
                                    alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                    return false;
                                }
                                else if (status === WSStatus.Blocked) {
                                    alert('JSPM has blocked this website!');
                                    return false;
                                }
                            }
                            async function print(printerName, data) {
                                try {
                                    var clientPrinters = null;
                                    JSPrintManager.auto_reconnect = true;
                                    const timestamp = Date.now();
                                    JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                    await JSPrintManager.start();
                                    JSPrintManager.WS.onStatusChanged = function () {
                                        if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                            JSPrintManager.getPrintersInfo().then(function (printersList) {
                                                clientPrinters = printersList;
                                            });
                                        }
                                    };

                                    const result = jspmWSStatus(JSPrintManager.websocket_status)
                                    if (result) {
                                        var cpj = new ClientPrintJob();
                                        var myPrinter = new InstalledPrinter(printerName);
                                        cpj.clientPrinter = myPrinter;
                                        cpj.printerCommands = await formatInvoiceData(data);

                                        await cpj.sendToClient();
                                        return true
                                    }
                                } catch (error) {
                                    console.log(error, "From Catch Block=========>")
                                    toast.error(error)
                                    return false
                                }
                            }


                            print(generateInvoicePdfData?.printer?.printer_name, generateInvoicePdfData).then(resr => {
                                if (resr) {
                                    toast.success("Invoice Printed")
                                } else {
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    toast.error("return print function false")
                                }

                            }).catch(err => {
                                // setLoading(false)
                                setPrintLoader(false)
                                toast.error("error while printing Kot", err)
                            })
                        }
                        else {
                            axios.post(`${config.API_URL}/generateInvoicePdf`, generateInvoicePdfData, { withCredentials: true }).then((res) => {
                                // ! order Place

                                if (res.data.code === 200) {
                                    setOrderId(0)
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    setFormValue(defaultform)
                                    setTableSelect(false)
                                    getTables()
                                    setCart(defaultCart)
                                    changeHeaderContent()
                                    setFunctionCalled(false)
                                    navigate("/")

                                    function jspmWSStatus(status) {

                                        if (status === WSStatus.Open)
                                            return true;
                                        else if (status === WSStatus.Closed) {
                                            alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                            return false;
                                        }
                                        else if (status === WSStatus.Blocked) {
                                            alert('JSPM has blocked this website!');
                                            return false;
                                        }
                                    }
                                    async function print(printerName, pdf, copies) {
                                        try {
                                            const base64String = Buffer.from(pdf).toString('base64');
                                            var clientPrinters = null;
                                            JSPrintManager.auto_reconnect = true;
                                            const timestamp = Date.now();
                                            JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                            await JSPrintManager.start();
                                            JSPrintManager.WS.onStatusChanged = function () {
                                                if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                                    JSPrintManager.getPrintersInfo().then(function (printersList) {
                                                        clientPrinters = printersList;
                                                    });
                                                }
                                            };

                                            const result = jspmWSStatus(JSPrintManager.websocket_status)
                                            if (result) {
                                                var cpj = new ClientPrintJob();
                                                var myPrinter = new InstalledPrinter(printerName);
                                                cpj.clientPrinter = myPrinter;
                                                var my_file = new PrintFilePDF(base64String, FileSourceType.Base64, 'MyFile.pdf', copies);

                                                cpj.files.push(my_file);
                                                await cpj.sendToClient();
                                                return true
                                            }
                                        } catch (error) {
                                            toast.error(error)
                                            return false
                                        }
                                    }
                                    const { number_of_copies, printer_name } = generateInvoicePdfData?.printer
                                    const { pdf } = res.data.results
                                    print(printer_name, pdf.data, number_of_copies).then(resr => {
                                        if (resr) {
                                            toast.success("Invoice Printed")
                                            setOrderId(0)
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            setFormValue(defaultform)
                                            setTableSelect(false)
                                            getTables()
                                            setCart(defaultCart)
                                            changeHeaderContent()
                                            setFunctionCalled(false)
                                            navigate("/")


                                        } else {
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            toast.error("return print function false")
                                        }

                                    }).catch(err => {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error("error while printing Kot", err)
                                    })

                                } else {
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    toast.error(res.data.results.message)
                                }
                            }).catch(err => {
                                // setLoading(false)
                                setPrintLoader(false)
                                toast.error(err.message)
                            })
                        }
                    } else {
                        // setLoading(false)
                        setPrintLoader(false)
                        toast.error(res.message)
                    }

                }).catch((err) => {
                    // setLoading(false)
                    setPrintLoader(false)
                    toast.error(err.message)

                })
            }
        } else {
            if (check === undefined) {

            } else {

                toast.error("Mobile Number Must be 10 Digit")
            }
            console.log(check, "here---check")
            setPrintLoader(false)
        }
    }
    const orderKot = async ({ cart, paymentMode, order_type, userName, gstin, tableNumber, mobile, order_id }) => {
        setActiveSideBArOrderType('dinin')

        const check = validation(order_type)
        if (check) {
            let bodyObject = {}
            if (order_type === "pickup") {
                bodyObject = { cart, order_type, userName, gstin, mobile, order_id }
            } else {
                bodyObject = { cart, order_type, tableNumber, mobile, userName, gstin, order_id }
            }
            // setLoading(true)
            setPrintLoader(true)

            const connection = await checkInternetConnection()
            if (connection) {
                axios.post(`${config.API_URL}/kotOrder`, bodyObject, { withCredentials: true }).then(async (res) => {
                    setDueAmount(0)
                    console.log(res.data, "order response==>")

                    if (res.data.code === 201) {

                        const { multi, multiLanguage, data, order_id } = res?.data?.results?.kotInfo
                        console.log(res?.data?.results.kotInfo, "rpinterFor print===========>")
                        // ! kamnu chhe 

                        function jspmWSStatus(status) {
                            // // //console.log(status, "JSPrinterManager status================================================>")
                            if (status === WSStatus.Open)
                                return true;
                            else if (status === WSStatus.Closed) {
                                alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                return false;
                            }
                            else if (status === WSStatus.Blocked) {
                                alert('JSPM has blocked this website!');
                                return false;
                            }
                        }

                        async function print(printerName, noCopy, pdf) {
                            try {
                                const base64String = Buffer.from(pdf).toString('base64');
                                var clientPrinters = null;
                                JSPrintManager.auto_reconnect = true;
                                const timestamp = Date.now();
                                JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                await JSPrintManager.start();
                                JSPrintManager.WS.onStatusChanged = function () {
                                    if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                        //get client installed printers
                                        JSPrintManager.getPrintersInfo().then(function (printersList) {
                                            clientPrinters = printersList;
                                        });
                                    }
                                };
                                const result = jspmWSStatus(JSPrintManager.websocket_status)
                                if (result) {
                                    var cpj = new ClientPrintJob();
                                    var myPrinter = new InstalledPrinter(printerName);
                                    cpj.clientPrinter = myPrinter;
                                    var my_file = new PrintFilePDF(base64String, FileSourceType.Base64, 'MyFile.pdf', noCopy);
                                    cpj.files.push(my_file)
                                    await cpj.sendToClient();
                                    return true
                                } else {
                                    console.log(result, "result from websocket status")
                                }
                            } catch (error) {
                                toast.error(error, "error from catch block in print function==========>")
                                return false
                            }
                        }
                        if (multiLanguage) {
                            setTableSelect(false)
                            setOrderId(0)
                            setOrderType('')
                            setCart(defaultCart)
                            const resw = await updatedTableDataOrderDataAndOrderDetails("R", order_id)
                            if (resw.status === 200) {

                            } else {
                                toast.error(resw.message)
                            }
                            // setLoading(false)
                            setPrintLoader(false)
                            setHeaderChange(true)
                            getTables()
                            navigate('/')
                            if (multi) {
                                for (const cur of data) {


                                    axios.post(`${config.API_URL}/generateKotPdf`, cur, { withCredentials: true }).then(async (res) => {
                                        if (res.data.code === 201) {

                                            const { pdf } = res.data.results
                                            // ! kamnu chhe 
                                            print(cur?.printer.printer_name, cur.printer.number_of_copies, pdf.data).then(async (resr) => {
                                                if (resr) {

                                                } else {
                                                    // setLoading(false)
                                                    setPrintLoader(false)
                                                    toast.error("return print function false")
                                                }

                                            }).catch(err => {
                                                // setLoading(false)
                                                setPrintLoader(false)
                                                toast.error("error while printing Kot", err)
                                            })


                                        } else {
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            toast.error(res.data.results.message)
                                        }
                                    }).catch((err) => {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error(err.message)

                                    })



                                }
                            }
                            else {
                                // setTableSelect(false)
                                // setOrderId(0)
                                // setOrderType('')
                                // setCart(defaultCart)
                                // const resw = await updatedTableDataOrderDataAndOrderDetails("R", order_id)
                                // if (resw.status === 200) {

                                // } else {
                                //     toast.error(resw.message)
                                // }
                                // setLoading(false)
                                // setPrintLoader(false)
                                // setHeaderChange(true)
                                // getTables()
                                // navigate('/')
                                axios.post(`${config.API_URL}/generateKotPdf`, data, { withCredentials: true }).then(async (res) => {
                                    if (res.data.code === 201) {
                                        setHeaderChange(true)
                                        const { pdf } = res.data.results

                                        // ! kamnu chhe 
                                        print(data?.printer.printer_name, data.printer.number_of_copies, pdf.data).then(async (resr) => {
                                            if (resr) {

                                            } else {
                                                // setLoading(false)
                                                setPrintLoader(false)
                                                toast.error("return print function false")
                                            }

                                        }).catch(err => {
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            toast.error("error while printing Kot", err)
                                        })


                                    } else {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error(res.data.results.message)
                                    }
                                }).catch((err) => {
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    toast.error(err.message)

                                })
                            }

                        }
                        else {
                            function jspmWSStatus(status) {

                                if (status === WSStatus.Open)
                                    return true;
                                else if (status === WSStatus.Closed) {
                                    alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                    return false;
                                }
                                else if (status === WSStatus.Blocked) {
                                    alert('JSPM has blocked this website!');
                                    return false;
                                }
                            }
                            async function print(printerName, data) {
                                try {
                                    var clientPrinters = null;
                                    JSPrintManager.auto_reconnect = true;
                                    const timestamp = Date.now();

                                    JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";


                                    await JSPrintManager.start();
                                    JSPrintManager.WS.onStatusChanged = function () {
                                        if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                            //get client installed printers
                                            JSPrintManager.getPrintersInfo().then(function (printersList) {
                                                clientPrinters = printersList;
                                            });
                                        }
                                    };

                                    const result = jspmWSStatus(JSPrintManager.websocket_status)
                                    if (result) {
                                        var cpj = new ClientPrintJob();
                                        var myPrinter = new InstalledPrinter(printerName);
                                        cpj.clientPrinter = myPrinter;

                                        cpj.printerCommands = await formateKotData(data)


                                        await cpj.sendToClient();

                                        return true
                                    } else {
                                        console.log(result, "result from websocket status")
                                    }
                                } catch (error) {
                                    console.log(error, "error from catch block in print function==========>")
                                    return false
                                }
                            }
                            if (multi) {
                                setFunctionCalled(false)
                                toast.success("Kot Printed")
                                setOrderId(0)
                                getAdminCart()
                                setFormValue(defaultform)
                                setTableSelect(false)
                                changeHeaderContent()
                                const resw = await updatedTableDataOrderDataAndOrderDetails("R", order_id)
                                if (resw.status === 200) {

                                } else {
                                    toast.error(resw.message)
                                }
                                // setLoading(false)
                                setPrintLoader(false)
                                setHeaderChange(true)
                                getTables()
                                navigate("/")

                                for (const cur in data) {
                                    print(cur?.printer.printer_name, cur).then(async (resr) => {

                                        if (resr) {

                                        }
                                    }).catch(err => {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error(err.message)

                                    })
                                }


                            }

                            else {
                                toast.success("Kot Printed")
                                setOrderId(0)
                                getAdminCart()
                                setFormValue(defaultform)
                                setTableSelect(false)
                                setFunctionCalled(false)
                                changeHeaderContent()
                                const resw = await updatedTableDataOrderDataAndOrderDetails("R", order_id)
                                if (resw.status === 200) {

                                } else {
                                    toast.error(resw.message)
                                }
                                // setLoading(false)
                                setPrintLoader(false)
                                setHeaderChange(true)
                                getTables()
                                navigate("/")
                                print(data.printer.printer_name, data).then(async (resr) => {
                                    if (resr) {

                                    } else {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error("return print function false")
                                    }

                                }).catch(err => {
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    toast.error("error while printing Kot", err)
                                })
                            }
                        }

                    } else {
                        // setLoading(false)
                        setPrintLoader(false)
                        toast.error(res.data.results.message)
                    }
                }).catch((err) => {
                    // setLoading(false)
                    setPrintLoader(false)
                    toast.error(err.message)
                })
            }

            else {

                const res = await KotOrderOperations(bodyObject)
                if (res.status == 201) {
                    toast.success(res.message)
                    setOrderId(0)
                    // setLoading(false)
                    setPrintLoader(false)
                    setCart(defaultCart)
                    setFormValue(defaultform)
                    setTableSelect(false)
                    getTables()
                    setHeaderChange(true)
                    navigate("/")
                }
                else if (res.status === 200) {
                    const { generatePdfData, multi, printer_setting, multiLanguage } = res


                    const restaurant = await getAllFromDB('hms_restaurant_mst')


                    if (!multiLanguage) {

                        console.log(generatePdfData, multi, printer_setting)
                        // ! kamnu chhe 
                        function jspmWSStatus(status) {

                            if (status === WSStatus.Open)
                                return true;
                            else if (status === WSStatus.Closed) {
                                alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                return false;
                            }
                            else if (status === WSStatus.Blocked) {
                                alert('JSPM has blocked this website!');
                                return false;
                            }
                        }
                        async function print(printerName, data) {
                            try {

                                var clientPrinters = null;
                                JSPrintManager.auto_reconnect = true;
                                const timestamp = Date.now();
                                JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                await JSPrintManager.start();
                                JSPrintManager.WS.onStatusChanged = function () {
                                    if (jspmWSStatus(JSPrintManager.websocket_status)) {

                                        JSPrintManager.getPrintersInfo().then(function (printersList) {
                                            clientPrinters = printersList;
                                        });
                                    }
                                };

                                const result = jspmWSStatus(JSPrintManager.websocket_status)
                                if (result) {
                                    var cpj = new ClientPrintJob();
                                    var myPrinter = new InstalledPrinter(printerName);
                                    cpj.clientPrinter = myPrinter;
                                    cpj.printerCommands = await formateKotData(data)

                                    await cpj.sendToClient();
                                    return true
                                } else {

                                }
                            } catch (error) {
                                console.log(error, "error from catch block in print function==========>")
                                return false
                            }
                        }
                        if (multi) {

                            const itemDataDivideByCatagories = {}
                            const printersForPrint = {}
                            for (const cur of generatePdfData.items) {
                                const getAllPrinterSettings = await getAllFromDB('hms_printerSetting_mst')

                                const printer = getAllPrinterSettings.find(el => el.menu_categ_id === cur.menu_categ_id && el.default === false && el.print_type === 'K')

                                if (printer) {
                                    if (printersForPrint[cur.menu_categ_id]) {

                                    } else {
                                        printersForPrint[cur.menu_categ_id] = printer
                                    }
                                    if (itemDataDivideByCatagories[cur.menu_categ_id]?.length) {
                                        itemDataDivideByCatagories[cur.menu_categ_id].push(cur)
                                    }
                                    else {
                                        itemDataDivideByCatagories[cur.menu_categ_id] = []
                                        itemDataDivideByCatagories[cur.menu_categ_id].push(cur)
                                    }
                                }
                                else {
                                    if (printersForPrint['defaultPrinter']) {
                                    } else {
                                        printersForPrint['defaultPrinter'] = printer_setting
                                    }
                                    if (itemDataDivideByCatagories.defaultPrinter?.length) {
                                        itemDataDivideByCatagories.defaultPrinter.push(cur)
                                    }
                                    else {
                                        itemDataDivideByCatagories.defaultPrinter = []
                                        itemDataDivideByCatagories.defaultPrinter.push(cur)
                                    }

                                }

                            }


                            for (const cur in itemDataDivideByCatagories) {

                                const data = {
                                    printerSize: printersForPrint[cur].printer_size,
                                    items: itemDataDivideByCatagories[cur],
                                    order_type: generatePdfData.order_type,
                                    order_id: generatePdfData.order_id,
                                    userOrTableNo: generatePdfData.userOrTableNo,
                                    timeAndDate: generatePdfData.timeAndDate
                                }

                                print(printersForPrint[cur].printer_name, data).then(async (resr) => {

                                    if (resr) {

                                        toast.success("Kot Printed")
                                        setOrderId(0)
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        getAdminCart()
                                        setFormValue(defaultform)
                                        setTableSelect(false)
                                        getTables()
                                        setHeaderChange(true)
                                        setFunctionCalled(false)
                                        navigate("/")




                                    }
                                }).catch(err => {
                                    // setLoading(false)
                                    setPrintLoader(false)

                                })
                            }


                        }

                        else {

                            print(printer_setting.printer_name, generatePdfData).then(async (resr) => {
                                if (resr) {


                                    toast.success("Kot Printed")
                                    setOrderId(0)
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    getAdminCart()
                                    setFormValue(defaultform)
                                    setTableSelect(false)
                                    getTables()
                                    setHeaderChange(true)
                                    setFunctionCalled(false)
                                    navigate("/")


                                } else {
                                    // setLoading(false)
                                    setPrintLoader(false)

                                    toast.error("return print function false")
                                }

                            }).catch(err => {
                                // setLoading(false)
                                setPrintLoader(false)
                                toast.error("error while printing Kot", err)
                            })
                        }
                    }
                    else {
                        function jspmWSStatus(status) {

                            if (status === WSStatus.Open)
                                return true;
                            else if (status === WSStatus.Closed) {
                                alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                return false;
                            }
                            else if (status === WSStatus.Blocked) {
                                alert('JSPM has blocked this website!');
                                return false;
                            }
                        }
                        async function print(printerName, noCopy, pdf) {
                            try {
                                const base64String = Buffer.from(pdf).toString('base64');
                                var clientPrinters = null;
                                JSPrintManager.auto_reconnect = true;
                                const timestamp = Date.now();
                                JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                await JSPrintManager.start();
                                JSPrintManager.WS.onStatusChanged = function () {
                                    if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                        //get client installed printers
                                        JSPrintManager.getPrintersInfo().then(function (printersList) {
                                            clientPrinters = printersList;
                                        });
                                    }
                                };
                                const result = jspmWSStatus(JSPrintManager.websocket_status)
                                if (result) {
                                    var cpj = new ClientPrintJob();
                                    var myPrinter = new InstalledPrinter(printerName);

                                    cpj.clientPrinter = myPrinter;
                                    var my_file = new PrintFilePDF(base64String, FileSourceType.Base64, 'MyFile.pdf', noCopy);
                                    cpj.files.push(my_file)
                                    await cpj.sendToClient();
                                    return true
                                } else {
                                    console.log(result, "result from websocket status")
                                }
                            } catch (error) {
                                toast.error(error, "error from catch block in print function==========>")
                                return false
                            }
                        }
                        if (multi) {
                            const itemDataDivideByCatagories = {}
                            const printersForPrint = {}
                            for (const cur of generatePdfData.items) {
                                const getAllPrinterSettings = await getAllFromDB('hms_printerSetting_mst')
                                const printer = getAllPrinterSettings.find(el => el.menu_categ_id === cur.menu_categ_id && el.default === false && el.print_type === 'K')
                                if (printer) {
                                    if (printersForPrint[cur.menu_categ_id]) {

                                    } else {
                                        printersForPrint[cur.menu_categ_id] = printer
                                    }
                                    if (itemDataDivideByCatagories[cur.menu_categ_id]?.length) {
                                        itemDataDivideByCatagories[cur.menu_categ_id].push(cur)
                                    }
                                    else {
                                        itemDataDivideByCatagories[cur.menu_categ_id] = []
                                        itemDataDivideByCatagories[cur.menu_categ_id].push(cur)
                                    }
                                }
                                else {
                                    if (printersForPrint['defaultPrinter']) {
                                    } else {
                                        printersForPrint['defaultPrinter'] = printer_setting
                                    }
                                    if (itemDataDivideByCatagories.defaultPrinter?.length) {
                                        itemDataDivideByCatagories.defaultPrinter.push(cur)
                                    }
                                    else {
                                        itemDataDivideByCatagories.defaultPrinter = []
                                        itemDataDivideByCatagories.defaultPrinter.push(cur)
                                    }

                                }

                            }



                            for (const cur in itemDataDivideByCatagories) {

                                const data = {
                                    printerSize: printersForPrint[cur].printer_size,
                                    items: itemDataDivideByCatagories[cur],
                                    order_type: generatePdfData.order_type,
                                    order_id: generatePdfData.order_id,
                                    userOrTableNo: generatePdfData.userOrTableNo,
                                    timeAndDate: generatePdfData.timeAndDate
                                }

                                axios.post(`${config.API_URL}/generateKotPdf`, data, { withCredentials: true }).then(async (res) => {
                                    if (res.data.code === 201) {
                                        const data = cart?.items?.filter((el => {
                                            if (el.status !== "kot") {
                                                return el
                                            }
                                        }))
                                        const { pdf } = res.data.results

                                        // ! kamnu chhe 
                                        print(printersForPrint[cur].printer_name, printersForPrint[cur].number_of_copies, pdf.data).then(async (resr) => {
                                            if (resr) {

                                                setHeaderChange(true)
                                                // setLoading(false)
                                                setPrintLoader(false)
                                                setTableSelect(false)
                                                setOrderId(0)
                                                setOrderType('')
                                                setCart(defaultCart)
                                                getTables()
                                            } else {
                                                // setLoading(false)
                                                setPrintLoader(false)
                                                toast.error("return print function false")
                                            }

                                        }).catch(err => {
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            toast.error("error while printing Kot", err)
                                        })


                                    } else {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error(res.data.results.message)
                                    }
                                }).catch((err) => {
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    toast.error(err.message)

                                })
                            }


                        }
                        else {
                            generatePdfData.printerSize = printer_setting.printer_size
                            axios.post(`${config.API_URL}/generateKotPdf`, generatePdfData, { withCredentials: true }).then(async (res) => {
                                if (res.data.code === 201) {
                                    const data = cart?.items?.filter((el => {
                                        if (el.status !== "kot") {
                                            return el
                                        }
                                    }))
                                    const { pdf } = res.data.results

                                    // ! kamnu chhe 

                                    print(printer_setting.printer_name, printer_setting.number_of_copies, pdf.data).then(async (resr) => {
                                        if (resr) {

                                            // setLoading(false)
                                            setPrintLoader(false)
                                            setTableSelect(false)
                                            setOrderId(0)
                                            setOrderType('')
                                            setCart(defaultCart)
                                            setHeaderChange(true)
                                            getTables()
                                        } else {
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            toast.error("return print function false")
                                        }

                                    }).catch(err => {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error("error while printing Kot", err)
                                    })


                                } else {
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    toast.error(res.data.results.message)
                                }
                            }).catch((err) => {
                                // setLoading(false)
                                setPrintLoader(false)
                                toast.error(err.message)

                            })
                        }
                        // }
                    }

                }
                else {
                    // setLoading(false)
                    setPrintLoader(false)
                    const hiddenBox = orderType === "pickup" ? "hiddenBox2" : "hiddenBox1";
                    handleBoxClick(hiddenBox)
                    toast.error(res.message)
                }
            }
        } else {
            if (check === undefined) {

            } else {

                toast.error("Mobile Number Must be 10 Digit")
            }
            console.log(check, "here---check")
            setPrintLoader(false)

        }
    }
    const orderHold = async ({ cart, order_type, userName, gstin, tableNumber, mobile, order_id }) => {
        setActiveSideBArOrderType('dinin')
        setLoading(true)
        const check = validation(order_type)
        if (check) {

            let bodyObject = {}
            if (order_type === "pickup") {
                bodyObject = { cart, order_type, userName, gstin, mobile, order_id }
            } else {
                bodyObject = { cart, order_type, tableNumber, mobile, userName, gstin, order_id }
            }
            const connection = await checkInternetConnection()
            if (connection) {
                axios.post(`${config.API_URL}/holdOrder`, bodyObject, { withCredentials: true }).then(async (res) => {
                    if (res.data.code === 201) {
                        setDueAmount(0)
                        toast.success(res.data.results.message)
                        setFormValue(defaultform)
                        setOrderId(0)
                        setLoading(false)
                        changeHeaderContent()
                        setTableSelect(false)
                        setCart(defaultCart)
                        setFunctionCalled(false)
                        const resw = await updatedTableDataOrderDataAndOrderDetails("H", res.data.results.orderId)
                        if (resw.status === 200) {

                        } else {
                            toast.error(resw.message)
                        }
                        await getTables()
                        setHeaderChange(true)
                        navigate("/")
                    } else {
                        setLoading(false)
                        toast.error(res.data.results.message)
                    }


                }).catch((err) => {

                    setLoading(false)
                    toast.error(err.message)
                })
            }
            else {
                const res = await holdOrderOperations(bodyObject)
                if (res.status === 200) {
                    toast.success(res.message)

                    setCart(defaultCart)
                    setFormValue(defaultform)
                    setOrderId(0)
                    setLoading(false)
                    changeHeaderContent()
                    setTableSelect(false)
                    await getTables()
                    setHeaderChange(true)
                    navigate("/")
                    setFunctionCalled(false)
                } else {
                    setLoading(false)
                    toast.error(res.message)
                }
            }
        }
        else {
            if (check === undefined) {

            } else {

                toast.error("Mobile Number Must be 10 Digit")
            }
            console.log(check, "here---check")

            setLoading(false)

        }

    }
    const fetchAllDataFromServer = async () => {

        try {
            const orderDetails = []
            let endDate = new Date();
            let startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
            endDate.setDate(endDate.getDate())

            startDate = moment(startDate).startOf('day').format()
            endDate = moment(endDate).endOf('day').format()
            await dateWiseClearData(new Date(startDate), new Date(endDate))

            const orderRes = await axios.post(`${config.API_URL}/offlineOrders`, { startDate: new Date(startDate), endDate: new Date(endDate) }, { withCredentials: true })
            if (orderRes.data.code === 200) {
                await setToDB('hms_order_mst', orderRes.data.results.orders);
                for (const cur of orderRes.data.results.orders) {
                    for (const details of cur?.hms_orderDetails) {
                        orderDetails.push(details)
                    }
                }
            } else if (orderRes.data.code === 403) {
                console.log(orderRes, "Something Wrong While Fetching Orders")
            } else {
                console.error(orderRes)
                toast.error('Something Wrong While Fetching Orders')
            }

            // await clearIndexedDBStore('hms_orderDetail_mst')

            if (orderDetails.length) {
                await setToDB('hms_orderDetail_mst', orderDetails);
            }
            await clearIndexedDBStore('hms_table_categ_mst')
            const tables = []
            const tableCategRes = await axios.get(`${config.API_URL}/offlineTableCateg`, { withCredentials: true })
            if (tableCategRes.data.code === 200) {
                await setToDB('hms_table_categ_mst', tableCategRes.data.results.tableCatagories);
                for (const cur of tableCategRes.data.results.tableCatagories) {
                    for (const details of cur?.hms_table_msts) {

                        tables.push(details)
                    }
                }
            } else if (tableCategRes.data.code === 403) {

            } else {
                toast.error('Something Wrong While Fetching table Catgegort')

            }
            await clearIndexedDBStore('hms_table_mst')
            // const tableRes = await axios.get(`${config.API_URL}/offlineTable`, { withCredentials: true })
            if (tables.length) {
                await setToDB('hms_table_mst', tables);
            }

        } catch (error) {
            console.error(error)
        }
    }

    //! DON'T TOUCH IT HIGH ALERT ALERT   !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
    function rightsidebarMenuHeight() {
        const body = document.querySelector("body")
        document.body.scrollTop = 0;
        body.style.overflow = "hidden"
        var whight = window.innerHeight;
        var topDivHeight = document.querySelector(".right-sidebar-selection-top")?.offsetHeight
        var billerTableView = document.querySelector(".biller-table-view")?.offsetWidth

        if (billerTableView) {
            const deliveryContainer = document.querySelector(".delivery-orders")
            deliveryContainer.style.width = `${billerTableView - 45}px`
        }
        if (topDivHeight) {
            const right = document.querySelector(".right-sidebar-selection-top")
            if (right) {
                right.style.height = topDivHeight;
                var topHeight = document.querySelector(".top-header")
                if (topHeight) {
                    topHeight = topHeight.offsetHeight
                    var bottomHeight = document.querySelector(".payment-section")
                    if (bottomHeight) {
                        bottomHeight = bottomHeight.offsetHeight
                        var maxfinal = +whight - (+topDivHeight + +topHeight + +bottomHeight + 60);
                        const tbody = document.getElementsByClassName("tbody-scroll")[0]
                        tbody.style.height = `${maxfinal}px`;
                    }
                }
            }
        }
    }




    // !!  Move Kot ANd Table 
    window.scroll(0, 0)

    const getMenuDataFromIdb = async () => {
        const menuData = await getAllFromDB('hms_menu_mst')
        setProduct(() => {
            return [...menuData]
        })
        setShowProduct(() => {
            return [...menuData]
        })
    }
    const getMenuCategoriesFromIdb = async () => {
        const menuData = await getAllFromDB('hms_menu_categ_mst')
        setCatagories(() => {
            return [...menuData]
        })
    }



    const removeDeliveredItemFromCart = async (id) => {
        const filterData = cart?.items?.map(el => {
            if (el.status === 'D') {
                const modifieldItems = el?.menuItems?.filter(el => {
                    if (el.id !== id) {
                        return el
                    }
                })
                el.menuItems = modifieldItems
                return el
            }
            return el

        })


        const { totalBill, myAmount, gst, grandAmount, totalExcGstAmount, totalDiscount, totalQty, totalItems, } = await getAllCalacululatedData(filterData)

        if (orderType === 'pickup' || editOrder) {
            if (editOrder) {
                const { cash, upi, card, due } = formValue
                const max = Math.max(cash, upi, card, due)
                if (card === max) {

                    setFormValue((pre) => {
                        return { ...pre, card: grandAmount, cash: 0, upi: 0, due: 0 }
                    })
                }
                else if (upi === max) {
                    setFormValue((pre) => {
                        return { ...pre, upi: grandAmount, card: 0, cash: 0, due: 0 }
                    })
                }
                else if (due === max) {
                    setFormValue((pre) => {
                        return { ...pre, due: grandAmount, card: 0, cash: 0, upi: 0 }
                    })
                }
                else {
                    setFormValue((pre) => {
                        return { ...pre, cash: grandAmount, card: 0, upi: 0, due: 0 }
                    })
                }
            } else {
                setFormValue((pre) => {
                    return { ...pre, cash: grandAmount, card: 0, upi: 0, due: 0 }
                })
            }
        }
        setCart(pre => {
            return { ...pre, totalQty, totalItems, items: filterData, gst, totalBill, totalDiscount, gst, totalExcGstAmount, myAmount, grandAmount }
        })
    }

    // // ! usable Code

    const validation = (orderType) => {
        const value = formValue

        if (!orderType) {
            toast.error("please select Order type")
            return false
        }
        console.log(cart.items, "Items----->")
        for (const cur of cart.items) {
            for (const item of cur.menuItems) {
                if (!Number(item.qty) || item.qty <= 0) {
                    toast.error("Please Enter Valid QTy")
                    return
                }
            }
        }

        if (orderType === "pickup") {

            const fields = [
                "userName",
                "mobile",
                "address",
                "locality",
                "tableNumber",
                "noOfPerson",
                "gstin",
            ]

            const test = fields.reduce((acu, cur) => {

                if (cur === "mobile") {
                    if (value[cur]) {
                        if (value[cur]?.length !== 0) {
                            if ((value[cur].length > 10 || value[cur].length < 10) && (value[cur] != 0)) {
                                acu[cur] = `${cur} is must be 10 digit`
                            }
                        }
                    }
                }


                return acu
            }, {})

            setEmptyValue(() => {
                return { ...test }
            })
            if (Object.keys(test).length) {
                return false
            }

            else {
                return true
            }

        }
        if (orderType === "dinin") {


            const fields = [
                "userName",
                "mobile",
                "address",
                "locality",
                "tableNumber",
                "noOfPerson",
                "gstin",
            ]
            const test = fields.reduce((acu, cur) => {

                if (cur === "mobile") {
                    if (value[cur]) {
                        if (value[cur].length > 10 || value[cur].length < 10) {
                            acu[cur] = `mobile no. is must be 10 digit`
                        }
                    }
                }
                if (cur === "tableNumber") {
                    if (value[cur] === "") {
                        acu[cur] = `Table No. must be required field`
                    }
                }
                return acu
            }, {})

            setEmptyValue(() => {
                return { ...test }
            })
            if (Object.keys(test).length) {
                return false
            }
            else {
                return true
            }
        }


    }

    // const acceptOnlineOrders = async (id) => {
    //     try {
    //         const res = axios.post(`${config.API_URL}/accept/order`, { id }, { withCredentials: true })
    //         if (res.data.code === 200) {
    //             updateInDB('hms_onlineOrderDetails_mst', res?.data?.results?.updatedOrder)
    //             toast.success("Order Accepted")
    //         } else {
    //             toast.error(res.data.results.message)
    //         }
    //     } catch (error) {
    //         console.log(error)
    //         toast.error(error.message)
    //     }
    // }
    // const foodIsReady = async (id) => {
    //     try {
    //         const res = axios.post(`${config.API_URL}/ready/order`, { id }, { withCredentials: true })
    //         if (res.data.code === 200) {
    //             updateInDB('hms_onlineOrderDetails_mst', res?.data?.results?.updatedOrder)
    //             toast.success("Order Accepted")
    //         } else {
    //             toast.error(res.data.results.message)
    //         }
    //     } catch (error) {
    //         console.log(error)
    //         toast.error(error.message)
    //     }
    // }
    // const rejectOrder = async (id) => {
    //     try {
    //         const res = axios.post(`${config.API_URL}/ready/order`, { id }, { withCredentials: true })
    //         if (res.data.code === 200) {
    //             updateInDB('hms_onlineOrderDetails_mst', res?.data?.results?.updatedOrder)
    //             toast.success("Order Accepted")
    //         } else {
    //             toast.error(res.data.results.message)
    //         }
    //     } catch (error) {
    //         console.log(error)
    //         toast.error(error.message)
    //     }
    // }



    const orderStatusChange = async (id, status) => {
        try {
            setOpenOnlineOrderPopup(false)
            if (status === 'accept' || status == "reject") {
                if (status === 'accept') {
                    setOpenOnlineOrderPopup({ status: true, id: id })
                    return
                }
                setOnlineOrderDetails(() => {
                    return { new: false, acceptOrReject: true }
                })

            }
            if (status === 'AcceptS') {
                setOnlineOrderDetails(() => {
                    return { new: false, acceptOrReject: true }
                })
            }
            const res = await axios.post(`${config.API_URL}/order/status`, { id, status: status === 'AcceptS' ? 'accept' : status }, { withCredentials: true })
            console.log(res, "res-------------->")
            if (res.data.code === 200) {
                await updateInDB('hms_onlineOrders_mst', res?.data?.results?.updatedOrder)
                getAllFromDB('hms_onlineOrders_mst').then(res => {
                    if (res) {
                        const filterOnlinedata = res.filter(el => el.status === "NEW" || el.status === "PREPARING")
                        console.log("here come to updated the zomoto Order-->")
                        if (activeSideBarOrderType === 'delivery') {
                            setShowSideBarOrder((pre) => {
                                return [...filterOnlinedata]
                            })
                        }
                        setOnlineOrders((pre) => {
                            return [...filterOnlinedata]
                        })
                    }
                })
                toast.success(res?.data?.results?.message)

            } else {
                toast.error(res.data.results.message)
            }
        } catch (error) {
            console.log(error)
            toast.error(error.message)
        }
    }

    // const removeFromCartAllQty = async (MenuId, orderId, kotNumber = 0) => {
    //     setLoading(true)

    //     await axios.post(`${config.API_URL}/removeAdminAllCart`, { MenuId, orderId, kotNumber }, { withCredentials: true, })

    //     removeKotAlready(cart, MenuId, orderId, kotNumber).then(async (res) => {

    //         if (res.status === 200) {
    //             setLoading(false)
    //             toast.error(res.message)
    //             holdOrderClick(orderId, true)

    //         } else {
    //             setLoading(false)
    //             toast.error(res.message)
    //         }

    //     }).catch(err => {
    //         toast.error(err.message)

    //     })
    // }

    const removeFromCartAllQty = async (MenuId, orderId, kotNumber = 0) => {
        setLoading(true)
        const connection = await checkInternetConnection()
        if (connection) {

            axios.post(`${config.API_URL}/removeAdminAllCart`, { MenuId, orderId, kotNumber }, { withCredentials: true, }).then(async (res) => {
                if (res.data.code === 200) {
                    setLoading(false)
                    toast.success(res.data.results.message)
                    await updatedTableDataOrderDataAndOrderDetails("R", orderId)
                    holdOrderClick(orderId, true)

                } else {
                    setLoading(false)
                    toast.error(res.data.results.message)
                }
                // window.location.reload()
            }).catch(err => {
                toast.error(err.message)
                // // //console.log(err)
            })
        } else {
            const res = await removeKotAlready(MenuId, orderId, kotNumber)
            if (res.status === 200) {
                setLoading(false)
                toast.error(res.message)
                holdOrderClick(orderId, true)

            } else {
                setLoading(false)
                toast.error(res.data.results.message)
            }
        }
    }
    const decriesKotDeliveryqty = async (MenuId, orderId, kotNumber = 0) => {
        try {
            setLoading(true)
            const connection = await checkInternetConnection()
            if (connection) {

                axios.post(`${config.API_URL}/removeAdminCart`, { MenuId, orderId, kotNumber }, { withCredentials: true, }).then(async (res) => {
                    if (res.data.code === 200) {
                        setLoading(false)
                        toast.success(res.data.results.message)
                        await updatedTableDataOrderDataAndOrderDetails("R", orderId)
                        holdOrderClick(orderId, true)
                        return true
                    } else {

                        setLoading(false)
                        toast.error(res.data.results.message)
                        return true
                    }
                    // window.location.reload()
                }).catch(err => {
                    return true
                    toast.error(err.message)
                    // // //console.log(err)
                })
            } else {
                toast.error("No Internet Connection")
                return true
                // const res = await removeKotAlready(MenuId, orderId, kotNumber)
                // if (res.status === 200) {
                //     setLoading(false)
                //     toast.error(res.message)
                //     holdOrderClick(orderId, true)

                // } else {
                //     setLoading(false)
                //     toast.error(res.data.results.message)
                // }
            }
        } catch (error) {
            toast.error(error.message)
            return true
        }
    }

    const removeKot = async (MenuId, OrderId, kotNumber) => {
        const accessVerify = access.find(el => el.access_name === "Biller")
        if (accessVerify && accessVerify.delete) {
            setNotPermissionPopUp(false)
            setRemoveKotPopUp(true)
            setMenuIdAndOrderIdforRemoveKot(() => {
                return { MenuId, OrderId, kotNumber }
            })
        } else {
            setNotPermissionPopUp(true)
        }
    }
    const getAllCalacululatedData = async (filterData, hotelData = 0) => {
        try {
            let myAmount = 0
            let grandAmount = 0
            let totalBill = 0
            let totalDiscount = +cart.totalDiscount
            let gst = 0
            let totalExcGstAmount = 0
            let totalQty = 0
            let totalItems = 0
            if (!Object.keys(hotel).length && hotelData) {
                hotel.invoiceFormateIncGst = hotelData?.invoiceFormateIncGst
            }
            // const hotelData = await getAllFromDB("hms_restaurant_mst")
            // const hotel = hotelData[0]
            if (filterData) {
                for (const cur of filterData) {
                    for (const items of cur.menuItems) {
                        // console.log(items, "Item From get Calculated----")
                        totalBill += +items.qty * (+items.price).toFixed(2)
                        // console.log(totalBill, +items.qty, (+items.price).toFixed(2), 'totalBill qty price=============>')
                        if (items.gst_type === 'G') {
                            totalExcGstAmount += +items.qty * (+items.price).toFixed(2)
                        }
                        totalQty += items.qty
                        totalItems += 1
                    }
                }
                const calculatedGst = +totalBill - +cart.totalDiscount - +totalExcGstAmount
                // console.log(hotel, "invoiceFormate==============>")
                if (hotel.invoiceFormateIncGst) {
                    gst = (calculatedGst * 5) / 100
                } else {
                    gst = 0
                }
                // console.log(gst, "gst==========>")
                myAmount = +totalBill - +totalDiscount
                grandAmount = Math.round(+myAmount + +gst)
                // console.log({ grandAmount, myAmount: +myAmount.toFixed(2), totalBill: +totalBill.toFixed(2), totalDiscount, gst: +gst.toFixed(2), totalExcGstAmount: +totalExcGstAmount.toFixed(2) }, "Data calulated--------------->")
                return { grandAmount, myAmount: +myAmount.toFixed(2), totalBill: +totalBill.toFixed(2), totalDiscount, gst: +gst.toFixed(2), totalExcGstAmount: +totalExcGstAmount.toFixed(2) }
            } else {
                return { grandAmount: 0, myAmount: 0, totalBill: 0, totalDiscount: 0, gst: 0, totalExcGstAmount: 0 }
            }
        } catch (error) {
            console.log(error)
        }
    }

    const addToCartforRetrieveData = async (orderDetails, move = false) => {
        try {
            // console.log(move, "movee =========>")
            if (move) {
                cart.items = []
                cart.totalBill = 0
                cart.totalDiscount = 0
                cart.myAmount = 0
                cart.grandAmount = 0
                cart.gst = 0
                cart.totalExcGstAmount = 0
            }
            // console.log(cart, "cart From addToCartforRetrieveData==============> ")
            if (orderDetails.length) {
                for (const item of orderDetails) {
                    // console.log(item, "items===>")
                    const demo = { ...item?.hms_menu_mst, price: +item.price, qty: +item.qty, kotNumber: item.kotNumber, discount: item.totalDiscount, status: item.status }
                    if (item.status === 'in-progress') {
                        const findHoldAvailableOrNotHold = cart.items?.find(el => el.status === 'H')
                        if (!findHoldAvailableOrNotHold) {
                            let title = 'KOT-0'
                            let status = 'H'
                            let menuItems = []
                            cart.items.push({ title, status, menuItems: [{ ...demo }] })
                            const { totalBill, myAmount, totalDiscount, totalExcGstAmount, grandAmount, gst, totalQty, totalItems, } = await getAllCalacululatedData(cart.items)
                            // console.log(totalBill, totalExcGstAmount, totalDiscount, gst, grandAmount, myAmount, "totalBill, totalExcGstAmount, totalDiscount, gst, grandAmount, myAmount")
                            setCart((pre) => {
                                return { ...pre, totalQty, totalItems, items: cart.items, totalBill, totalExcGstAmount, totalDiscount, gst, grandAmount, myAmount }
                            })
                        } else {

                            const filterData = cart.items?.map((el) => {
                                if (el.status === 'H') {
                                    el.menuItems.push(demo)
                                    return el
                                }
                                return el
                            })
                            const { grandAmount, myAmount, totalDiscount, totalExcGstAmount, gst, totalBill, totalQty, totalItems, } = await getAllCalacululatedData(filterData)
                            // console.log(grandAmount, myAmount, totalDiscount, totalExcGstAmount, gst, totalBill, "hold available ")

                            setCart((pre) => {
                                return { ...pre, totalQty, totalItems, items: filterData, grandAmount, myAmount, totalBill, totalDiscount, totalExcGstAmount, gst }
                            })
                        }
                    } else if (item.status === 'kot') {
                        const findHoldAvailableOrNotKot = cart.items.find(el => el.title === `KOT-${item.kotNumber}`)
                        // console.log(findHoldAvailableOrNotKot, "find Vaailable Hold Available Or Not Kot ===>")
                        if (!findHoldAvailableOrNotKot) {
                            // console.log(cart, "before Updated findHoldAvailableOrNotKot")
                            let title = `KOT-${item.kotNumber}`
                            let status = 'K'
                            cart.items.push({ title, status, menuItems: [{ ...demo }] })
                            // console.log(cart, "after Update in side not findHoldAvailableOrNotKot")
                            const { totalBill, myAmount, totalExcGstAmount, grandAmount, gst, totalDiscount, totalQty, totalItems } = await getAllCalacululatedData(cart.items)
                            // console.log(totalBill, totalExcGstAmount, totalDiscount, gst, grandAmount, myAmount, "totalBill, totalExcGstAmount, totalDiscount, gst, grandAmount, myAmount")
                            setCart((pre) => {
                                return { ...pre, totalQty, totalItems, items: cart.items, totalBill: (+totalBill).toFixed(2), totalExcGstAmount, totalDiscount: +totalDiscount.toFixed(2), gst: +gst.toFixed(2), grandAmount: +grandAmount.toFixed(2), myAmount: +myAmount.toFixed(2) }
                            })

                        }
                        else {
                            // console.log(cart, "before Updated outdide findHoldAvailableOrNotKot")
                            const filterData = cart.items.map((el) => {
                                if (el.title === `KOT-${item.kotNumber}`) {
                                    el.menuItems.push(demo)
                                    return el
                                }
                                return el
                            })
                            // console.log(cart, "after Updated outdide findHoldAvailableOrNotKot")
                            const { totalBill, grandAmount, myAmount, totalDiscount, totalExcGstAmount, gst, totalQty, totalItems } = await getAllCalacululatedData(filterData)
                            setCart((pre) => {
                                return { ...pre, totalQty, totalItems, items: filterData, totalBill: +totalBill.toFixed(2), totalExcGstAmount, totalDiscount: +totalDiscount.toFixed(2), gst: +gst.toFixed(2), grandAmount: +grandAmount.toFixed(2), myAmount: +myAmount.toFixed(2) }
                            })
                        }
                    }
                }


            }

            else {
                console.log("orderDetails Not Found in addToCartforRetrieveData");
            }
            rightsidebarMenuHeight()
        } catch (error) {
            toast.error(error.message);
            console.log(error);
        }
    };
    const handlechange = async (e) => {
        const { name, value } = e.target

        if (name === 'paymentMode') {
            console.log(value, "calue--------->")
            // if (+formValue.cash + +formValue.card + +formValue.upi + +formValue.due >= cart.grandAmount) {
            setFormValue((pre) => {
                return { ...pre, cash: 0, card: 0, upi: 0, due: 0 }
            })
            // }
            setFormValue((pre) => {
                return { ...pre, [value]: cart.grandAmount }
            })

        }
        else if (name === 'cash' || name === 'upi' || name === 'card' || name === 'due') {

            setFormValue((pre) => {
                return { ...pre, [name]: Number(value) }
            })



        } else {

            if (name === "mobile") {

                console.log(parseInt(value), "calue--------->")
                if (value.length > 10) {

                } else {

                    setFormValue(() => {
                        return { ...formValue, [name]: parseInt(value) }
                    })
                }
            } else {
                setFormValue(() => {
                    return { ...formValue, [name]: value }
                })

            }

            if (name === 'mobile' && value.length === 10) {
                const res = await axios.post(`${config.API_URL}/getDueOrders`, { searchData: { number: value, bill_no: "" }, startDate: false, endDate: false }, { withCredentials: true })
                console.log(res, "res--->")
                if (res.data?.results?.dueOrders?.totalDuePayment) {

                    setDueAmount(res.data?.results?.dueOrders?.totalDuePayment)
                }
            } else {
                setDueAmount(0)
            }

        }
    }
    const holdOrderClick = async (id, move = false, cartEmpty = false) => {
        try {
            console.log(id, "Id --->")
            const res = await getFromDB('hms_order_mst', id)
            // console.log(res, "Responce=============================>")
            // const res = await axios.get(`${config.API_URL}/orderAdminCart/${id}`, { withCredentials: true });
            console.log(res, "from Single Order ===>")
            if (res) {
                // if (cart?.items?.length) {
                // let result
                // if (cartEmpty) {
                //     result = true
                // } else {
                //     result = await confirm("Do you want to lose your previous orderCart");
                // }
                setEditOrder(false)
                // if (result) {
                setCart(defaultCart)
                setOrderId(id)
                if (res?.hms_table_mst?.table_name) {
                    setFormValue((pre) => {
                        return { ...pre, card: 0, upi: 0, cash: 0, gstin: '', userName: "", mobile: "", tableNumber: `${res?.hms_table_mst?.table_name}-${res?.hms_table_mst?.hms_table_categ?.table_catag_nm}` }
                    })
                    setOrderType(res?.order_type)
                }
                if (res?.hms_user_master?.name) {
                    setFormValue((pre) => {
                        return { ...pre, card: 0, upi: 0, cash: 0, gstin: res.hms_user_master?.gstin, userName: res?.hms_user_master?.name, mobile: res?.hms_user_master?.number, }
                    })
                }
                await addToCartforRetrieveData(res.hms_orderDetails, move);
                // navigate("/", { state: { data: { orderType: res?.order_type, formValue: { card: 0, cash: 0, upi: 0, userName: res?.hms_user_master?.name, mobile: res?.hms_user_master?.number, tableNumber: `${res?.hms_table_mst?.table_name}-${res?.hms_table_mst?.hms_table_categ?.table_catag_nm}` }, orderId: id } } })
                // } else {

                // }
                // } else {
                //     if (res?.hms_table_mst?.table_name) {
                //         setFormValue((pre) => {
                //             return { ...pre, card: 0, upi: 0, cash: 0, gstin: '', userName: "", mobile: "", tableNumber: `${res?.hms_table_mst?.table_name}-${res?.hms_table_mst?.hms_table_categ?.table_catag_nm}` }
                //         })
                //         setOrderType(res?.order_type)
                //     }
                //     if (res?.hms_user_master?.name) {
                //         setFormValue((pre) => {
                //             return { ...pre, card: 0, upi: 0, cash: 0, gstin: res.hms_user_master?.gstin, userName: res?.hms_user_master?.name, mobile: res?.hms_user_master?.number, }
                //         })
                //     }
                //     setOrderId(id)
                //     await addToCartforRetrieveData(res.hms_orderDetails, move);
                //     // navigate("/", { state: { data: { orderType: res?.order_type, formValue: { card: 0, cash: 0, upi: 0, userName: res?.hms_user_master?.name, mobile: res?.hms_user_master?.number, tableNumber: `${res?.hms_table_mst?.table_name}-${res?.hms_table_mst?.hms_table_categ?.table_catag_nm}` }, orderId: id } } })
                // }

            } else {
                console.log(res, "from else block=======hold Order button click");
            }
        } catch (error) {
            toast.error(error.message);
            console.log(error)
        }
    };
    const addTocartForEditOrder = async (orderDetails, move = false, hoteldata = 0, totalDiscount) => {
        try {
            // console.log(move, "movee =========>")
            if (move) {
                cart.items = []
                cart.totalBill = 0
                cart.totalDiscount = totalDiscount
                cart.myAmount = 0
                cart.grandAmount = 0
                cart.gst = 0
                cart.totalExcGstAmount = 0
            }
            // console.log(cart, "cart From addToCartforRetrieveData==============> ")
            // console.log(orderDetails, "cart From addToCartforRetrieveData==============> ")
            if (orderDetails.length) {
                for (const item of orderDetails) {
                    // console.log(item, "items===>")
                    const demo = { ...item?.hms_menu_mst, price: +item.price, qty: +item.qty, kotNumber: item.kotNumber, discount: item.totalDiscount, status: item.status }
                    if (item.status === 'delivered') {
                        const findHoldAvailableOrNotHold = cart.items?.find(el => el.status === 'D')
                        if (!findHoldAvailableOrNotHold) {
                            let title = 'Delivered'
                            let status = 'D'
                            let menuItems = []
                            cart.items.push({ title, status, menuItems: [{ ...demo }] })
                            const { totalBill, myAmount, totalDiscount, totalExcGstAmount, grandAmount, gst, totalQty, totalItems, } = await getAllCalacululatedData(cart.items, hoteldata)
                            // console.log(totalBill, totalExcGstAmount, totalDiscount, gst, grandAmount, myAmount, "totalBill, totalExcGstAmount, totalDiscount, gst, grandAmount, myAmount")
                            setCart((pre) => {
                                return { ...pre, totalQty, totalItems, items: cart.items, totalBill, totalExcGstAmount, totalDiscount, gst, grandAmount, myAmount }
                            })
                        }
                        else {
                            const filterData = cart.items?.map((el) => {
                                if (el.status === 'D') {
                                    el.menuItems.push(demo)
                                    return el
                                }
                                return el
                            })
                            const { grandAmount, myAmount, totalDiscount, totalExcGstAmount, gst, totalBill, totalQty, totalItems, } = await getAllCalacululatedData(filterData, hoteldata)
                            // console.log(grandAmount, myAmount, totalDiscount, totalExcGstAmount, gst, totalBill, "hold available ")

                            setCart((pre) => {
                                return { ...pre, totalQty, totalItems, items: filterData, grandAmount, myAmount, totalBill, totalDiscount, totalExcGstAmount, gst }
                            })
                        }
                    }
                }
            }

            else {
                console.log("orderDetails Not Found in addToCartforRetrieveData");
            }
            // console.log(cart, "Cart After Updated-------------------------------->")
        } catch (error) {
            toast.error(error.message);
            // //console.log(error);
        }
    }
    const editPlacedOrder = async (id, hoteldata = 0) => {
        try {
            // const res = await axios.get(`${config.API_URL}/orderAdminCart/${id}`, { withCredentials: true });
            const res = await getFromDB('hms_order_mst', id)
            console.log(res, "from Single Order ===>")
            if (res) {
                if (cart?.items?.length) {
                    const result = true
                    if (result) {
                        setOrderId(id)
                        if (res?.hms_table_mst?.table_name) {
                            setFormValue((pre) => {
                                return { ...pre, userName: "", mobile: "", gstin: '', tableNumber: `${res?.hms_table_mst?.table_name}-${res?.hms_table_mst?.hms_table_categ?.table_catag_nm}` }
                            })
                        }
                        if (res?.hms_user_master?.name) {
                            setFormValue((pre) => {
                                return { ...pre, gstin: res.hms_user_master?.gstin, userName: res.hms_user_master?.name, mobile: res.hms_user_master?.number, }
                            })
                        }
                        setOrderType(res?.order_type)
                        await addTocartForEditOrder(res?.hms_orderDetails, true, hoteldata, res.totalDiscount);
                        // navigate("/", { state: { data: { formValue: {userName: res?.data?.results?.order?.user?.name, mobile: res?.data?.results?.order?.user?.number, tableNumber: `${res?.data?.results?.order?.table?.table_name}-${res?.data?.results?.order?.table?.hms_table_categ?.table_catag_nm}` }, orderId: id } } })
                    } else {
                        // console.log(formValue, "after Updated--------------------------------------->")

                    }
                }
                else {
                    if (res?.hms_table_mst?.table_name) {
                        setFormValue((pre) => {
                            return { ...pre, gstin: '', userName: "", mobile: "", tableNumber: `${res?.hms_table_mst?.table_name}-${res?.hms_table_mst?.hms_table_categ?.table_catag_nm}` }
                        })
                    }
                    if (res?.hms_user_master?.name) {
                        setFormValue((pre) => {
                            return { ...pre, gstin: res.hms_user_master?.gstin, userName: res.hms_user_master?.name, mobile: res.hms_user_master?.number, }
                        })
                    }
                    setOrderType(res?.order_type)
                    setOrderId(id)
                    await addTocartForEditOrder(res?.hms_orderDetails, true, hoteldata, res.totalDiscount);
                    // navigate("/", { state: { data: { formValue: { card: 0, cash: 0, upi: 0, userName: res?.data?.results?.order?.user?.name, mobile: res?.data?.results?.order?.user?.number, tableNumber: `${res?.data?.results?.order?.table?.table_name}-${res?.data?.results?.order?.table?.hms_table_categ?.table_catag_nm}` }, orderId: id } } })
                }

            } else {
                console.log(res, "from else block=======hold Order button click");
            }
        } catch (error) {
            toast.error(error.message);
        }
    }
    const tableClick = (table) => {
        setEditOrder(false)
        if (!tableOnceClick) {
            setTableOnceClick(true)
            const accessVerify = access.find(el => el.access_name === "Biller")
            if (accessVerify && accessVerify.create) {
                setNotPermissionPopUp(false)
                setTimeout(() => {
                    setTableOnceClick(false)
                }, 1000);
                console.log(table, "Table===========>")
                console.log(table.hms_order_msts?.length < 1, "Table===========>")
                if (table.hms_order_msts?.length < 1) {
                    setOrderType("dinin")
                    setActiveOrdertype("dinin")
                    setFormValue((pre) => {
                        return { ...pre, tableNumber: `${table.table_name}-${table?.hms_table_categ.table_catag_nm}` }
                    })
                    setTableSelect(true)
                }
                else {
                    const order = table?.hms_order_msts[0]
                    if (table.table_status === "P") {
                        openSettlePopup({ mobile: order?.hms_user_master?.number ? order?.hms_user_master?.number : 0, table_no: `${table.table_name + "-" + table.hms_table_categ.table_catag_nm}`, id: order.id, bill_no: order.bill_no, time: order.createdAt, amount: order.grandAmount, cash: order.grandAmount, card: 0, upi: 0, due: 0 })
                    } else {
                        setOrderType("dinin")
                        setActiveOrdertype("dinin")
                        console.log(`${table.table_name}-${table?.hms_table_categ.table_catag_nm} ,table Number---------------------->`)
                        setFormValue((pre) => {
                            return { ...pre, tableNumber: `${table.table_name}-${table?.hms_table_categ.table_catag_nm}` }
                        })
                        setTableSelect(true)
                        holdOrderClick(order.id)
                    }
                }

            } else {
                setNotPermissionPopUp(true)
            }
        }
    }
    const pickUpClickKeyBoard = () => {
        setOrderType('pickup')
        setCart(defaultCart)
        setTableSelect(true)
    }
    // auto scroll tbody
    const updateInvoice = async (data) => {

        const { cart, orderId, cash, upi, card, due, userName, gstin, mobile, print } = data

        const connection = await checkInternetConnection()
        setLoading(true)
        if (connection) {
            axios.post(`${config.API_URL}/updateInvoice`, { addItem, cart, orderId, cash, upi, card, due, userName, gstin, mobile }, { withCredentials: true }).then(async (res) => {
                if (res.data.code === 200) {
                    setDueAmount(0)
                    await fetchAllDataFromServer()
                    setCart(defaultCart)
                    setEditOrder(false)
                    setAddItem(false)
                    if (print) {

                        await axios.post(`${config.API_URL}/adminBillData`, { orderId }, { withCredentials: true }).then(async (res) => {
                            // ! order Place
                            if (res.data.code === 200) {
                                const { data, multiLanguage, logoAvailable } = res.data.results
                                if (!multiLanguage || !logoAvailable) {
                                    function jspmWSStatus(status) {
                                        if (status === WSStatus.Open)
                                            return true;
                                        else if (status === WSStatus.Closed) {
                                            alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                            return false;
                                        }
                                        else if (status === WSStatus.Blocked) {
                                            alert('JSPM has blocked this website!');
                                            return false;
                                        }
                                    }
                                    async function print(printerName, data) {
                                        try {
                                            var clientPrinters = null;
                                            JSPrintManager.auto_reconnect = true;
                                            const timestamp = Date.now();
                                            JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                            await JSPrintManager.start();
                                            JSPrintManager.WS.onStatusChanged = function () {
                                                if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                                    JSPrintManager.getPrintersInfo().then(function (printersList) {
                                                        clientPrinters = printersList;
                                                    });
                                                }
                                            };

                                            const result = jspmWSStatus(JSPrintManager.websocket_status)
                                            if (result) {
                                                var cpj = new ClientPrintJob();
                                                var myPrinter = new InstalledPrinter(printerName);
                                                cpj.clientPrinter = myPrinter;
                                                cpj.printerCommands = await formatInvoiceData(data);
                                                // var my_file = new PrintFilePDF(`${config.API_URL}/any/order${orderId}.pdf`, FileSourceType.URL, 'MyFile.pdf', copies);

                                                // cpj.files.push(my_file);
                                                await cpj.sendToClient();
                                                return true
                                            }
                                        } catch (error) {
                                            console.log(error, "From Catch Block=========>")
                                            toast.error(error)
                                            return false
                                        }
                                    }

                                    // const { number_of_copies, printer_name } = res.data.results.printerName
                                    print(data?.printer?.printer_name, data).then(resr => {
                                        if (resr) {

                                            toast.success("Invoice Printed")
                                        } else {
                                            setLoading(false)
                                            toast.error("return print function false")
                                        }

                                    }).catch(err => {
                                        setLoading(false)
                                        toast.error("error while printing Kot", err)
                                    })
                                }
                                else {
                                    axios.post(`${config.API_URL}/generateInvoicePdf`, data, { withCredentials: true }).then(async (res) => {
                                        // ! order Place

                                        if (res.data.code === 200) {
                                            function jspmWSStatus(status) {
                                                // // //console.log(status, "JSPrinterManager status================================================>")
                                                if (status === WSStatus.Open)
                                                    return true;
                                                else if (status === WSStatus.Closed) {
                                                    alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                                    return false;
                                                }
                                                else if (status === WSStatus.Blocked) {
                                                    alert('JSPM has blocked this website!');
                                                    return false;
                                                }
                                            }
                                            async function print(printerName, pdf, copies) {
                                                try {
                                                    const base64String = Buffer.from(pdf).toString('base64');
                                                    var clientPrinters = null;
                                                    JSPrintManager.auto_reconnect = true;
                                                    const timestamp = Date.now();
                                                    JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                                    await JSPrintManager.start();
                                                    JSPrintManager.WS.onStatusChanged = function () {
                                                        if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                                            JSPrintManager.getPrintersInfo().then(function (printersList) {
                                                                clientPrinters = printersList;
                                                            });
                                                        }
                                                    };

                                                    const result = jspmWSStatus(JSPrintManager.websocket_status)
                                                    if (result) {
                                                        var cpj = new ClientPrintJob();
                                                        var myPrinter = new InstalledPrinter(printerName);
                                                        cpj.clientPrinter = myPrinter;
                                                        var my_file = new PrintFilePDF(base64String, FileSourceType.Base64, 'MyFile.pdf', copies);
                                                        //console.log(my_file)
                                                        // var my_file = new PrintFile(`${config.API_URL}/any/order${orderId}.png`, FileSourceType.URL, 'order.png', 1);
                                                        cpj.files.push(my_file);
                                                        await cpj.sendToClient();
                                                        return true
                                                    }
                                                } catch (error) {
                                                    toast.error(error)
                                                    return false
                                                }
                                            }
                                            const { number_of_copies, printer_name } = data?.printer
                                            const { pdf } = res.data.results
                                            print(printer_name, pdf.data, number_of_copies).then(resr => {
                                                if (resr) {

                                                } else {
                                                    setLoading(false)
                                                    toast.error("return print function false")
                                                }

                                            }).catch(err => {
                                                setLoading(false)
                                                toast.error("error while printing Kot", err)
                                            })

                                        } else {
                                            setLoading(false)
                                            toast.error(res.data.results.message)
                                        }
                                    }).catch(err => {
                                        setLoading(false)
                                        toast.error(err.message)
                                    })
                                }
                            } else {
                                setLoading(false)
                                toast.error(res.data.results.message)
                            }
                        }).catch(err => {
                            setLoading(false)
                            toast.error(err.message)
                        })


                    }
                    toast.success(res.data.results.message)
                    setOrderId(0)

                    setLoading(false)
                    setTableSelect(false)
                    await getTables()
                    navigate('/')
                } else {
                    setLoading(false)
                    toast.error(res.data.results.message)
                }
            }).catch(err => {

                setLoading(false)
                toast.error(err.message)
            })
        }
        else {
            const getOrderDetails = await getFromDB('hms_order_mst', orderId)
            setLoading(true)
            let bodyObject = {}
            // console.log(getOrderDetails, "Order Details Fetching --------------->")

            if (orderType === "pickup") {
                bodyObject = { cart, order_type: getOrderDetails.order_type, userName, gstin, mobile, order_id: orderId, cash, card, upi, }
            } else {
                bodyObject = { cart, order_type: getOrderDetails.order_type, tableNumber: `${getOrderDetails.hms_table_mst.table_name}-${getOrderDetails?.hms_table_mst?.hms_table_categ?.table_catag_nm}`, mobile, userName, gstin, cash, card, upi, order_id: orderId }
            }
            editOrderFromIdb(bodyObject).then(async (res) => {

                if (res.status === 200) {
                    setCart(defaultCart)
                    setEditOrder(false)
                    setOrderType('')
                    setOrderId(0)
                    await getTables()
                    setLoading(false)
                    setTableSelect(false)
                    navigate('/')
                    // setTimeout(() => {
                    //     navigate("/orders")
                    //     window.location.reload()
                    // }, 1800);
                }
                else if (res.status === 201) {
                    if (print) {
                        setEditOrder(false)
                        const { generateInvoicePdfData, server } = res
                        // console.log(generateInvoicePdfData, "generarte Invoice Pdf ================>")
                        // axios.post(`${config.API_URL}/generateInvoicePdf`, generateInvoicePdfData, { withCredentials: true }).then((res) => {
                        // ! order Place
                        // if (res.data.code === 200) {
                        if (!server) {

                            function jspmWSStatus(status) {
                                if (status === WSStatus.Open)
                                    return true;
                                else if (status === WSStatus.Closed) {
                                    alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                    return false;
                                }
                                else if (status === WSStatus.Blocked) {
                                    alert('JSPM has blocked this website!');
                                    return false;
                                }
                            }
                            async function print(printerName, data) {
                                try {
                                    var clientPrinters = null;
                                    JSPrintManager.auto_reconnect = true;
                                    const timestamp = Date.now();
                                    JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                    await JSPrintManager.start();
                                    JSPrintManager.WS.onStatusChanged = function () {
                                        if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                            JSPrintManager.getPrintersInfo().then(function (printersList) {
                                                clientPrinters = printersList;
                                            });
                                        }
                                    };

                                    const result = jspmWSStatus(JSPrintManager.websocket_status)
                                    if (result) {
                                        var cpj = new ClientPrintJob();
                                        var myPrinter = new InstalledPrinter(printerName);
                                        cpj.clientPrinter = myPrinter;
                                        cpj.printerCommands = await formatInvoiceData(data);
                                        // var my_file = new PrintFilePDF(`${config.API_URL}/any/order${orderId}.pdf`, FileSourceType.URL, 'MyFile.pdf', copies);

                                        // cpj.files.push(my_file);
                                        await cpj.sendToClient();
                                        return true
                                    }
                                } catch (error) {
                                    console.log(error, "From Catch Block=========>")
                                    toast.error(error)
                                    return false
                                }
                            }

                            // const { number_of_copies, printer_name } = res.data.results.printerName
                            print(generateInvoicePdfData?.printer?.printer_name, generateInvoicePdfData).then(async (resr) => {
                                if (resr) {
                                    toast.success("Invoice Updated")
                                    setCart(defaultCart)
                                    setEditOrder(false)
                                    setOrderType('')
                                    setOrderId(0)
                                    // setTimeout(() => {
                                    await getTables()
                                    setLoading(false)
                                    setTableSelect(false)
                                    navigate('/')
                                    //     window.location.reload()
                                    // }, 1800);
                                } else {
                                    setLoading(false)
                                    toast.error("return print function false")
                                }

                            }).catch(err => {
                                setLoading(false)
                                toast.error("error while printing Kot", err)
                            })
                        }
                        else {
                            axios.post(`${config.API_URL}/generateInvoicePdf`, generateInvoicePdfData, { withCredentials: true }).then((res) => {
                                // ! order Place

                                if (res.data.code === 200) {
                                    setOrderId(0)
                                    setLoading(false)
                                    setFormValue(defaultform)
                                    setTableSelect(false)
                                    getTables()
                                    setCart(defaultCart)
                                    changeHeaderContent()
                                    setFunctionCalled(false)
                                    navigate("/")

                                    function jspmWSStatus(status) {
                                        // // //console.log(status, "JSPrinterManager status================================================>")
                                        if (status === WSStatus.Open)
                                            return true;
                                        else if (status === WSStatus.Closed) {
                                            alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                                            return false;
                                        }
                                        else if (status === WSStatus.Blocked) {
                                            alert('JSPM has blocked this website!');
                                            return false;
                                        }
                                    }
                                    async function print(printerName, pdf, copies) {
                                        try {
                                            const base64String = Buffer.from(pdf).toString('base64');
                                            var clientPrinters = null;
                                            JSPrintManager.auto_reconnect = true;
                                            const timestamp = Date.now();
                                            JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                                            await JSPrintManager.start();
                                            JSPrintManager.WS.onStatusChanged = function () {
                                                if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                                    JSPrintManager.getPrintersInfo().then(function (printersList) {
                                                        clientPrinters = printersList;
                                                    });
                                                }
                                            };

                                            const result = jspmWSStatus(JSPrintManager.websocket_status)
                                            if (result) {
                                                var cpj = new ClientPrintJob();
                                                var myPrinter = new InstalledPrinter(printerName);
                                                cpj.clientPrinter = myPrinter;
                                                var my_file = new PrintFilePDF(base64String, FileSourceType.Base64, 'MyFile.pdf', copies);
                                                //console.log(my_file)
                                                // var my_file = new PrintFile(`${config.API_URL}/any/order${orderId}.png`, FileSourceType.URL, 'order.png', 1);
                                                cpj.files.push(my_file);
                                                await cpj.sendToClient();
                                                return true
                                            }
                                        } catch (error) {
                                            toast.error(error)
                                            return false
                                        }
                                    }
                                    const { number_of_copies, printer_name } = generateInvoicePdfData?.printer
                                    const { pdf } = res.data.results
                                    print(printer_name, pdf.data, number_of_copies).then(resr => {
                                        if (resr) {
                                            toast.success("Invoice Printed")
                                            setOrderId(0)
                                            setLoading(false)
                                            setFormValue(defaultform)
                                            setTableSelect(false)
                                            getTables()
                                            setCart(defaultCart)
                                            changeHeaderContent()
                                            setFunctionCalled(false)
                                            navigate("/")

                                        } else {
                                            setLoading(false)
                                            toast.error("return print function false")
                                        }

                                    }).catch(err => {
                                        setLoading(false)
                                        toast.error("error while printing Kot", err)
                                    })

                                } else {
                                    setLoading(false)
                                    toast.error(res.data.results.message)
                                }
                            }).catch(err => {
                                setLoading(false)
                                toast.error(err.message)
                            })
                        }
                    } else {
                        setCart(defaultCart)
                        setEditOrder(false)
                        setOrderType('')
                        setOrderId(0)
                        // setTimeout(() => {
                        await getTables()
                        setLoading(false)
                        setTableSelect(false)
                        navigate('/')
                        // window.location.reload()
                        // }, 1800);
                    }
                } else {
                    setLoading(false)
                    toast.error(res.message)
                }

            }).catch((err) => {
                setLoading(false)
                toast.error(err.message)

            })
        }
    }
    const classNameSection = (status) => {
        if (status === "R") {
            // return "select-table reserved_table"
            return "table-2 reserved_table"
        } else if (status === "P") {
            return "table-2 payment_pending_table"
            // return "select-table payment_pending_table"
        } else if (status === "H") {
            return "table-2 hold_table"
            // return "select-table hold_table"
        } else if (status === "B") {
            return "table-2 book_table"
            // return "select-table book_table"
        } else {
            return "table-2"
        }
    }

    //! ShortCut Key Logic DON'T TOUCH HIGH ALERT ALERT !!!!

    const clickYesButtonOnDelete = () => {
        // //console.log("clickYesButtonOnDelete=======>", menuIdAndOrderIdforRemoveKot.MenuId, menuIdAndOrderIdforRemoveKot.OrderId, menuIdAndOrderIdforRemoveKot.kotNumber)
        removeFromCartAllQty(menuIdAndOrderIdforRemoveKot.MenuId, menuIdAndOrderIdforRemoveKot.OrderId, menuIdAndOrderIdforRemoveKot.kotNumber)
        setRemoveKotPopUp(false)
        setMenuIdAndOrderIdforRemoveKot((pre) => {
            return { MenuId: 0, OrderId: 0, kotNumber: 0 }
        })
    }
    const rePrintKot = async (name, orderId) => {

        try {
            setKotwiseDropDown(false)
            const kotNumber = name.split("-")[1]
            const items = cart?.items?.filter(el => el.title === name)
            //console.log(items)
            setPrintLoader(true)

            const res = await kotRePrint({ kotNumber, orderId, items: items[0] })
            if (res.status == 201) {
                // toast.success(res.data.results.message)
                const { generatePdfData, multi, printer_setting, multiLanguage } = res
                // ! kamnu chhe 
                console.log(printer_setting, "generatePdfData-==------------------>")
                function jspmWSStatus(status) {
                    // // //console.log(status, "JSPrinterManager status================================================>")
                    if (status === WSStatus.Open)
                        return true;
                    else if (status === WSStatus.Closed) {
                        alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                        return false;
                    }
                    else if (status === WSStatus.Blocked) {
                        alert('JSPM has blocked this website!');
                        return false;
                    }
                }

                async function print(printerName, noCopy, pdf) {
                    try {
                        const base64String = Buffer.from(pdf).toString('base64');
                        var clientPrinters = null;
                        JSPrintManager.auto_reconnect = true;
                        const timestamp = Date.now();
                        JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                        await JSPrintManager.start();
                        JSPrintManager.WS.onStatusChanged = function () {
                            if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                //get client installed printers
                                JSPrintManager.getPrintersInfo().then(function (printersList) {
                                    clientPrinters = printersList;
                                });
                            }
                        };
                        const result = jspmWSStatus(JSPrintManager.websocket_status)
                        if (result) {
                            var cpj = new ClientPrintJob();
                            var myPrinter = new InstalledPrinter(printerName);
                            cpj.clientPrinter = myPrinter;
                            var my_file = new PrintFilePDF(base64String, FileSourceType.Base64, 'MyFile.pdf', noCopy);
                            cpj.files.push(my_file)
                            await cpj.sendToClient();
                            return true
                        } else {
                            console.log(result, "result from websocket status")
                        }
                    } catch (error) {
                        toast.error(error, "error from catch block in print function==========>")
                        return false
                    }
                }
                if (multiLanguage) {

                    if (multi) {
                        const itemDataDivideByCatagories = {}
                        const printersForPrint = {}
                        for (const cur of generatePdfData.items) {
                            const getAllPrinterSettings = await getAllFromDB('hms_printerSetting_mst')

                            const printer = getAllPrinterSettings.find(el => el.menu_categ_id === cur.menu_categ_id && el.default === false && el.print_type === 'K')

                            if (printer) {
                                if (printersForPrint[cur.menu_categ_id]) {

                                } else {
                                    printersForPrint[cur.menu_categ_id] = printer
                                }
                                if (itemDataDivideByCatagories[cur.menu_categ_id]?.length) {
                                    itemDataDivideByCatagories[cur.menu_categ_id].push(cur)
                                }
                                else {
                                    itemDataDivideByCatagories[cur.menu_categ_id] = []
                                    itemDataDivideByCatagories[cur.menu_categ_id].push(cur)
                                }
                            }
                            else {
                                if (printersForPrint['defaultPrinter']) {
                                } else {
                                    printersForPrint['defaultPrinter'] = printer_setting
                                }
                                if (itemDataDivideByCatagories.defaultPrinter?.length) {
                                    itemDataDivideByCatagories.defaultPrinter.push(cur)
                                }
                                else {
                                    itemDataDivideByCatagories.defaultPrinter = []
                                    itemDataDivideByCatagories.defaultPrinter.push(cur)
                                }

                            }

                        }
                        for (const cur in itemDataDivideByCatagories) {

                            const data = {
                                printerSize: printersForPrint[cur].printer_size,
                                items: itemDataDivideByCatagories[cur],
                                order_type: generatePdfData.order_type,
                                order_id: generatePdfData.order_id,
                                userOrTableNo: generatePdfData.userOrTableNo,
                                timeAndDate: generatePdfData.timeAndDate
                            }

                            axios.post(`${config.API_URL}/generateKotPdf`, data, { withCredentials: true }).then(async (res) => {
                                if (res.data.code === 201) {

                                    const { pdf } = res.data.results
                                    // ! kamnu chhe 
                                    print(printersForPrint[cur]?.printer_name, printersForPrint[cur].number_of_copies, pdf.data).then(async (resr) => {
                                        if (resr) {
                                            setPrintLoader(false)
                                            toast.success("Kot RePrinted")
                                        } else {
                                            // setLoading(false)
                                            setPrintLoader(false)
                                            toast.error("return print function false")
                                        }

                                    }).catch(err => {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error("error while printing Kot", err)
                                    })


                                } else {
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    toast.error(res.data.results.message)
                                }
                            }).catch((err) => {
                                // setLoading(false)
                                setPrintLoader(false)
                                toast.error(err.message)

                            })
                        }

                    }

                    else {




                        axios.post(`${config.API_URL}/generateKotPdf`, generatePdfData, { withCredentials: true }).then(async (res) => {
                            if (res.data.code === 201) {

                                const { pdf } = res.data.results

                                // ! kamnu chhe 
                                print(printer_setting?.printer_name, printer_setting?.number_of_copies, pdf.data).then(async (resr) => {
                                    if (resr) {
                                        setPrintLoader(false)
                                        toast.success("Kot Reprinted")
                                    } else {
                                        // setLoading(false)
                                        setPrintLoader(false)
                                        toast.error("return print function false")
                                    }

                                }).catch(err => {
                                    // setLoading(false)
                                    setPrintLoader(false)
                                    toast.error("error while printing Kot", err)
                                })


                            } else {
                                // setLoading(false)
                                setPrintLoader(false)
                                toast.error(res.data.results.message)
                            }
                        }).catch((err) => {
                            // setLoading(false)
                            setPrintLoader(false)
                            toast.error(err.message)

                        })
                    }

                }
                else {

                    function jspmWSStatus(status) {
                        if (status === WSStatus.Open)
                            return true;
                        else if (status === WSStatus.Closed) {
                            alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                            return false;
                        }
                        else if (status === WSStatus.Blocked) {
                            alert('JSPM has blocked this website!');
                            return false;
                        }
                    }
                    async function print(printerName, data) {
                        try {
                            var clientPrinters = null;
                            JSPrintManager.auto_reconnect = true;
                            const timestamp = Date.now();

                            JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";


                            await JSPrintManager.start();
                            JSPrintManager.WS.onStatusChanged = function () {
                                if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                    //get client installed printers
                                    JSPrintManager.getPrintersInfo().then(function (printersList) {
                                        clientPrinters = printersList;
                                    });
                                }
                            };

                            const result = jspmWSStatus(JSPrintManager.websocket_status)
                            if (result) {
                                var cpj = new ClientPrintJob();
                                var myPrinter = new InstalledPrinter(printerName);
                                cpj.clientPrinter = myPrinter;

                                cpj.printerCommands = await formateKotData(data)
                                await cpj.sendToClient();
                                return true
                            } else {
                                console.log(result, "result from websocket status")
                            }
                        } catch (error) {
                            console.log(error, "error from catch block in print function==========>")
                            return false
                        }
                    }
                    if (multi) {

                        const itemDataDivideByCatagories = {}
                        const printersForPrint = {}
                        for (const cur of generatePdfData.items) {
                            const getAllPrinterSettings = await getAllFromDB('hms_printerSetting_mst')

                            const printer = getAllPrinterSettings.find(el => el.menu_categ_id === cur.menu_categ_id && el.default === false && el.print_type === 'K')

                            if (printer) {
                                if (printersForPrint[cur.menu_categ_id]) {

                                } else {
                                    printersForPrint[cur.menu_categ_id] = printer
                                }
                                if (itemDataDivideByCatagories[cur.menu_categ_id]?.length) {
                                    itemDataDivideByCatagories[cur.menu_categ_id].push(cur)
                                }
                                else {
                                    itemDataDivideByCatagories[cur.menu_categ_id] = []
                                    itemDataDivideByCatagories[cur.menu_categ_id].push(cur)
                                }
                            }
                            else {
                                if (printersForPrint['defaultPrinter']) {
                                } else {
                                    printersForPrint['defaultPrinter'] = printer_setting
                                }
                                if (itemDataDivideByCatagories.defaultPrinter?.length) {
                                    itemDataDivideByCatagories.defaultPrinter.push(cur)
                                }
                                else {
                                    itemDataDivideByCatagories.defaultPrinter = []
                                    itemDataDivideByCatagories.defaultPrinter.push(cur)
                                }

                            }

                        }


                        for (const cur in itemDataDivideByCatagories) {

                            const data = {
                                printerSize: printersForPrint[cur].printer_size,
                                items: itemDataDivideByCatagories[cur],
                                order_type: generatePdfData.order_type,
                                order_id: generatePdfData.order_id,
                                userOrTableNo: generatePdfData.userOrTableNo,
                                timeAndDate: generatePdfData.timeAndDate
                            }

                            print(printersForPrint[cur].printer_name, data).then(async (resr) => {
                                if (resr) {
                                    setPrintLoader(false)
                                    toast.success('Kot RePrinted')
                                } else {

                                    toast.error("return print function false")
                                }
                                setPrintLoader(false)

                            }).catch(err => {

                                setPrintLoader(false)
                                toast.error("error while printing Kot", err)
                            })
                        }


                    }
                    else {
                        print(printer_setting.printer_name, generatePdfData).then(async (resr) => {
                            if (resr) {
                                setPrintLoader(false)
                                toast.success("Kot Reprinted")
                            } else {
                                // setLoading(false)
                                setPrintLoader(false)
                                toast.error("return print function false")
                            }

                        }).catch(err => {
                            // setLoading(false)
                            setPrintLoader(false)
                            toast.error("error while printing Kot", err)
                        })

                    }
                }

                toast.success(res.message)
            } else if (res.status == 200) {
                toast.success(res.message)
                setKotwiseDropDown(false)

                setPrintLoader(false)

            } else {
                toast.error(res.data.results.message)
            }
        } catch (error) {
            console.log(error)
            setPrintLoader(false)
            toast.error("SomeThing Wrong While Reprint Kot Please Back and after try Again")
        }
    }
    const moveKot = (kotN, orderId, tableN) => {
        setKotwiseDropDown(false)
        //console.log(kotN, orderId, tableN)
        const kotNumber = kotN.split("-")[1]
        const tableData = tables.find((table) => {

            if (table.table_name === tableN.split("-")[0] && table.hms_table_categ.table_catag_nm === tableN.split("-")[1]) {
                return table
            }
        })
        //console.log(tableData, "tableData===========>")
        setMoveKotPopup(true)
        setMoveKotDetails((pre) => {
            return { kotNumber: +kotNumber, tableId1: tableData.id, tableId2: 0, orderId }
        })
        const showTableData = tables.filter(el => {

            if (el.id === tableData.id || el.table_status === "P") {

            } else {
                return el
            }

        })

        setShowTableOnMove(() => {
            return [...showTableData]
        })
    }
    const kotWiseDropDownClick = (id) => {

        //console.log(id)
        if (kotwiseDropDown === id) {
            setKotwiseDropDown(0)
        }
        else {
            setKotwiseDropDown(id)
        }
    }
    const closeMoveKotPopup = () => {
        setMoveKotPopup(false)
    }
    const moveKotClick = (id) => {
        setMoveKotPopup(false)
        setMoveKotDetails((pre) => {
            return { ...pre, tableId2: id }
        })
        setMoveKotConfirmPopUp(true)
    }
    const moveTable = async (name, id) => {

        const getOrder = await getFromDB('hms_order_mst', id)
        if (getOrder.status === 'hold') {
            toast.error("Hold Table Can't Move")
        } else {

            const table_name = name.split('-')[0]
            const table_catag_nm = name.split('-')[1]

            const table = tables.find((el) => {
                if (el?.table_name === table_name && el?.hms_table_categ?.table_catag_nm === table_catag_nm) {
                    return el
                }
            })
            const filterTable = tables.filter(el => {
                if (el.id == table.id || el.table_status == "P") {

                } else {
                    return el
                }
            })
            setMoveTablePopup(true)
            setMoveTableDetails(pre => {
                return { ...pre, tableId1: table.id }
            })
            setShowTableOnMoveTable((pre) => {
                return [...filterTable]
            })
        }
    }
    const moveTableClick = (id) => {
        // setMoveKotConfirmPopUp
        setMoveTablePopup(false)
        setMoveTableConfirmPopUp(true)
        setMoveTableDetails(pre => {
            return { ...pre, tableId2: id }
        })


    }
    const closeMoveTablePopup = () => {
        setMoveTablePopup(false)
    }
    const closeMoveTableConfirmPopup = () => {
        setMoveTableConfirmPopUp(false)
    }

    //! offline logic
    // const clickYesButtonOnMoveTable = async () => {
    //     try {
    //         setLoading(true)
    //         moveTableDetails.orderId = orderId
    //         const res = await axios.post(`${config.API_URL}/moveTable`, moveTableDetails, { withCredentials: true })
    //         // const res = await moveTableIdb(moveTableDetails, cart)

    //         //console.log(res.data.code)
    //         if (res.data.code === 200) {
    //             setHeaderChange(true)
    //             toast.success(res.message)
    //             setMoveTableConfirmPopUp(false)
    //             getAdminCart()
    //             holdOrderClick(res.orderId, true)
    //             setMoveTableDetails(() => {
    //                 return {
    //                     tableId1: 0,
    //                     tableId2: 0,
    //                 }
    //             })
    //             setLoading(false)
    //         } else {
    //             toast.error(res.message)
    //             setLoading(false)
    //             getAdminCart()
    //         }
    //     } catch (error) {
    //         toast.error(error.message)
    //         setLoading(false)
    //     }
    // }
    const clickYesButtonOnMoveTable = async () => {
        try {
            setLoading(true)
            moveTableDetails.orderId = orderId
            const res = await axios.post(`${config.API_URL}/moveTable`, moveTableDetails, { withCredentials: true })
            //console.log(res.data.code)
            if (res.data.code === 200) {
                // setHeaderChange(true)
                toast.success(res.data.results.message)
                setMoveTableConfirmPopUp(false)
                await fetchAllDataFromServer()
                //console.log(res.data.results.orderId)
                await holdOrderClick(res.data.results.orderId, true, true)
                setMoveTableDetails(() => {
                    return {
                        tableId1: 0,
                        tableId2: 0,
                    }
                })
                await getTables()
                setHeaderChange(true)
                setLoading(false)
            } else {
                toast.error(res.data.results.message)
                setLoading(false)
            }
        } catch (error) {
            toast.error(error.message)
            setLoading(false)
        }
    }
    const clickYesButtonOnMoveKot = async () => {
        try {
            setLoading(true)
            moveKotDetails.orderId = orderId
            const res = await axios.post(`${config.API_URL}/moveKot`, moveKotDetails, { withCredentials: true })
            console.log(res, "from move kot --->")
            if (res.data.code === 200) {
                // setHeaderChange(true)
                toast.success(res.data.results.message)
                setMoveKotConfirmPopUp(false)
                setKotwiseDropDown(0)
                // await fetchAllDataFromServer()
                setCart(defaultCart)
                //console.log(res.data.results.orderId)
                await fetchAllDataFromServer()
                await getTables()
                await holdOrderClick(res.data.results.orderId, true, true)
                setHeaderChange(true)
                setMoveKotDetails(() => {
                    return {
                        tableId1: 0,
                        tableId2: 0,
                        kotNumber: 0
                    }
                })
                setLoading(false)
            } else {
                toast.error(res.data.results.message)
                setLoading(false)
            }
        } catch (error) {
            console.log(error)
            toast.error(error.message)
            setLoading(false)
        }
        // try {
        //     setLoading(true)
        //     moveKotDetails.orderId = orderId
        //     const res = await moveKotIdb(moveKotDetails, cart)
        //     if (res.status === 200) {
        //         setHeaderChange(true)
        //         toast.success(res.message)
        //         setMoveKotConfirmPopUp(false)
        //         setKotwiseDropDown(0)
        //         //console.log(res.data.results.orderId)
        //         getAdminCart()
        //         holdOrderClick(res.orderId, true)
        //         setMoveKotDetails(() => {
        //             return {
        //                 tableId1: 0,
        //                 tableId2: 0,
        //                 kotNumber: 0
        //             }
        //         })
        //         setLoading(false)

        //     } else {
        //         toast.error(res.message)
        //         setLoading(false)
        //         getAdminCart()
        //     }
        // } catch (error) {
        //     toast.error(error.message)
        //     setLoading(false)
        // }

    }

    const closeMovekotConfirmPopup = () => {
        setMoveKotPopup(false)
        setMoveKotConfirmPopUp(false)
        setMoveKotDetails(() => {
            return {
                tableId1: 0,
                tableId2: 0,
                kotNumber: 0
            }
        })
    }
    const addPaymentMode = (e) => {

        // const availableMode = paymentModeSelect.find(el => {
        //     if (el.name === name) {
        //         return el
        //     }
        // })


        // if (availableMode) {

        //     setSettlePopupData((pre) => {
        //         return { ...pre, [name]: 0 }
        //     })
        //     const filterMode = paymentModeSelect.filter(el => el.name !== name)
        //     setPaymentModeSelect(pre => {
        //         return [...filterMode]
        //     })
        // }
        // else {

        //     if (!paymentModeSelect.length) {
        //         const object = { name, amount }

        //         setSettlePopupData((pre) => {
        //             return { ...pre, [name]: amount }
        //         })
        //         setPaymentModeSelect(pre => {
        //             return [object]
        //         })

        //     } else {
        //         const object = { name, amount: 0 }
        //         paymentModeSelect.push(object)
        //         setPaymentModeSelect(() => {
        //             return [...paymentModeSelect]
        //         })
        //     }
        // }
        const { name, value } = e.target
        setSettlePopupData((pre) => {
            return { ...pre, [name]: value }
        })
    }
    const addItems = (id) => {
        {
            setEditOrder(true)
            setTableSelect(true)
            setSettleBillPopup(false)
            setAddItem(true)
            editPlacedOrder(id)
        }
    }
    const splitClikc = () => {
        if (splitActive) {
            console.log("Off SPlit")
            setActiveSplit(false)
        } else {
            console.log("Onn SPlit")
            setActiveSplit(true)
        }
    }
    //! discount //

    const applyDiscount = () => {
        if (discountform.discount === "Percentage") {
            console.log(cart.totalBill * discountform.amount, "totalBill==================>")
            const discount = (cart.totalBill * discountform.amount) / 100
            if (discount > cart.totalBill) {
                return toast.error("Discount Must Be Less or Equal To Total Amount")
            }
            const myAmount = (cart.totalBill - discount).toFixed(2)
            let gst = 0
            if (!hotel.invoiceFormateIncGst) {
                gst = 0
            }
            else {
                const { totalExcGstAmount, totalBill } = getAllCalacululatedData(cart.items)
                const gstCalculateAfterDiscount = ((totalBill - totalExcGstAmount) * discount) / totalBill
                gst = ((((totalBill - totalExcGstAmount) - gstCalculateAfterDiscount) * 5) / 100).toFixed(2)
                console.log(totalExcGstAmount, "totalExcGstAmount", discount, "Discount", "myAmount", gstCalculateAfterDiscount, "gstCalculateAfterDiscount", gst, "gst")
            }
            const grandAmount = Math.round(+myAmount + +gst)
            console.log(grandAmount, "grand Amount=============>")

            if (orderType === 'pickup' || editOrder) {
                setFormValue((pre) => {
                    return { ...pre, cash: grandAmount, card: 0, upi: 0 }
                })
            }
            setCart((pre) => {
                return { ...pre, totalBill: cart.totalBill, totalDiscount: +discount, myAmount, gst, grandAmount }
            })

            closeDiscountPopup()
            setDiscountform(defaultDiscountform)
        } else {
            if (discountform.amount > +cart.totalBill) {
                return toast.error("Discount Must be Less Than Total Amount")
            }
            const myAmount = (+cart.totalBill - +discountform.amount).toFixed(2)
            let gst = 0
            if (!hotel.invoiceFormateIncGst) {
                gst = 0
            } else {
                const { totalExcGstAmount, totalBill } = getAllCalacululatedData(cart.items)
                const gstCalculateAfterDiscount = ((totalBill - totalExcGstAmount) * discountform.amount) / totalBill
                gst = ((((totalBill - totalExcGstAmount) - gstCalculateAfterDiscount) * 5) / 100).toFixed(2)
                console.log(totalExcGstAmount, "totalExcGstAmount", totalBill, discountform.amount, "Discount", "myAmount", gstCalculateAfterDiscount, "gstCalculateAfterDiscount", gst, "gst")

            }
            const grandAmount = Math.round(+myAmount + +gst)
            console.log(grandAmount, "grand Amount=============>")
            if (orderType === 'pickup' || editOrder) {
                setFormValue((pre) => {
                    return { ...pre, cash: grandAmount, card: 0, upi: 0 }
                })
            }
            setCart((pre) => {
                return { ...pre, totalBill: cart.totalBill, totalDiscount: +discountform.amount, myAmount, gst, grandAmount }
            })

            closeDiscountPopup()
            setDiscountform(defaultDiscountform)
        }
    }

    const handleChangeDiscount = (e) => {
        const { name, value } = e.target
        setDiscountform((pre) => {
            return { ...pre, [name]: value }
        })
    }
    const openDiscountPopup = () => {
        setDiscountPopup(true)
    }
    const closeDiscountPopup = () => {
        setTimeout(() => {
            setDiscountPopup(false)
        }, 200)

    }
    const changeHandleCustomerPaid = (event) => {
        const value = event.target.value;
        // //console.log(value)
        // setCustomerPaid(() => {
        //     if (value >= 0) {
        //         const findZero = value.split('')
        //         const filterData = findZero.map((el, index) => {
        //             if (index !== 0) {
        //                 if (el !== 0) {
        //                     return el
        //                 }

        //             }
        //         }).join('')

        //         return filterData
        //     } else {
        //         return 0
        //     }
        // });
        setCustomerPaid(value)
    };
    const getRestaurantData = async () => {
        const res = await getAllFromDB("hms_restaurant_mst")
        return res[0]
    }
    const backToBiller = () => {
        setAddItem(false)
        setOrderType('')
        setTableSelect(false)
        setFormValue(defaultform)
        setCart(defaultCart)
        setEditOrder(false)
        setOrderId(0)
        getTableCatagoriesWiseOrder()
    }
    const sideBarActiveOrderType = (orderType) => {
        setActiveSideBArOrderType(orderType)
        if (orderType == 'pickup') {
            setShowSideBarOrder(pickupOrder)
        }
        if (orderType == 'dinin') {
            console.log(dinInOrder, "dinin Orders===============>")
            setShowSideBarOrder(dinInOrder)
        }
        if (orderType == 'delivery') {
            setShowSideBarOrder(onlineOrders)
        }
    }
    const sideBarOrderClick = (id) => {

        setOrderType(activeSideBarOrderType)
        setOrderId(id)
        setTableSelect(true)
        holdOrderClick(id, true)
    }

    const socketRef = useRef(null);
    const location = useLocation()
    const state = location.state

    useEffect(() => {
        rightsidebarMenuHeight()
        window.onresize = function () {
            rightsidebarMenuHeight()
        }
        setCart(defaultCart)
        setFormValue(defaultCart)
        getMenuDataFromIdb()
        getMenuCategoriesFromIdb()
    }, []);


    useEffect(() => {
        console.log(updatedData, newOrderClick, "updated data value --------> ")

        if (updatedData) {
            setLoading(true)
            fetchAllDataFromServer().then(async (res) => {
                setHeaderChange(true)
                await getTables()
                setLoading(false)
                setUpdateData(false)
                setEditOrder(false)

            }).catch(error => {
                toast.error(error.message)
            })
        } else {
            console.log("in Else Block")
            getTables()
        }

    }, [updatedData])

    useEffect(() => {
        getRestaurantData().then(res => {
            if (res) {
                setHotel(res)
                console.log(res)
                setDisplay(res.display)
            } else {
                console.log('something Wrong ')
            }
        })

    }, [])
    useEffect(() => {
        console.log(state, "State ----------->")
        if (state?.newOrder) {
            setEditOrder(false)
            setCart(defaultCart)
            setTableSelect(false)
            setFormValue(defaultform)
            setOrderId(0)
            setOrderType('')
        } else {
            if (state?.data) {
                const { formValue, orderId, orderType, edit, totalDiscount, cart = {} } = state?.data
                console.log(formValue, totalDiscount, "formValue-----form edit ")

                if (edit) {

                    getAllFromDB('hms_restaurant_mst').then(async (res) => {
                        if (res) {
                            setCart((pre) => {
                                return { ...pre, totalDiscount }
                            })
                            rightsidebarMenuHeight()
                            editPlacedOrder(orderId, res[0])
                            setTableSelect(true)
                            setEditOrder(true)
                            setOrderId(orderId)
                            setFormValue(() => {
                                return { ...formValue }
                            })

                        } else {
                            console.log('something Wrong ')
                        }
                    }).catch(err => {
                        console.log(err, "from catch block in Biller")
                    })
                } else {
                    setEditOrder(false)
                    console.log('here comming useeeffect ========> ----------->')
                    // axios.get(`${config.API_URL}/singleHotel`, { withCredentials: true }).then(res => {
                    getAllFromDB('hms_restaurant_mst').then(async (res) => {
                        setTableSelect(true)
                        // })
                        const result = res[0]
                        if (result) {
                            console.log(result, "hotel Data=====>")
                            const { totalBill, myAmount, totalDiscount, totalExcGstAmount, grandAmount, gst, totalQty, totalItems, } = await getAllCalacululatedData(cart.items, result)
                            if (orderType === 'pickup') {
                                setFormValue((pre) => {
                                    return { ...pre, cash: grandAmount }
                                })
                            }
                            console.log(totalBill, myAmount, totalDiscount, totalExcGstAmount, grandAmount, gst, "here for o=not edit ============<")
                            setCart((pre) => {
                                return { totalQty, totalItems, items: cart.items, totalBill, totalExcGstAmount, totalDiscount, gst, grandAmount, myAmount }
                            })
                            console.log(cart, "Cart insie the log-0000000000000000000000")
                            rightsidebarMenuHeight()
                            setCart(cart)
                            setOrderId(orderId)
                            setTableSelect(true)
                            setFormValue(formValue)
                            setOrderType(orderType)
                            setActiveOrdertype(orderType)
                        } else {
                            console.log('something Wrong ')
                        }
                    }).catch(err => {
                        console.log(err, "from catch block in Biller")
                    })


                    // const hiddenBox = orderType === "pickup" ? "hiddenBox2" : "hiddenBox1"
                    // handleBoxClick(hiddenBox)
                }

                // window.location.reload("/")
            }
        }
    }, [state])


    useEffect(() => {

        getUserAccessData().then(res => {

            console.log(res, "user Access=======================>")
            // axios.get(`${config.API_URL}/getUserAccess`, { withCredentials: true }).then((res) => {
            if (res) {
                setAccess(() => {
                    return [...res.hms_user_accesses]
                })
                const accessVerify = res.hms_user_accesses.find(el => el.access_name === "Biller")
                if (accessVerify && accessVerify.read) {
                } else {
                    setNotAuthorized(true)
                }
            }
            else {

            }
        })
        getAllFromDB('hms_onlineOrders_mst').then(res => {
            if (res) {
                const filterOnlinedata = res.filter(el => el.status === "NEW" || el.status === "PREPARING")
                console.log("here come to updated the zomoto Order-->")
                setOnlineOrders((pre) => {
                    return [...filterOnlinedata]
                })
            }
        })
        // })

    }, [])
    useEffect(() => {
        console.log(newOrderClick, "New Order Click------------------>")
        if (newOrderClick) {
            setAddItem(false)
            setCart(defaultCart)
            setTableSelect(false)
            setFormValue(defaultform)
            setOrderId(0)
            setOrderType('')
            setNewOrderClick(false)
        }

    }, [newOrderClick])


    useEffect(() => {
        getAllFromDB('hms_onlineOrders_mst').then(res => {
            if (res) {
                const filterOnlinedata = res.filter(el => el.status === "NEW" || el.status === "PREPARING")
                console.log("here come to updated the zomoto Order-->")
                setOnlineOrders((pre) => {
                    return [...filterOnlinedata]
                })

            }
        })

    }, [onlineOrderDetails])

    const getLiveDate = (time) => {

        const interval = setInterval(() => {

        }, 1000)

    }
    const onlineOrderKotPrint = async (id) => {
        try {

            setOnlineOrderDetails(() => {
                return { new: false, acceptOrReject: true }
            })
            setPrintLoader(true)
            const res = await axios.post(`${config.API_URL}/generateZomatoKot`, { id }, { withCredentials: true })
            if (res.data.code === 200) {
                const { pdf, printer } = res.data.results
                function jspmWSStatus(status) {
                    // // //console.log(status, "JSPrinterManager status================================================>")
                    if (status === WSStatus.Open)
                        return true;
                    else if (status === WSStatus.Closed) {
                        alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                        return false;
                    }
                    else if (status === WSStatus.Blocked) {
                        alert('JSPM has blocked this website!');
                        return false;
                    }
                }

                async function print(printerName, noCopy, pdf) {
                    try {
                        const base64String = Buffer.from(pdf).toString('base64');
                        var clientPrinters = null;
                        JSPrintManager.auto_reconnect = true;
                        const timestamp = Date.now();
                        JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                        await JSPrintManager.start();
                        JSPrintManager.WS.onStatusChanged = function () {
                            if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                //get client installed printers
                                JSPrintManager.getPrintersInfo().then(function (printersList) {
                                    clientPrinters = printersList;
                                });
                            }
                        };
                        const result = jspmWSStatus(JSPrintManager.websocket_status)
                        if (result) {
                            var cpj = new ClientPrintJob();
                            var myPrinter = new InstalledPrinter(printerName);
                            cpj.clientPrinter = myPrinter;
                            var my_file = new PrintFilePDF(base64String, FileSourceType.Base64, 'MyFile.pdf', noCopy);
                            cpj.files.push(my_file)
                            await cpj.sendToClient();
                            return true
                        } else {
                            console.log(result, "result from websocket status")
                        }
                    } catch (error) {
                        toast.error(error, "error from catch block in print function==========>")
                        return false
                    }
                }
                // ! kamnu chhe 

                setOpenOnlineOrderPopup({ status: false, id: 0 })
                const resSatus = await axios.post(`${config.API_URL}/order/status`, { id, status: "accept" }, { withCredentials: true })
                console.log(resSatus, "res-------------->")

                if (resSatus.data.code === 200) {
                    await updateInDB('hms_onlineOrders_mst', resSatus?.data?.results?.updatedOrder)
                    getAllFromDB('hms_onlineOrders_mst').then(res => {
                        if (res) {
                            const filterOnlinedata = res.filter(el => el.status === "NEW" || el.status === "PREPARING")
                            console.log("here come to updated the zomoto Order-->")
                            if (activeSideBarOrderType === 'delivery') {
                                setShowSideBarOrder((pre) => {
                                    return [...filterOnlinedata]
                                })
                            }
                            setOnlineOrders((pre) => {
                                return [...filterOnlinedata]
                            })
                            setPrintLoader(false)
                        }
                    })
                    toast.success(resSatus?.data?.results?.message)

                } else {
                    toast.error(resSatus.data.results.message)
                }

                print(printer.printer_name, printer.number_of_copies, pdf.data).then(async (resr) => {
                    if (resr) {

                    } else {
                        // setLoading(false)
                        setPrintLoader(false)
                        toast.error("return print function false")
                    }

                }).catch(err => {
                    setPrintLoader(false)

                    toast.error("error while printing Kot", err)
                })
            } else {
                setPrintLoader(false)
                toast.error(res.data.results.message)
            }
        } catch (error) {
            setPrintLoader(false)
            console.log(error)
            toast.error("Somthing Wrong While Printing Kot")
        }
    }
    const onlineOrderPrint = async (id) => {
        try {
            setOnlineOrderDetails(() => {
                return { new: false, acceptOrReject: true }
            })
            setPrintLoader(true)
            const res = await axios.post(`${config.API_URL}/generateZomatoBill`, { id }, { withCredentials: true })
            if (res.data.code === 200) {
                const { pdf, printer } = res.data.results
                function jspmWSStatus(status) {
                    // // //console.log(status, "JSPrinterManager status================================================>")
                    if (status === WSStatus.Open)
                        return true;
                    else if (status === WSStatus.Closed) {
                        alert('JSPrintManager (JSPM) is not installed or not running! Download JSPM Client App from https://neodynamic.com/downloads/jspm');
                        return false;
                    }
                    else if (status === WSStatus.Blocked) {
                        alert('JSPM has blocked this website!');
                        return false;
                    }
                }

                async function print(printerName, noCopy, pdf) {
                    try {
                        const base64String = Buffer.from(pdf).toString('base64');
                        var clientPrinters = null;
                        JSPrintManager.auto_reconnect = true;
                        const timestamp = Date.now();
                        JSPrintManager.license_url = "https://www.neodynamic.com/licenses/jspm/v6/itlion";
                        await JSPrintManager.start();
                        JSPrintManager.WS.onStatusChanged = function () {
                            if (jspmWSStatus(JSPrintManager.websocket_status)) {
                                //get client installed printers
                                JSPrintManager.getPrintersInfo().then(function (printersList) {
                                    clientPrinters = printersList;
                                });
                            }
                        };
                        const result = jspmWSStatus(JSPrintManager.websocket_status)
                        if (result) {
                            var cpj = new ClientPrintJob();
                            var myPrinter = new InstalledPrinter(printerName);
                            cpj.clientPrinter = myPrinter;
                            var my_file = new PrintFilePDF(base64String, FileSourceType.Base64, 'MyFile.pdf', noCopy);
                            cpj.files.push(my_file)
                            await cpj.sendToClient();
                            return true
                        } else {
                            console.log(result, "result from websocket status")
                        }
                    } catch (error) {
                        toast.error(error, "error from catch block in print function==========>")
                        return false
                    }
                }
                // ! kamnu chhe 

                setOpenOnlineOrderPopup({ status: false, id: 0 })
                const resSatus = await axios.post(`${config.API_URL}/order/status`, { id, status: "accept" }, { withCredentials: true })
                console.log(resSatus, "res-------------->")
                if (resSatus.data.code === 200) {
                    await updateInDB('hms_onlineOrders_mst', resSatus?.data?.results?.updatedOrder)
                    getAllFromDB('hms_onlineOrders_mst').then(res => {
                        if (res) {
                            const filterOnlinedata = res.filter(el => el.status === "NEW" || el.status === "PREPARING")
                            console.log("here come to updated the zomoto Order-->")
                            if (activeSideBarOrderType === 'delivery') {
                                setShowSideBarOrder((pre) => {
                                    return [...filterOnlinedata]
                                })
                            }
                            setOnlineOrders((pre) => {
                                return [...filterOnlinedata]
                            })
                            setPrintLoader(false)
                        }
                    })
                    toast.success(resSatus?.data?.results?.message)

                } else {
                    toast.error(resSatus.data.results.message)
                }

                print(printer.printer_name, printer.number_of_copies, pdf.data).then(async (resr) => {
                    if (resr) {

                    } else {
                        // setLoading(false)
                        setPrintLoader(false)
                        toast.error("return print function false")
                    }

                }).catch(err => {
                    setPrintLoader(false)

                    toast.error("error while printing Kot", err)
                })
            } else {
                setPrintLoader(false)
                toast.error(res.data.results.message)
            }
        } catch (error) {
            setPrintLoader(false)
            toast.error("Somthing Wrong While Printing Bill")
        }
    }
    const getAllCalacululatedDataForChange = (filterData) => {
        let myAmount = 0
        let grandAmount = 0
        let totalBill = 0
        let totalDiscount = +cart.totalDiscount
        let gst = 0
        let totalExcGstAmount = 0
        let totalQty = 0
        let totalItems = 0
        console.log(filterData, "before updated=============>")
        for (const cur of filterData) {
            console.log(cur, "before updatedMenu items=============>")

            for (const items of cur.menuItems) {
                totalBill += +items.qty * (+items.price).toFixed(2)
                console.log(totalBill, +items.qty, (+items.price).toFixed(2), 'totalBill qty price=============>')
                if (items.gst_type === 'G') {
                    totalExcGstAmount += +items.qty * (+items.price).toFixed(2)
                }
                totalQty += items.qty
                totalItems += 1
            }
        }
        const calculatedGst = +totalBill - +cart.totalDiscount - +totalExcGstAmount

        if (!hotel.invoiceFormateIncGst) {
            gst = 0
        } else {
            gst = (calculatedGst * 5) / 100
        }
        myAmount = +totalBill - +totalDiscount
        grandAmount = Math.round(+myAmount + +gst)

        return { totalItems, totalQty, grandAmount, myAmount: +myAmount.toFixed(2), totalBill: +totalBill.toFixed(2), totalDiscount, gst: +gst.toFixed(2), totalExcGstAmount: +totalExcGstAmount.toFixed(2) }
    }
    const priceEditPopupFunction = (e, id) => {


        e.preventDefault()
        if (newPrice < 0) {
            toast.error("Price Must 0 Or Greater Than 0")
            return;
        }
        const filterData = cart?.items?.map(el => {
            if (el.status === 'H') {
                const modifieldItems = el?.menuItems?.map(el => {
                    if (el.id === id) {
                        el.price = +newPrice
                        el.totalAmount = el.qty * el.price
                        return el
                    }
                    return el
                })
                el.menuItems = modifieldItems
                return el
            }
            return el

        })
        console.log(filterData, "Updated----------------Price data")
        const { totalBill, myAmount, gst, grandAmount, totalExcGstAmount, totalDiscount, totalItems, totalQty } = getAllCalacululatedDataForChange(filterData)

        console.log(totalBill, myAmount, gst, grandAmount, totalExcGstAmount, totalDiscount, totalItems, totalQty, "Updated----------------Price data")
        setCart(pre => {
            return { ...pre, totalItems, totalQty, items: filterData, totalBill, myAmount, gst, grandAmount, totalExcGstAmount, totalDiscount }
        })
        setNewPrice(0)
        setOpenPriceEditPopUp({ id: 0, name: 0, price: 0, open: false })

    }
    const handleChangeUpdatePrice = (e) => {
        const { value, name } = e.target
        setNewPrice(value)
    }

    return (
        <>

            {discountPopup && (

                <div id="openDescountPopup" className="popup">
                    <div id='discountPopup' className="popup-content show">
                        <span className="close" onClick={() => closeDiscountPopup()}
                            id="closePopup">×</span>
                        <div className="popup-details">
                            <p className="popup-title">
                                Discount
                            </p>

                            <div className="descountdata">
                                <select name="discount" onChange={(e) => handleChangeDiscount(e)}>
                                    <option value="fix">Fix</option>
                                    <option value="Percentage">Percentage</option>
                                </select>
                                <input type="text" name='amount' onChange={(e) => handleChangeDiscount(e)} placeholder="Amount" />
                            </div>



                            <div className="popup-buttons">
                                <button
                                    id="cancelButton2" onClick={() => closeDiscountPopup()}>CANCEL</button>
                                <button
                                    className="popup-save-btn" onClick={() => applyDiscount()}>Apply</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {openPriceEditPopUp.open && (
                <div id="addnewitemspopup" className="">
                    <div className="addnewitemspopup-content">

                        <span className="close"
                            id="addnewclosePopup" onClick={() => setOpenPriceEditPopUp({ id: 0, price: 0, name: '', open: false })}>&times;</span>
                        <div className="addnewitemspopup-details">
                            <p className="addnewitems-popup-title">{openPriceEditPopUp.name}</p>

                            <form onSubmit={(e) => priceEditPopupFunction(e, openPriceEditPopUp.id)}>
                                <div className="andd-new-items-input item-price-change">
                                    <p>Plase provide rate for single quantity. [Achual base amount is {openPriceEditPopUp.price}]</p>
                                    <label for="">Price<span>*</span></label>
                                    <input type="number" id=""
                                        name="" placeholder="0" onChange={handleChangeUpdatePrice}
                                        required />

                                    <label for="">Reason <span>*</span></label>
                                    <input type="text" id=""
                                        name="" placeholder=""
                                        required />
                                </div>
                                <div
                                    className="addnew-items-popup-buttons design-two">
                                    <button
                                        id="addnewItemsCancelButton" onClick={() => setOpenPriceEditPopUp({ id: 0, price: 0, name: '', open: false })}>CANCEL</button>
                                    <button type="submit"
                                        name="submit"
                                        value="submit">Save</button>
                                </div>
                            </form>

                        </div>
                    </div>
                </div>

            )
            }
            {openOnlineOrderPopup.status && (
                <div id="popup" className="popup" >
                    <div id='settlePopup' className={`popup-content show `}>
                        <span className="close" id="closePopup" onClick={() => setOpenOnlineOrderPopup(false)}>×</span>
                        <div className="popup-details">
                            <p className="popup-title">
                                Zomato
                            </p>

                            <div className="popup-buttons">
                                <button className="kot" onClick={() => onlineOrderKotPrint(openOnlineOrderPopup.id,)}>Kot & Print</button>
                                <button className="popup-save-btn" onClick={() => onlineOrderPrint(openOnlineOrderPopup.id,)}>Save & Print</button>
                                <button className="popup-save-btn" onClick={() => orderStatusChange(openOnlineOrderPopup.id, 'AcceptS')}>Accept & Save</button>
                            </div>
                        </div>

                    </div>
                </div>
            )}
            {
                settleBillPopup && (
                    <div id="popup" className="popup" >
                        <div id='settlePopup' className={`popup-content show `}>
                            <span className="close" id="closePopup" onClick={() => closeSettlePopup()}>×</span>
                            <div className="popup-details">
                                <p className="popup-title">
                                    Settle Bill <strong className='settle-bill-table-no'>{settlePopupData.table_no} </strong>
                                </p>


                                <div className="settle-order-head">
                                    <div>
                                        <p>Order No: {settlePopupData.bill_no}</p>
                                    </div>
                                    <div>
                                        <div className="order-bill-time_date">
                                            <p><i className="fa fa-calendar-o"
                                                aria-hidden="true"></i>{moment(settlePopupData.time).format("DD/MM/YYYY hh:mm a")}</p>
                                        </div>
                                    </div>

                                </div>
                                <div className='settle-order-head popup-buttons'>
                                    <p > Payable Amount :  <span className='payable-amount' style={{ color: '#c5202b' }}>₹{settlePopupData.amount}</span> </p>
                                    <button className='popup-save-btn' onClick={() => addItems(settlePopupData.id)}>Add Item</button>
                                </div>
                                <div className='settle-order-head popup-buttons'>
                                    <p> PAYMENT MODE </p>
                                    <button className='popup-save-btn' onClick={() => splitClikc()}>Split Bill</button>
                                </div>
                                <div className="bill-clc-payments">

                                    <div className="bill-payment-settle">

                                        {/* <PaymentMode splitActive={splitActive} display="key" cart={cart} formValue={formValue} handlechange={handlechange} /> */}

                                        {splitActive ? (
                                            <>
                                                <div className="payment-option popup-payment">
                                                    <label className="split-payment">
                                                        <span>CASH</span>
                                                        <input name="cash" value={settlePopupData.cash} onChange={addPaymentMode} type="number" min={0} />

                                                    </label>
                                                    <label className="split-payment">
                                                        <span>CARD</span>
                                                        <input name="card" value={settlePopupData.card} onChange={addPaymentMode} type="number" min={0} />
                                                    </label>
                                                    <label className="split-payment">
                                                        <span>UPI</span>
                                                        <input name="upi" value={settlePopupData.upi} onChange={addPaymentMode} type="number" min={0} />
                                                    </label>
                                                    <label className="split-payment">
                                                        <span>DUE</span>
                                                        <input name="due" value={settlePopupData.due} onChange={addPaymentMode} type="number" min={0} />

                                                    </label>

                                                </div>

                                            </>

                                        ) :
                                            <div className="payment-option popup-payment">
                                                <label className="radio">
                                                    <input name="radio" value="cash" onChange={(e) => handlePaymentModeChange(e, settlePopupData.amount)} type="radio" checked={settlePopupData.cash === settlePopupData.amount} />
                                                    <span>CASH</span>
                                                </label>
                                                <label className="radio">
                                                    <input name="radio" value="card" onChange={(e) => handlePaymentModeChange(e, settlePopupData.amount)} type="radio" checked={settlePopupData.card === settlePopupData.amount} />
                                                    <span>CARD</span>
                                                </label>
                                                <label className="radio">
                                                    <input name="radio" value="upi" onChange={(e) => handlePaymentModeChange(e, settlePopupData.amount)} type="radio" checked={settlePopupData.upi === settlePopupData.amount} />
                                                    <span>UPI</span>
                                                </label>
                                                <label className="radio">
                                                    <input name="radio" value="due" onChange={(e) => handlePaymentModeChange(e, settlePopupData.amount)} type="radio" checked={settlePopupData.due === settlePopupData.amount} />
                                                    <span>DUE</span>
                                                </label>
                                            </div>
                                        }
                                        {settlePopupData.due ? (
                                            <label className='due-mobile'>
                                                <span>Mobile No.:</span>
                                                <input
                                                    type="number"
                                                    value={settlePopupData.mobile}
                                                    name="mobile"
                                                    onChange={handlePaymentModeChange}
                                                    min="0"  // minimum allowed number
                                                    max="9999999999"  // maximum allowed number
                                                    pattern="[0-9]*"  // pattern to allow only numeric input
                                                />
                                            </label>
                                        ) : <></>}

                                    </div>
                                    <div className="bill-clc">
                                        {paymentModeSelect.map(el => (
                                            <div className="settle-bill-input mt-50" id="upi-field">
                                                <p>{el.name}</p> <input type="number" name={el.name} id="upi-id" value={settlePopupData[el.name]} onChange={handlePaymentModeChange} />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="settle-total-bill">
                                    <div className='paid-customer-input'>
                                        <label>Customer Paid : </label>
                                        <input type="number" name="customerPaid" id="" value={customerPaid} onChange={changeHandleCustomerPaid} />
                                    </div>
                                    <div>
                                        <p> Return to Customer : <span> {customerPaid ? ((+customerPaid < settlePopupData.amount) ? 'Less Amt' : +customerPaid - settlePopupData.amount) : 0}</span> </p>
                                    </div>
                                </div>
                                <div className="settle-total-bill">

                                    <p>Recevied Amount</p>
                                    <span>₹ {+settlePopupData.upi + +settlePopupData.cash + +settlePopupData.card + +settlePopupData.due}</span>
                                </div>

                                <div className="popup-buttons">
                                    <button id="cancelButton" onClick={() => closeSettlePopup()}>CANCEL</button>
                                    <button className="popup-save-btn" onClick={() => settleBills()}>Settle</button>
                                </div>
                            </div>

                        </div>
                    </div>
                )
            }
            {removeKotPopUp && (
                <div className="popup">
                    <div className="deleteitemspopup-content">
                        <div className="deleteitemspopup-details">
                            <img src={redBin} alt="true" />
                            <p> Are you sure you want to delete kot </p>
                            <div
                                className="deleteall-items-popup-buttons">
                                <button
                                    id="deleteItemsCancelButton" onClick={() => setRemoveKotPopUp(false)} >CANCEL</button>
                                <button
                                    className="deleteallitems-btn" onClick={() => clickYesButtonOnDelete()} >Yes</button>
                            </div>
                        </div>

                    </div>
                </div>
            )}
            {
                loading ?
                    <div id="overlay" style={{ display: 'block', zIndex: "99" }}>
                        <Loading />
                    </div> : <></>
            }
            {
                printLoader ?
                    <div id="overlay" style={{ backgroundColor: '#00000050', display: 'block', zIndex: "99" }}>
                        <PrintingLoader />
                    </div> : <></>
            }
            {notAuthorized ? (
                <div className="disable-screen">
                    <h3> User Not Authenticated </h3>
                </div>
            ) : (
                <div className="items-right-section">
                    <div className="keybord-order-view">

                        {(tableSelect && display === 'T') ? (
                            <> </>
                        ) : (

                            <div className="all-order-live-data">
                                <h4>Running Order Details</h4>
                                <div className="orders-data-btns">
                                    <button className={activeSideBarOrderType == 'dinin' ? 'orders-data-btns-active' : ''} onClick={() => sideBarActiveOrderType('dinin')}>Dine In</button>
                                    <button className={activeSideBarOrderType == 'pickup' ? 'orders-data-btns-active' : ''} onClick={() => sideBarActiveOrderType('pickup')}>Pick Up</button>
                                    <button className={activeSideBarOrderType == 'delivery' ? 'orders-data-btns-active' : ''} onClick={() => sideBarActiveOrderType('delivery')}>Delivery</button>
                                </div>
                                <div className="all-order-live-data-table">
                                    <table cellSpacing="0" cellPadding="0">
                                        <thead>
                                            <tr>
                                                {/* <th>Order No.</th> */}
                                                {activeSideBarOrderType == 'dinin' && (
                                                    <th>Table No.</th>
                                                )}
                                                <th>Total Amount</th>
                                                {activeSideBarOrderType === 'delivery' && (
                                                    <th>From</th>
                                                )}
                                                {activeSideBarOrderType === 'delivery' ? (
                                                    <th>Action</th>
                                                ) : (

                                                    <th> Time </th>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {showSideBarOrder.map(order => (
                                                < tr className={order.status === 'in-progress' ? `kot-orders-on-hover` : "hold-orders-on-hover"} onClick={() => activeSideBarOrderType !== 'delivery' ? sideBarOrderClick(order.id) : ""}>

                                                    {activeSideBarOrderType == 'dinin' && (
                                                        <td>{`${order?.hms_table_mst?.table_name} - ${order?.hms_table_mst?.hms_table_categ?.table_catag_nm}`}</td>
                                                    )}

                                                    <td>₹{order?.grandAmount}</td>
                                                    {activeSideBarOrderType == 'delivery' && (
                                                        <td><img className='online_order_mg' src={zomoto} alt="Zomoto logo" srcset="" /> </td>
                                                    )}
                                                    {activeSideBarOrderType == 'delivery' ? (
                                                        order.status === "NEW" ? (
                                                            <td className='acp-rjc-btn'><button className='accept-btn-delivery' onClick={() => orderStatusChange(order.id, "accept")}> Accept </button> <button onClick={() => orderStatusChange(order.id, "reject")} className='reject-btn-delivery'> Reject </button></td>
                                                        ) : (
                                                            <td><button className='ready-btn-delivery' onClick={() => orderStatusChange(order.id, "ready")}> Food Is ready </button> </td>
                                                        )
                                                    ) : (

                                                        <td>{
                                                            order.createdAt ? (() => {
                                                                const createdAt = new Date(order.createdAt);
                                                                const now = new Date();
                                                                const diffInSeconds = Math.floor((now - createdAt) / 1000);
                                                                const minutes = Math.floor(diffInSeconds / 60);
                                                                return <span>{`${minutes} Min `} </span>
                                                            })()
                                                                : ''
                                                        }</td>
                                                    )}

                                                </tr>
                                            ))}

                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {tableSelect ? (
                            display === 'K' ? (
                                <>
                                    <KeyBoardDisplay openDiscountPopup={openDiscountPopup} splitClikc={splitClikc} splitActive={splitActive} dueAmount={dueAmount} setOpenPriceEditPopUp={setOpenPriceEditPopUp} addItem={addItem} access={access} decriesKotDeliveryqty={decriesKotDeliveryqty} emptyValue={emptyValue} removeDeliveredItemFromCart={removeDeliveredItemFromCart} rePrintKot={rePrintKot} kotwiseDropDown={kotwiseDropDown} moveTableConfirmPopUp={moveTableConfirmPopUp} showTablesOnMoveTable={showTablesOnMoveTable} moveTablePopUp={moveTablePopUp} moveKotConfirmPopUp={moveKotConfirmPopUp} showTablesOnMove={showTablesOnMove} moveKotPopUp={moveKotPopUp} moveKot={moveKot} kotWiseDropDownClick={kotWiseDropDownClick} closeMoveKotPopup={closeMoveKotPopup} moveKotClick={moveKotClick} moveTable={moveTable} moveTableClick={moveTableClick} closeMoveTablePopup={closeMoveTablePopup} closeMoveTableConfirmPopup={closeMoveTableConfirmPopup} clickYesButtonOnMoveTable={clickYesButtonOnMoveTable} clickYesButtonOnMoveKot={clickYesButtonOnMoveKot} closeMovekotConfirmPopup={closeMovekotConfirmPopup} updateInvoice={updateInvoice} editOrder={editOrder} removeKot={removeKot} setFormValue={setFormValue} getAdminCart={getAdminCart} setHeaderChange={setHeaderChange} holdOrderClick={holdOrderClick} product={product} tables={tables} setLoading={setLoading} backToBiller={backToBiller} loading={loading} orderPlace={orderPlace} orderKot={orderKot} setOrderType={setOrderType} orderId={orderId} setOrderId={setOrderId} orderHold={orderHold} hotel={hotel} handlechange={handlechange} formValue={formValue} orderType={orderType} cart={cart} setCart={setCart} />
                                </>
                            ) : (
                                <>
                                    <TouchDisplay openDiscountPopup={openDiscountPopup} splitClikc={splitClikc} splitActive={splitActive} dueAmount={dueAmount} setOpenPriceEditPopUp={setOpenPriceEditPopUp} handleChangeUpdatePrice={handleChangeUpdatePrice} addItem={addItem} access={access} decriesKotDeliveryqty={decriesKotDeliveryqty} emptyValue={emptyValue} removeDeliveredItemFromCart={removeDeliveredItemFromCart} rePrintKot={rePrintKot} kotwiseDropDown={kotwiseDropDown} moveTableConfirmPopUp={moveTableConfirmPopUp} showTablesOnMoveTable={showTablesOnMoveTable} moveTablePopUp={moveTablePopUp} moveKotConfirmPopUp={moveKotConfirmPopUp} showTablesOnMove={showTablesOnMove} moveKotPopUp={moveKotPopUp} moveKot={moveKot} kotWiseDropDownClick={kotWiseDropDownClick} closeMoveKotPopup={closeMoveKotPopup} moveKotClick={moveKotClick} moveTable={moveTable} moveTableClick={moveTableClick} closeMoveTablePopup={closeMoveTablePopup} closeMoveTableConfirmPopup={closeMoveTableConfirmPopup} clickYesButtonOnMoveTable={clickYesButtonOnMoveTable} clickYesButtonOnMoveKot={clickYesButtonOnMoveKot} closeMovekotConfirmPopup={closeMovekotConfirmPopup} tables={tables} removeKot={removeKot} editOrder={editOrder} updateInvoice={updateInvoice} backToBiller={backToBiller} catagories={catagories} setLoading={setLoading} setHeaderChange={setHeaderChange} setProduct={setProduct} product={product} setFormValue={setFormValue} loading={loading} orderPlace={orderPlace} orderKot={orderKot} setOrderType={setOrderType} orderId={orderId} setOrderId={setOrderId} orderHold={orderHold} hotel={hotel} handlechange={handlechange} formValue={formValue} orderType={orderType} cart={cart} setCart={setCart} />
                                </>
                            )

                        ) : (

                            <div className="biller-table-view">

                                <div className="keyboard-table-select-pickup">
                                    <div className="color-help">

                                        <p className='hold-table-color-help'></p><span>Hold Table</span>
                                        <p className='kot-table-color-help'></p><span>Running Table</span>
                                        <p className='settle-table-color-help'></p><span>Pending Settle </span>
                                    </div>
                                    {/* <p className='settle-table-color-help'></p><span>Running Table</span> */}
                                    <button onClick={() => pickUpClickKeyBoard()}>Pickup</button>
                                </div>




                                <div className='delivery-orders'>
                                    <div className='online-delivery-orders-details' id='style-2'>
                                        {onlineOrders.length ? onlineOrders.map(details => (
                                            <div className="zometo-box" key={details.id}>
                                                <div className="zometo-header-data">
                                                    <div className="zometo-header-left">
                                                        <p>Bill : {details.id}</p>
                                                    </div>
                                                    <div className="zometo-header-center">
                                                        <img src={zomoto} alt="" />

                                                    </div>
                                                    <div className="zometo-header-right">
                                                        <div className="zometo-order-otp">
                                                            <div className="zometo-money-paid">
                                                                <p className="Paid-notpaid">{details.paymentMethod}</p>
                                                                <p>Otp : {details.otp}</p>
                                                            </div>
                                                            <p>Zomoto OrderId: {details.zomato_id}</p>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="zometo-body-data">
                                                    <div className="rider-details">
                                                        <div className="rider-status">
                                                            <img src={bike} alt="" />
                                                            <p>{details.rider_name ? details.rider_name : "Not Assign"}</p>
                                                        </div>

                                                        {/* <button className="raider-view-details-btn">View Details</button> */}
                                                    </div>
                                                    <div className="onlineOrders_cartDetails">
                                                        {details?.hms_online_orderDetails_msts?.map(el => (
                                                            <>
                                                                <p>
                                                                    {el.qty} × {el.item_name}
                                                                </p>

                                                            </>
                                                        ))}
                                                    </div>

                                                    <div className="bottom-side-amount-total">
                                                        <p>₹ {details.grandAmount}</p>
                                                        <Tooltip
                                                            title={details?.order_massage}
                                                            placement="top"
                                                        >
                                                            <p><TbNotes /></p>
                                                        </Tooltip>
                                                    </div>
                                                </div>

                                                <div className="zometo-footer-data">
                                                    <div className="prepare-timeing">
                                                        <p>Prepare in</p>

                                                        <PreparationTime targetDate={details.preparation_time} />
                                                    </div>
                                                    <div className="food-ready">
                                                        {details.status === 'NEW' ?
                                                            <>
                                                                <button className='accept-btn' onClick={() => orderStatusChange(details.id, "accept")}>ACCEPT</button>
                                                                <button className='reject-btn' onClick={() => orderStatusChange(details.id, "reject")}>REJECT</button>
                                                            </> : <button className='ready-btn' onClick={() => orderStatusChange(details.id, "ready")}>FOOD IS READY</button>
                                                        }

                                                    </div>
                                                </div>

                                            </div>
                                        )) : <></>}
                                    </div>
                                </div>
                                {showTableCatagoriesWise.length ? (
                                    showTableCatagoriesWise.map((el, index) => (
                                        <div className="">

                                            {/* //     <div className="table2-name">T-{el.table_name}</div>
                                        // </div> */}

                                            <p className='table-catgories-name'>{el.table_catag_nm} </p>
                                            <div className="allTablewithThierCatagories" >
                                                {el?.hms_table_msts?.map((el, index) => (
                                                    <div key={index} className={classNameSection(el.table_status)} onClick={() => { tableClick(el) }}>
                                                        {/* <div className="table-2 mt-5"> */}

                                                        {el?.hms_order_msts?.length ? (
                                                            <>
                                                                <div className="tables-categoris">
                                                                    <p className="run-table-time" style={{ margin: 0 }}>

                                                                        {el?.hms_order_msts[0]?.createdAt
                                                                            ? (() => {
                                                                                const createdAt = new Date(el?.hms_order_msts[0]?.createdAt);
                                                                                const now = new Date();
                                                                                const diffInSeconds = Math.floor((now - createdAt) / 1000);
                                                                                const minutes = Math.floor(diffInSeconds / 60);
                                                                                return <span>{`${minutes} Min `} </span>
                                                                            })()
                                                                            : ''}

                                                                        <svg id="fi_3114812" height="512" viewBox="0 0 24 24" width="512" xmlns="http://www.w3.org/2000/svg" data-name="Layer 2">
                                                                            <path d="m12 1a11 11 0 1 0 11 11 11.013 11.013 0 0 0 -11-11zm0 20a9 9 0 1 1 9-9 9.011 9.011 0 0 1 -9 9z">
                                                                            </path>
                                                                            <path d="m13 11.586v-5.586a1 1 0 0 0 -2 0v6a1 1 0 0 0 .293.707l3 3a1 1 0 0 0 1.414-1.414z">
                                                                            </path>
                                                                        </svg>
                                                                    </p>
                                                                </div>
                                                                <div className='table-kot ' style={{ fontWeight: 500 }} >
                                                                    <p> T-{el?.table_name} </p>
                                                                </div>
                                                                <div className="table-kot svg-color">

                                                                    <svg id="Capa_1" enable-background="new 0 0 512 512" height="512" viewBox="0 0 512 512" width="512" xmlns="http://www.w3.org/2000/svg">
                                                                        <g>
                                                                            <path d="m484.786 198.084h-249.571l1.782 22.75c24.993 5.452 47.976 17.827 66.632 36.166h176.543z">
                                                                            </path>
                                                                            <path d="m15 385.576h275.956v35.473h-275.956z"></path>
                                                                            <path d="m0 454.333c0 31.798 25.869 57.667 57.667 57.667h184.475 14.858.083c31.802 0 57.583-25.781 57.583-57.583v-3.367h-314.666z">
                                                                            </path>
                                                                            <path d="m314.667 354.833c0-59.186-47.98-107.167-107.167-107.167h-107.167c-49.889.001-100.333 40.444-100.333 90.334v17.576h314.667z">
                                                                            </path>
                                                                            <path d="m208 121.5h304v46.584h-304z"></path>
                                                                            <path d="m326.784 287c11.667 20.442 17.882 43.659 17.882 67.833v.743 30h-23.711v35.473h23.711v30 3.367c0 22.026-8.176 42.177-21.648 57.583h137.182l17.621-225h-151.037z">
                                                                            </path>
                                                                            <path d="m480 91.5v-44.5h-165.333v-47h-30v47h-44.667v44.5z"></path>
                                                                        </g>
                                                                    </svg>
                                                                    <p style={{ margin: 0 }}> {el?.hms_order_msts[0]?.hms_orderDetails?.length} </p>
                                                                </div>
                                                                <div className="table2-name price-bold">₹ {el?.hms_order_msts[0].grandAmount}</div>
                                                            </>
                                                        ) : (

                                                            <div >T-{el.table_name}</div>
                                                        )}
                                                        {/* </div> */}
                                                        {/* <div className='tabletimearound'>
                                                            <p className="table-name">T-{el.table_name} </p> <p className=''>
                                                                {el?.hms_order_msts?.length ? (

                                                                    el?.hms_order_msts[0]?.createdAt
                                                                        ? (() => {
                                                                            const createdAt = new Date(el?.hms_order_msts[0]?.createdAt);
                                                                            const now = new Date();
                                                                            const diffInSeconds = Math.floor((now - createdAt) / 1000);
                                                                            const minutes = Math.floor(diffInSeconds / 60);
                                                                            return <span className='table-turn-time'>
                                                                                <span>{`${minutes} Min `} </span>
                                                                                <PiClockLight />
                                                                            </span>;
                                                                        })()
                                                                        : ''

                                                                ) : ''}
                                                            </p>
                                                        </div>
                                                        <div className="table-foot">
                                                            <div className="table-kot">
                                                                <svg id="Capa_1" enableBackground="new 0 0 512 512" height="512" viewBox="0 0 512 512" width="512" xmlns="http://www.w3.org/2000/svg"><g><path d="m484.786 198.084h-249.571l1.782 22.75c24.993 5.452 47.976 17.827 66.632 36.166h176.543z" /><path d="m15 385.576h275.956v35.473h-275.956z" /><path d="m0 454.333c0 31.798 25.869 57.667 57.667 57.667h184.475 14.858.083c31.802 0 57.583-25.781 57.583-57.583v-3.367h-314.666z" /><path d="m314.667 354.833c0-59.186-47.98-107.167-107.167-107.167h-107.167c-49.889.001-100.333 40.444-100.333 90.334v17.576h314.667z" /><path d="m208 121.5h304v46.584h-304z" /><path d="m326.784 287c11.667 20.442 17.882 43.659 17.882 67.833v.743 30h-23.711v35.473h23.711v30 3.367c0 22.026-8.176 42.177-21.648 57.583h137.182l17.621-225h-151.037z" /><path d="m480 91.5v-44.5h-165.333v-47h-30v47h-44.667v44.5z" /></g></svg>

                                                                {el?.hms_order_msts?.length ? (<p>{el?.hms_order_msts[0]?.hms_orderDetails?.length}</p>) : ''}

                                                            </div>
                                                            <div className="table-bill">
                                                                <p>₹</p>
                                                                {el?.hms_order_msts?.length ? (<p>{el?.hms_order_msts[0]?.grandAmount ? el?.hms_order_msts[0]?.grandAmount : 0}</p>) : ''}
                                                            </div>
                                                        </div> */}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <h4>No Tables Found Please Create Table</h4>
                                )}
                            </div >
                        )}
                    </div >

                </div >
            )

            }

            <ToastContainer
                position="top-right"
                autoClose={2000}
                hideProgressBar={false}
                newestOnTop={false}
                closeOnClick
                rtl={false}
                pauseOnFocusLoss={false}
                draggable={false}
                pauseOnHover={false}
                theme="light"
            />
        </>
    )
}

export default Biller