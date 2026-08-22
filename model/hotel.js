const { Sequelize, DataTypes, STRING } = require("sequelize")
const sequelize = require("../connection/connect");
const Order = require("./order");
const User = require("./user");
const TableCatagories = require("./table_catg");
const Table = require("./table");
const OrderDetails = require("./order_details");
const Menu = require("./menu");
const Menu_categ = require("./menu_categ");
const AdminCart = require("./adminCart");
const Role = require("./role_mst");
const UserAccess = require("./userAccess");
const HotelUser = require("./hotelUser");
const TableBooking = require("./tablebooking");
const InvoiceFormate = require("./invoiceFormate");
const PrinterSetting = require("./printer_setting");
const OnlineOrders = require("./onlineOrder");
const OnlineOrderDetails = require("./onlineOrderDetails");
const Unit = require("./unit");
const RawMaterial = require("./rawItem");
const StockHistory = require("./stockHistory");
const StockInHand = require("./stockInHand");
const ExpenseHead = require("./expenseHead");
const ExpenseEntry = require("./expenseEnty");
const Recipes = require("./recipes");
const DuePaymentReceive = require("./duePayment");
const MenuVariants = require("./menu_variant");
const Variants = require("./variants");
const Testing = require("./testing");
const Addons = require("./addons");
const AddonDepartment = require("./addonDepartMent");
const MenuAddon = require("./menu_addons");
const ServiceCharge = require("./serviceCharge");
const PromoCode = require("./promoCode");
const PurchaseOrder = require("./Inventory/purchaseOrder");
const PurchaseOrderPayment = require("./Inventory/purchaseOrderPayment");
const PurchaseRawMaterial = require("./Inventory/purchaseRawMaterial");
const RawMaterialConsumption = require("./Inventory/RawMaterialcon");
const Supplier = require("./Inventory/supplyer");
const KitchenSetting = require("./kitchen");
const TimeLine = require("./timeline");
const EBillCredit = require("./ebillCredit");
const EBillCreditDebit = require("./ebillCreditDebit");
const OrderTax = require("./orderTax");
const TaxType = require("./taxType");
const Plan = require("./subscription/plan");
const Subscription = require("./subscription/subscription");
const SubscriptionPayment = require("./subscription/subscriptionPayment");
const SuperAdminUser = require("./superAdminUser");
const AdminAddRestoSave = require("./adminAddRestoSave");
const PaymentLink = require("./paymentLink");
const PhonePayPaymentLink = require("./paymentLink");
const Hotel = sequelize.define("hotel_registration", {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    hotel_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    setting_table_time: { type: DataTypes.BOOLEAN, defaultValue: false },
    default_discount_type: { type: DataTypes.STRING, defaultValue: "fix" },
    owner_name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    owner_number: {
        type: DataTypes.BIGINT(11),
        allowNull: false
    },
    owner_email_id: {
        type: DataTypes.STRING,
        defaultValue: null
    },
    address1: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    address2: {
        type: DataTypes.TEXT,
        defaultValue: null
    },
    pinCode: {
        type: DataTypes.INTEGER,
        allowNull: false
    },

    contact1: {
        type: DataTypes.STRING,

    },
    contact2: {
        type: DataTypes.STRING,

    },
    email_id: {
        type: DataTypes.STRING,
        defaultValue: null
    },
    gst_no: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    gst_reg_name: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    hotel_logo: {
        type: DataTypes.TEXT,
        allowNull: false
    },
    fssai_no: {
        type: DataTypes.STRING,
        defaultValue: ""
    },

    hotel_reg_date: {
        type: DataTypes.DATE,

    },

    plan_start_date: {
        type: DataTypes.DATE,
        // allowNull: false
    },
    plan_end_date: {
        type: DataTypes.DATE,
        // allowNull: false
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false
    },
    kotPrinter: {
        type: DataTypes.STRING
    },
    invoicePrinter: {
        type: DataTypes.STRING
    },
    invoiceFormateIncGst: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    invoiceFormateBottomText: {
        type: DataTypes.STRING,
        defaultValue: "Thank You ! Visit Again "
    },
    invoiceFormateHeaderText: {
        type: DataTypes.STRING,
        defaultValue: ""
    },
    printerSize: {
        type: DataTypes.ENUM,
        values: ['S', 'M'],
        defaultValue: "M"
    },
    multiLanguage: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    startTime: {
        type: DataTypes.TIME,
        defaultValue: 0
    },
    display: {
        type: DataTypes.ENUM,
        values: ['T', 'K'],
        defaultValue: 'T'

    },
    mode: {
        type: DataTypes.ENUM,
        values: ['L', 'T'],
        defaultValue: 'L'
    },
    zomato_id: {
        type: DataTypes.DOUBLE,
        defaultValue: 0
    },
    active_zomato: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    popUp: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    support_number: {
        type: DataTypes.DOUBLE,
        defaultValue: 8490900456
    },
    is_token_on: {
        type: DataTypes.ENUM,
        values: ['0', '1', '2', '3'],    // 0->pickup 1->dinin 2->both 3-->off
        defaultValue: '3'
    },
    bill_with_kot: {
        type: DataTypes.ENUM,
        values: ['0', '1', '2', '3'],    // 0->pickup 1->dinin 2->both 3-->off
        defaultValue: '3'
    },
    bill_with_token: {
        type: DataTypes.ENUM,
        values: ['0', '1', '2', '3'],    // 0->pickup 1->dinin 2->both 3-->off
        defaultValue: '3'
    },

    upiId: {
        type: DataTypes.STRING,
        defaultValue: ''
    },

    currency: {
        type: DataTypes.STRING,
        defaultValue: '₹'
    },

    active: {

        type: DataTypes.BOOLEAN,
        defaultValue: true

    },
    testing: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    saveBehave: {
        type: DataTypes.ENUM,
        values: ['pdf', 'save', 'whatsapp'],    // 0->pickup 1->dinin 2->both 3-->off
        defaultValue: 'save'
    },
    kds: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    language: {
        type: DataTypes.STRING,
        defaultValue: "en"
    },
    traningCompleted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    menu_uploaded: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    menu_uploaded_date: {
        type: DataTypes.DATE,
        defaultValue: null
    },
    traningCompleted_date: {
        type: DataTypes.DATE,
        defaultValue: null
    },

    show_menu_with_image: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
})
// Hotel.hasOne(ServiceCharge, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE', // If a hotel is deleted, delete all associated table categories
//     onUpdate: 'CASCADE'
// })
// ServiceCharge.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE', // If a hotel is deleted, delete all associated table categories
//     onUpdate: 'CASCADE'
// })
// Hotel.hasMany(Order, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE', // If a hotel is deleted, delete all associated table categories
//     onUpdate: 'CASCADE'
// });
// Order.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// Hotel.hasMany(KitchenSetting, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE', // If a hotel is deleted, delete all associated table categories
//     onUpdate: 'CASCADE'
// });
// KitchenSetting.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// OnlineOrders.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// OnlineOrderDetails.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })

