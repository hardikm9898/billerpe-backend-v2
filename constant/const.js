const MESSAGE = {
    MENU_SYNC_RECEIVED: "Menu sync received",
    OUTLET_STATUS_RECEIVED: "Outlet status received",
    ORDER_RECEIVED: "Order received",
    ORDER_STATUS_UPDATED: "Order status updated",
    RIDER_STATUS_RECEIVED: "Rider status received",
    LIVE_OUTLETS_RECEIVED: "Live outlets received",
    USER_LOGIN: "Login Successfully ",
    USER_NOT_FOUND: "User Not Found Please Register First",
    RESTAURANT_NOT_FOUND: "Restaurant Not Found Please Register First",
    CREDENTIAL_FALSE: "Mobile & Password are wrong",
    HOTEL_REGISTER: "Hotel Register Successfully Completed",
    INTERNAL_SERVER_ERROR: "Internal Server Error",
    SUCCESS: "success",
    MOBILE_AND_PASSWORD: "Mobile and Password are require filed",
    HOTEL_ALREADY_REGISTEREd: "This Hotel Is Already Registered Please Change The Owner Number",
    FAIL: "Failed",
    CREATE_USER: "User Created Successfully",
    USER_ALREADY_REGISTERED: "User is Already Registered",
    TABLE_ADDED: "Table Added Successfully",
    TABLE_CATEGORY_REQUIRE: "Table Category require",
    TABLE_ALREADY_AVAILABLE: "This Table Number Is Already Available",
    TABLE_NOT_AVAILABLE: "This Table Number Is Not Available",
    RESERVED_TABLE_YOU_CAN_NOT_DETELE: "This Table is Running Table You can Not Delete ",
    MENU_ADDED: "Menu Added Successfully",
    TABLE_RUNNING: "This Table is already running please select another table",
    MENU_UPDATED: "Menu Updated Successfully",
    MENU_NOT_FOUND: "Menu Item Not Found",
    MENU_DELETED: "Menu Item Deleted Successfully",
    ORDER_CREATE: "Order Created successfully",
    QTY_AMOUNT_UPDATED: "Amount and Qty Updated Successfully",
    CART_ITEM_NOT_AVAILABLE: "This Item is Not Available in Cart",
    ITEM_IS_REMOVE_FROM_CART: "Items Removed From Your Cart",
    CART_NOT_FOUND: "No Cart Item Found ",
    ORDER_ALREADY_RECEIVED: "Order on This Table is Already Available if you want to add more items then please go on menu and add items",
    PAGE_NOT_FOUND: "page not Found ",
    NOT_ACCESS: "You don't have a access",
    NOT_AUTHORIZE: "Not Authorize User",
    HOTEL_NOT_FOUND: "Restaurant Not Found",
    RESERVED_TABLE: "This Table is Already Reserved",
    ORDER_NOT_FOUND: "Order Not Found",
    ORDER_COMPLETED: "Order Completed",
    ORDER_HOLD: "Hold Order",
    KOT_GENERATED: "Kot generated",
    ORDERDETAILS_NOT_FOUND: "Order Details Not Found",
    PAYMENT_MODE_NOT_SELECTED: "Please Select Payment Mode",
    PLEASE_SELECT_ORDER_TYPE: "Please select Order Type",
    CATAGORIES_NOT_FOUND: "This catagories is not found ",
    CATAGORIES_AVAILABLE: "This catagories is already available",
    CATAGORIES_ADDED: "Catagories is added",
    PLEASE_ADD_USER_IN_PICKUP: "Please add user Name in pickup order",
    PLEASE_ADD_Table_IN_DININ: "Please add table no in DinIn order",
    CATAGORIES_DELETED: "Catagories is deleted",
    ORDER_DELETED: "Order is deleted",
    SHORT_CODE_MUST_BE_UNIQUE: "Short Code Must be Unique",
    KOT_ORDER_NOT_REMOVE: "Kot Order Not Reomve",
    ORDER_SETTLE: "Order Settle",
    ORDER_EDITED_SUCCESSFULLY: "Order Edited Successfully ",
    INVOICE_FORMATE_CHANGE: "Invoice Formate Changed ",
    TABLE_CATEGORY_NOT_AVAILABLE: "Table Category is not available",
    TABLE_CATEGORY_ALREADY_AVAILABLE: "Category Already Available",
    TABLE_CATEGORY_ADDED: "Table Category Added",
    Table_CATEGORY_UPDATED: "Table Category Updated",
    QTY_MUST_BE_GREATER_THAN_ZERO: "Qty must greater than zero or not empty",
    BILL_PRINTED: "Bill Printed",
    MOBILE_ALREADY_USED: "This Mobile Number Is Already In Used",
    USER_UPDATED: "User Data Updated",
    T_N_T_R: "Table Not Available In This Time Range",
    T_B: "your Tables is Booked",
    SET_HEADER_FOOTER_LINES: "Set Header Footer Lines",
    BOOKING_DELETED: "Booking Deleted",
    BOOKING_UPDATED: "Booking Tables Updated",
    P_S_D_P: "Please Select Default Printer First",
    P_S_C: "Please Select Menu Category In Multi Printer ",
    D_P_R: "Please Select Default Printer",
    P_N_R: "Printer Name Must Be Required",
    D_s: "Display Set",
    KOT_NOT_FOUND: "Kot Not Found",
    KOT_MOVED: "Kot Moved Successfully",
    A_M_S_P_A: "Amount Must Be Same As Payable Amount",
    T_O_M_S: "Table Order Moved Successfully",
    P_E_V_D_N: "Please Enter Valid Display Name",
    INVALID_INPUT: "Invalid Input"
}
const ACTION = {
    HOLD: "hold",
    KOT: "kot",
    SETTLE: "settle",
    PLACEORDER: "place_order",
    UPDATEORDER: "update_order",
    DESCRISEKOT: "decrease_kot_qty",
    REMOVEKOT: "remove_kot",
    FREETABLE: "free_table",
    DETELEORDER: "delete_order",
    UPDATEORDERITEM: "update_order_item"
}

const USER_ROLE = {
    CAPTAIN: "C",
    USER: "U",
    ADMIN: "A",
    SUPER_ADMIN: "S"
}

const ORDER_DETAILS_TYPE = {
    KOT: "kot",
    IN_PROGRESS: "in-progress",
    DELIVERED: "delivered"
}

const ORDER_TYPE = {
    IN_PROGRESS: "in-progress",
    HOLD: "hold",
    PICKUP: "pickup",
    DININ: "dinin",
    DELIVERY: "delivery",
    SUCCESS: "success",

}
const STATUSCODE = {
    SESSION_EXPIRED: 440,
    SUCCESS: 200,
    ACCEPT: 202,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    VALIDATION_ERROR: 422,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    INTERNAL_SERVER_ERROR: 500,
};
const EXTRA =
{
    MOBILE: 1000,
    WEB: 1000
}

const STATUS = {
    DISPATCH: "dispatch",
    PENDING: "pending",
    DELIVERED: "delivered",
    PREPARING: "preparing",
    SUCCESS: "success",
    CANCEL: "cancel",
    FAIL: "fail"
}
const log = (data) => {
    // console.log(data)
}
module.exports = { EXTRA, log, ACTION, MESSAGE, STATUSCODE, STATUS, USER_ROLE, ORDER_TYPE, ORDER_DETAILS_TYPE }