// Hotel.hasMany(TableCatagories, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// });
// TableCatagories.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// Hotel.hasMany(DuePaymentReceive, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// });
// DuePaymentReceive.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })


// Hotel.hasMany(Table, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// });
// Table.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })

// Hotel.hasMany(OrderDetails, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// });
// OrderDetails.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })

// Hotel.hasMany(Menu, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// });
// Menu.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })

// Hotel.hasMany(Menu_categ, {
//     foreignKey: 'hotel_id',
// });
// Menu_categ.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })

// Hotel.hasMany(AdminCart, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// });
// AdminCart.belongsTo(Hotel, { foreignKey: 'id' })
// Hotel.hasMany(User, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// });
// User.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// Hotel.hasMany(Role, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// });
// Role.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// Hotel.hasMany(UserAccess, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// });
// UserAccess.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// Hotel.hasMany(HotelUser, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// HotelUser.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }
// )
// Hotel.hasMany(TableBooking, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// TableBooking.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }
// )

// Hotel.hasOne(InvoiceFormate, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// InvoiceFormate.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// },

// )
// PrinterSetting.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),
//     Hotel.hasMany(PrinterSetting, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// Unit.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),
//     Hotel.hasMany(Unit, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// RawMaterial.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),
//     Hotel.hasMany(RawMaterial, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// StockHistory.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),
//     Hotel.hasMany(StockHistory, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// StockInHand.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),
//     Hotel.hasMany(StockInHand, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// ExpenseHead.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),
//     Hotel.hasMany(ExpenseHead, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// ExpenseEntry.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),
//     Hotel.hasMany(ExpenseEntry, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// Recipes.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(Recipes, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// MenuVariants.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(MenuVariants, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// Variants.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(Variants, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// Testing.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(Testing, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// Addons.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(Addons, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// AddonDepartment.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(AddonDepartment, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// MenuAddon.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(MenuAddon, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// PromoCode.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(PromoCode, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })


// PurchaseOrder.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(PurchaseOrder, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// PurchaseOrderPayment.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(PurchaseOrderPayment, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// PurchaseRawMaterial.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(PurchaseRawMaterial, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// RawMaterialConsumption.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(RawMaterialConsumption, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// Supplier.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(Supplier, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// TimeLine.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(TimeLine, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// Hotel.hasMany(EBillCredit, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// EBillCredit.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })
// EBillCreditDebit.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// })

// OrderTax.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(OrderTax, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// TaxType.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(TaxType, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })

// Subscription.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(Subscription, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// SubscriptionPayment.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),

//     Hotel.hasMany(SubscriptionPayment, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })
// PhonePayPaymentLink.belongsTo(Hotel, {
//     foreignKey: 'hotel_id', onDelete: 'CASCADE',
//     onUpdate: 'CASCADE'
// }),
//     Hotel.hasMany(PhonePayPaymentLink, {
//         foreignKey: 'hotel_id', onDelete: 'CASCADE',
//         onUpdate: 'CASCADE'
//     })

// SuperAdminUser(sequelize, DataTypes, Hotel)


module.exports = Hotel

