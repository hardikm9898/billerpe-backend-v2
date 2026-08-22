const joi = require("joi")


// Raw material consumption validation schemas
const recordConsumptionSchema = joi.object({
    raw_material_id: joi.number().greater(0).required().messages({
        'any.required': 'Raw material ID is required.',
        'number.greater': 'Please select a valid raw material.'
    }),
    qty: joi.number().greater(0).required().messages({
        'any.required': 'Quantity is required.',
        'number.greater': 'Quantity must be greater than 0.'
    }),
    purpose: joi.string().valid('recipe', 'waste', 'spoilage', 'other').required().messages({
        'any.required': 'Purpose is required.',
        'any.only': 'Purpose must be one of: recipe, waste, spoilage, other.'
    }),
    reference_id: joi.number().optional(),
    reference_type: joi.string().optional(),
    notes: joi.string().optional().allow(''),
    unit_id: joi.number().greater(0).required().messages({
        'any.required': 'Unit ID is required.',
        'number.greater': 'Please select a valid unit.'
    })
});

const consumptionHistoryQuerySchema = joi.object({
    startDate: joi.date().optional(),
    endDate: joi.date().optional(),
    search: joi.string().allow('').optional(),
    raw_material_id: joi.number().greater(0).optional()
});

const consumptionSummaryQuerySchema = joi.object({
    startDate: joi.date().optional(),
    endDate: joi.date().optional(),
    purpose: joi.string().valid('recipe', 'waste', 'spoilage', 'other').optional()
});

const hotelSchema = joi.object({
    hotel_name: joi.string().required(),
    owner_name: joi.string().required(),
    owner_number: joi.number().required(),
    owner_email_id: joi.string().lowercase().email().required(),
    address1: joi.string().required(),
    address2: joi.string(),
    pinCode: joi.number().required(),
    area_cd: joi.number().required(),
    city_cd: joi.number().required(),
    state_cd: joi.number().required(),
    country_cd: joi.number().required(),
    contact1: joi.number(),
    contact2: joi.number(),
    email_id: joi.string(),
    gst_no: joi.string().required(),
    gst_reg_name: joi.string().required(),
    hotel_logo: joi.string(),
    fssai_no: joi.string().required(),
    app_version: joi.string().required(),
    hotel_reg_date: joi.date().required(),
    plan_id: joi.number().required(),
    plan_start_date: joi.date().required(),
    plan_end_date: joi.date().required(),
    password: joi.string().required()
})

const userSchemaUpdate = joi.object({
    name: joi.string().required(),
    email: joi.string().lowercase().email().required(),
    number: joi.string().regex(/^[0-9]{10}$/).messages({ 'string.pattern.base': `Phone number must have 10 digits.` }).required(),
    role: joi.string().required(),
    password: joi.string().min(6).messages({ 'string.pattern.base': `PassWord must have 6 character.` }).required(),
    pin: joi.string().pattern(/^[0-9]{4,6}$/).messages({ 'string.pattern.base': `PIN must be 4-6 digits.` }).optional(),

})
const userSchema = joi.object({
    active: joi.boolean().required(),
    name: joi.string().min(3).max(30).required(),
    password: joi.string().min(6).optional(),
    email: joi.string().email({ minDomainSegments: 2, tlds: { allow: ['com', 'net'] } }).required(),
    role: joi.string().required(),
    number: joi.string().min(10).pattern(/^[0-9]+$/).required(),
    pin: joi.string().pattern(/^[0-9]{4,6}$/).messages({ 'string.pattern.base': `PIN must be 4-6 digits.` }).optional(),
    access_name: joi.array().items(
        joi.object({
            access: joi.string().valid('Order', 'Table', 'Menu', 'DashBoard', 'Reports', 'Biller', 'Booking', "Stock", "Expense", "Zomato", "User").required(),
            permissions: joi.object({
                read: joi.boolean().required(),
                create: joi.boolean().required(),
                edit: joi.boolean().required(),
                delete: joi.boolean().required()
            }).required()
        })
    ).required(),
    showPassword: joi.boolean()
});
const restaurantLogin = joi.object({
    mobile: joi.string().required(),
    password: joi.string().required()
})
const tableSchema = joi.object({
    tableNumber: joi.number().required(),
    capacity: joi.number().required(),
    vacant: joi.boolean(),
    table_catagories: joi.string().required()
})


const menuSchema = joi.object({
    item_name: joi.string()
        .trim()
        .min(2)
        .max(100)
        // .pattern(/^[A-Za-z0-9 .,'()&\-\[\]]+$/)
        .required()
        .messages({
            "string.base": "Item name must be a string.",
            "string.empty": "Item name cannot be empty.",
            "string.min": "Item name must be at least 2 characters.",
            "string.max": "Item name cannot exceed 100 characters.",
            "string.pattern.base": "Item name contains invalid characters.",
            "any.required": "Item name is required."
        }),

    menu_categ_id: joi.number()
        .integer()
        .greater(0)
        .required()
        .messages({
            "number.base": "Menu category ID must be a number.",
            "number.greater": "Menu category ID must be greater than 0.",
            "any.required": "Menu category ID is required."
        }),

    imageUrl: joi.string()
        .uri({ scheme: ['http', 'https'] })
        .max(500)
        .allow('', null)
        .messages({
            "string.uri": "Image URL must be a valid URL.",
            "string.max": "Image URL cannot exceed 500 characters."
        }),

    price: joi.number()
        .greater(0)
        .precision(2)
        .required()
        .messages({
            "number.base": "Price must be a number.",
            "number.greater": "Price must be greater than 0.",
            "any.required": "Price is required."
        }),

    shortCode: joi.string()
        .trim()
        .alphanum()
        .min(1)
        .max(20)
        .required()
        .messages({
            "string.base": "Shortcode must be a string.",
            "string.empty": "Shortcode cannot be empty.",
            "string.max": "Shortcode cannot exceed 20 characters.",
            "any.required": "Shortcode is required."
        }),

    favorite: joi.boolean()
        .default(false),

    description: joi.string()
        .trim()
        .max(500)
        .allow('', null)
        .messages({
            "string.max": "Description cannot exceed 500 characters."
        }),

    sub_categories: joi.string()
        .trim()
        .max(100)
        .allow('', null)
        .messages({
            "string.max": "Sub category name cannot exceed 100 characters."
        }),

    gst_type: joi.string().required(),

    variants: joi.array()
        .items(
            joi.object({
                id: joi.number()
                    .integer()
                    .greater(0)
                    .required()
                    .messages({
                        "any.required": "Variant ID is required.",
                        "number.greater": "Variant ID must be greater than 0."
                    }),

                variant_price: joi.number()
                    .greater(0)
                    .precision(2)
                    .required()
                    .messages({
                        "any.required": "Variant price is required.",
                        "number.greater": "Variant price must be greater than 0."
                    }),
            })
        )
        .optional()
        .messages({
            "array.base": "Variants must be an array of variant objects."
        }),
barcode_value:joi.string().optional().allow(''),
    addons: joi.array()
        .items(
            joi.number()
                .integer()
                .greater(0)
                .messages({
                    "number.base": "Each addon must be a number.",
                    "number.greater": "Each addon must be greater than 0."
                })
        )
        .default([])
        .messages({
            "array.base": "Addons must be an array of numbers."
        }),
});

const editMenuSchema = joi.object({
    id: joi.number().greater(0).required().messages({ "any.required": "Id required.", "number.greater": "Id Must Be Greater Than 0." }),
    item_name: joi.string()
        .trim()
        .min(2)
        .max(100)
        // .pattern(/^[A-Za-z0-9 .,'()&\-\[\]]+$/)
        .required()
        .messages({
            "string.base": "Item name must be a string.",
            "string.empty": "Item name cannot be empty.",
            "string.min": "Item name must be at least 2 characters.",
            "string.max": "Item name cannot exceed 100 characters.",
            "string.pattern.base": "Item name contains invalid characters.",
            "any.required": "Item name is required."
        }),
    catagories: joi.string(),
    foodImage: joi.string().optional(),
    price: joi.number().greater(0).precision(2).required()
        .messages({
            "number.base": "Price must be a number.",
            "number.greater": "Price must be greater than 0.",
        }),
    shortCode: joi.string().required(),
    description: joi.string(),
    sub_categories: joi.string(),
    gst_type: joi.string(),
    favorite: joi.boolean(),
    variants: joi.array().items(
        joi.object({
            id: joi.number().greater(0).required().messages({ "any.required": "Variant id required.", "number.greater": "Please Select Variant." }),
            variant_price: joi.number().greater(0).required().messages({ "any.required": "Variant Price required.", "number.greater": "Variant Price Must Be Greater Than 0." }),
            variants_name: joi.string().optional(),
            active: joi.boolean().optional(),
        })
    ).optional(),
    barcode_value:joi.string().optional().allow(''),
    addons: joi.array()
        .items(
            joi.number().greater(0).messages({
                "number.base": "Each addon must be a number.",
                "number.greater": "Each addon must be greater than 0.",
                "any.required": "Addon is required."
            })
        ).default([])
        .messages({
            "array.base": "Addons must be an array of numbers."
        }),
})

const bookTable = joi.object({
    name: joi.string().required(),
    email: joi.string().lowercase().email().required(),
    number: joi.string().regex(/^[0-9]{10}$/).messages({ 'string.pattern.base': `Phone number must have 10 digits.` }).required(),
    booking_date: joi.date().required(),
    start_time: joi.string(),
    end_time: joi.string(),
    no_of_person: joi.number().required(),
    totalAmount: joi.number(),
    gst_no: joi.string(),
    advance: joi.number(),
    table_name: joi.array().required()


})

const printerSchema = joi.object({
    printer_name: joi.string().required(),
    printer_size: joi.string().required(),
    number_of_copies: joi.number().required(),
    print_type: joi.string().required()

})
const printerSchemaEdit = joi.object({
    id: joi.number().required(),
    printer_name: joi.string().required(),
    printer_size: joi.string().required(),
    number_of_copies: joi.number().required(),
    print_type: joi.string().required()

})

const getDuePaymentSchema = joi.object({
    bill_no: joi.string(),
    number: joi.string()
})


//! stock Validation schema 
const addRawMaterialSchema = joi.object({
    unit: joi.number().required().messages({
        'any.required': 'Please Unit Name',
    }),
    raw_material_name: joi.string().required().messages({ 'string.empty': 'Raw Material Name Must Be Require.' }),
    purchase_price: joi.string()
        .pattern(/^\d+(\.\d+)?$/)
        .required()
        .messages({
            'string.pattern.base': 'Purchase Price must be a valid number (integer or decimal).',
            'string.empty': 'Purchase Price is required.',
        }),
    consumption_unit: joi.number().greater(0).required().messages({
        'any.required': 'Consumption Unit is required.',
        'number.greater': 'Please Select Consumption Unit.',
    }),
    mini_stock_level: joi.boolean().required().messages({
        'any.required': 'Minimum Stock Level is required.',
        'boolean.base': 'Minimum Stock Level must be a boolean value.'
    }),
    mini_stock_level_qty: joi.number().when('mini_stock_level', {
        is: true,
        then: joi.required().messages({
            'any.required': 'Minimum Stock Level Qty is required when Minimum Stock Level is true.',

        }),
        otherwise: joi.optional()
    }),
    conversion_qty: joi.number().greater(0).messages({
        'any.required': 'Conversion Qty is required.',
        'number.greater': 'Conversion Qty Must Be Greater Than 0.',
    }),
    hotel_id: joi.number().optional().allow(null),
});

const editRawMaterialSchema = joi.object({
    id: joi.number().required().messages({
        'any.required': 'Missing Id',
    }),
    unit: joi.number().required().messages({
        'any.required': 'Please Unit Name',
    }),
    purchase_price: joi.string()
        .pattern(/^\d+(\.\d+)?$/)
        .required()
        .messages({
            'string.pattern.base': 'Purchase Price must be a valid number (integer or decimal).',
            'string.empty': 'Purchase Price is required.',
        }),
    raw_material_name: joi.string().required().messages({
        'string.empty': 'Raw Material Name Must Be Require.',
    }),
    consumption_unit: joi.number().greater(0).required().messages({
        'any.required': 'Consumption Unit is required.',
        'number.greater': 'Please Select Consumption Unit.',
    }),
    conversion_qty: joi.number().greater(0).messages({
        'any.required': 'Conversion Qty is required.',
        'number.greater': 'Conversion Qty Must Be Greater Than 0.',
    }),
    mini_stock_level: joi.boolean().required().messages({
        'any.required': 'Minimum Stock Level is required.',
        'boolean.base': 'Minimum Stock Level must be a boolean value.'
    }),
    mini_stock_level_qty: joi.number().required().messages({
        'any.required': 'Minimum Stock Level Qty is required.',

    }),
    hotel_id: joi.number().optional().allow(null),
})

const addUnitSchema = joi.object({

    unitName: joi.string().required().messages({
        'string.empty': 'Unit Name Must Be Require.',

    }),
    shortName: joi.string().required().messages({
        'string.empty': 'Short Name Must Be Require.',

    }),
})

const editUnitSchema = joi.object({
    id: joi.number().required().messages({
        'any.required': 'Missing Id',
    }),
    unitName: joi.string().required().messages({
        'string.empty': 'Unit Name Must Be Require.',

    }),
    shortName: joi.string().required().messages({
        'string.empty': 'Short Name Must Be Require.',

    }),
})

const deleteStockHiStorySchema = joi.object({
    id: joi.number().required().messages({
        'any.required': 'Missing Id',
    }),
})
const editStockHistorySchema = joi.object({
    qty: joi.number().greater(0).required().messages({
        'any.required': 'Qty Must Be Require.',
        'number.greater': 'Qty Must Be Greater Than 0.'
    }),
    raw_material_id: joi.number().greater(0).required().messages({
        'any.required': 'Please Select RawMaterial Name.',
        'number.greater': 'Please Select Raw Material Name.'
    }),
    id: joi.number().required().messages({
        'any.required': 'Missing Id',

    }),
})
const inOutStockSchema = joi.object({
    raw_material_id: joi.number().greater(0).required().messages({ 'any.required': 'Please Select Raw Material name.', 'number.greater': "Please Select Raw Material Name" }), qty: joi.number().greater(0).required().messages({ 'any.required': "Qty Must Require Field.", "number.greater": "Qty Must Be greater Than 0" }), unit: joi.string(), price: joi.number().greater(0).required().messages({ 'any.required': "Price Must Require Field.", "number.greater": "Price Must Be greater Than 0" })
})
const outStockSchema = joi.object({
    raw_material_id: joi.number().greater(0).required().messages({ 'any.required': 'Please Select Raw Material name.', 'number.greater': "Please Select Raw Material Name" }), qty: joi.number().greater(0).required().messages({ 'any.required': "Qty Must Require Field.", "number.greater": "Qty Must Be greater Than 0" }), unit: joi.string()
})


// ! expense validation

const addExpenseSchema = joi.object({
    expense_head_id: joi.number().greater(0).required().messages({ "any.required": "Please Select Expense Head.", "number.greater": "Please Select Expense Head." }),
    amount: joi.number().greater(0).required().messages({ 'any.required': "Amount Must Require Field.", "number.greater": "Amount Must Be greater Than 0." }),
    paymentMode: joi.string().required().messages({ 'string.empty': 'Please Select Payment Mode.' }),
    reason: joi.string().required().messages({ 'string.empty': 'Reason Is Required Filed.' }),
    addExpense: joi.boolean().required().messages({ 'any.required': "Please Mention AddExpense Or Add Money." }),
    date: joi.date().optional().allow(null, '')
})
const editExpenseSchema = joi.object({
    addExpense: joi.boolean().required().messages({ 'any.required': "Please Mention AddExpense Or Add Money." }),
    amount: joi.number().greater(0).required().messages({ 'any.required': "Amount Must Require Field.", "number.greater": "Amount Must Be greater Than 0." }),
    paymentMode: joi.string().required().messages({ 'string.empty': 'Please Select Payment Mode.' }),
    reason: joi.string().required().messages({ 'string.empty': 'Reason Is Required Filed.' }),
    expense_head_id: joi.number().greater(0).required().messages({ "any.required": "Please Select Expense Head.", "number.greater": "Please Select Expense Head." }),
    id: joi.number().greater(0).required().messages({ "any.required": "Id Missing.", "number.greater": "Id Must Be Greater Than 0" }),
    date: joi.date().optional().allow(null, '')
})
const deleteExpenseSchema = joi.object({
    id: joi.number().greater(0).required().messages({ "any.required": "Id Missing.", "number.greater": "Id Must Be Greater Than 0" })
})
const allEntrySchema = joi.object({
    startDate: joi.date().required().messages({ "any.required": "Start Date Missing In Params." }),
    endDate: joi.date().required().messages({ "any.required": "End Date Missing  In Params.." }),

})

const addRecipeSchema = joi.object({
    menu_id: joi.number().greater(0).required().messages({ "any.required": "MenuId required.", "number.greater": "Please Select Item. " }),
    raw_material_data: joi.array().items(
        joi.object({
            raw_material_id: joi.number().greater(0).required().messages({ "any.required": "raw_material_id required.", "number.greater": "Please Select Raw-Material item." }),
            consumption_qty: joi.number().greater(0).required().messages({ "any.required": "consumption_qty required.", "number.greater": "consumption Qty Must Be Greater Than 0." }),
            consumption_unit: joi.string().optional(),
        })
    ).required()
});

// const editRecipeSchema = joi.object({
//     menu_id: joi.number().greater(0).required().messages({ "any.required": "MenuId required.", "number.greater": "Please Select Item. " }),
//     raw_material_data: joi.array().items(
//         joi.object({
//             raw_material_id: joi.number().greater(0).required().messages({ "any.required": "raw_material_id required.", "number.greater": "Please Select Raw-Material item." }),
//             consumption_qty: joi.number().greater(0).required().messages({ "any.required": "consumption_qty required.", "number.greater": "consumption Qty Must Be Greater Than 0." }),
//             consumption_unit: joi.string().optional(),
//         })
//     ).required() // raw_material_data array is required
// });

//! websites Validations 

const websiteUserSchema = joi.object({
    name: joi.string().optional().allow(''),
    email: joi.string().optional().allow(''),
    message: joi.string().optional().allow(''),
    phone_number: joi.string().regex(/^[0-9]{10}$/).messages({ 'string.pattern.base': `Phone number must have 10 digits.` }).required(),
    chack_box: joi.string().optional().allow('')
})


// ! Variant And Addon validation Schema 

const attributes = ['veg', 'non-veg', 'egg']
const createAddonSchema = joi.object({
    department_name: joi.string().required().messages({
        'any.required': 'Department name is required.',
        'string.empty': 'Department name cannot be empty.'
    }),
    maximum_allowed_addon: joi.number().greater(0).required().messages({ "any.required": "Maximum Allowed Addon required.", "number.greater": "Maximum Allowed Addon Must Be Greater Than 0." }).required(),
    minimum_allowed_addon: joi.number().greater(-1).required().messages({ "any.required": "Minimum Allowed Addon required.", "number.greater": "Minimum Allowed Addon Must Be Greater Than -1." }).required(),
    singleSelection: joi.boolean().required(),
    addons: joi.array().items(
        joi.object({
            addon_name: joi.string().required().messages({
                'any.required': 'Addon name is required.',
                'string.empty': 'Addon name cannot be empty.'
            }),
            price: joi.number().required().messages({ "any.required": "Price required.", "number.greater": " Price Must Be Greater Than 0." }),
            attributes: joi.string()
                .valid(...attributes)
                .required()
                .messages({
                    'any.required': 'Attributes are required.',
                    'any.only': `Attributes must be one of [${attributes.join(', ')}].`
                })
        })
    ).optional()
})
const updatedAddonsSchema = joi.object({
    id: joi.number().required().messages({ "any.required": "Id required.", "number.greater": "Id Must Be Greater Than 0." }).required(),

    department_name: joi.string().required().messages({
        'any.required': 'Department name is required.',
        'string.empty': 'Department name cannot be empty.'
    }),
    maximum_allowed_addon: joi.number().greater(0).required().messages({ "any.required": "Maximum Allowed Addon required.", "number.greater": "Maximum Allowed Addon Must Be Greater Than 0." }).required(),
    minimum_allowed_addon: joi.number().greater(-1).required().messages({ "any.required": "Minimum Allowed Addon required.", "number.greater": "Minimum Allowed Addon Must Be Greater Than -1." }).required(),
    singleSelection: joi.boolean().required(),
    addons: joi.array().items(
        joi.object({
            addon_name: joi.string().required().messages({
                'any.required': 'Addon name is required.',
                'string.empty': 'Addon name cannot be empty.'
            }),
            price: joi.number().required().messages({ "any.required": "Price required.", "number.greater": " Price Must Be Greater Than 0." }),
            attributes: joi.string()
                .valid(...attributes)
                .required()
                .messages({
                    'any.required': 'Attributes are required.',
                    'any.only': `Attributes must be one of [${attributes.join(', ')}].`
                })
        })
    ).optional()
})
const createTableSchema = joi.object({
    startNo: joi.string()
        .pattern(/^\d+$/, "numeric") // Only positive numeric values allowed
        .required()
        .messages({
            "string.empty": "Start number is required.",
            "string.pattern.base": "Start number must be a positive numeric value.",
        }),

    endNo: joi.string()
        .pattern(/^\d+$/, "numeric") // Only positive numeric values allowed
        .required()
        .custom((value, helpers) => {
            // Ensure endNo is not less than startNo
            const startNo = helpers.state.ancestors[0].startNo;
            if (parseInt(value, 10) < parseInt(startNo, 10)) {
                return helpers.message("End number must not be less than Start number.");
            }
            return value;
        })
        .messages({
            "string.empty": "End number is required.",
            "string.pattern.base": "End number must be a positive numeric value.",
        }),

    type: joi.string()
        .valid("R", "T") // Enum validation
        .required()
        .messages({
            "string.empty": "Type is required.",
            "any.only": "Type must be either 'R' (Room) or 'T' (Table).",
        }),

    table_catag_id: joi.string()
        .required()
        .custom((value, helpers) => {
            // Check if table_catag_id is "0" or empty
            if (!value || value === "0") {
                return helpers.message("Please select a category.");
            }
            return value;
        })
        .messages({
            "string.empty": "Category ID is required.",
        }),
});


//! PromoCode Validation

// Purchase Order validation schemas

const createPurchaseOrderSchema = joi.object({
    supplier_id: joi.number().greater(0).required().messages({
        'any.required': 'Supplier ID is required.',
        'number.greater': 'Please select a valid supplier.'
    }),
    payment_type: joi.string().valid("paid", "partial", "unpaid").required().messages({
        'any.required': 'Payment type is required.',
        'any.only': 'Payment type must be one of: paid, partial, unpaid.'
    }),
    payment_mode: joi.string().valid("cash", "card", "online", "cheque", "other").allow('').when('payment_type', {
        is: 'paid',
        then: joi.required().messages({ 'any.required': 'Payment mode is required when payment type is paid.' })
    }).messages({
        'any.only': 'Payment mode must be one of: cash, card, online, cheque, other.'
    }),

    payment_ref_no: joi.string().allow('').when('payment_mode', {
        not: 'cash',
        then: joi.required().messages({ 'any.required': 'Payment reference number is required when payment mode is not cash.' })
    }),
    GSTNo: joi.string().allow('').optional(),
    update_inventory: joi.boolean().default(true).optional(),
    grandAmount: joi.number().required().messages({
        'any.required': 'Grand amount is required.',
        'number.base': 'Grand amount must be a number.'
    }),
    discount: joi.number().default(0).optional(),
    delivery_charge: joi.number().default(0).optional(),
    invoice_date: joi.date().optional(),
    invoice_number: joi.string().allow('').optional(),
    Po_no: joi.number().default(0).optional(),
    paidAmount: joi.number().default(0).optional(), // Added
    paymentDate: joi.date().optional(), // Added
    rawMaterialData: joi.array().items(
        joi.object({
            raw_material_id: joi.number().greater(0).required().messages({
                'any.required': 'Raw material ID is required.',
                'number.greater': 'Please select a valid raw material.'
            }),
            qty: joi.number().greater(0).required().messages({
                'any.required': 'Quantity is required.',
                'number.greater': 'Quantity must be greater than 0.'
            }),
            price: joi.number().greater(0).required().messages({
                'any.required': 'Price is required.',
                'number.greater': 'Price must be greater than 0.'
            }),
            amount: joi.number().required().messages({
                'any.required': 'Amount is required.',
                'number.base': 'Amount must be a number.'
            }),
            cgst: joi.number().default(0).optional(),
            sgst: joi.number().default(0).optional(),
            igst: joi.number().default(0).optional(),
            unit_id: joi.number().greater(0).required().messages({
                'any.required': 'Unit ID is required.',
                'number.greater': 'Please select a valid unit.'
            })
        })
    ).required().messages({
        'any.required': 'Raw material data is required.',
        'array.base': 'Raw material data must be an array.'
    }),
    discount_type: joi.string().valid("fix", "pr").default("fix").optional(), // Added
    discount_value: joi.number().default(0).optional(), // Added
    sub_total: joi.number().default(0).optional(), // Added
});

const updatePurchaseOrderSchema = joi.object({
    id: joi.number().greater(0).required().messages({
        'any.required': 'Purchase order ID is required.',
        'number.greater': 'Please provide a valid purchase order ID.'
    }),
    supplier_id: joi.number().greater(0).required().messages({
        'any.required': 'Supplier ID is required.',
        'number.greater': 'Please select a valid supplier.'
    }),
    payment_type: joi.string().valid("paid", "partial", "unpaid").required().messages({
        'any.required': 'Payment type is required.',
        'any.only': 'Payment type must be one of: paid, partial, unpaid.'
    }),
    payment_mode: joi.string().valid("cash", "card", "online", "cheque", "other").allow('').when('payment_type', {
        is: 'paid',
        then: joi.required().messages({ 'any.required': 'Payment mode is required when payment type is paid.' })
    }).messages({
        'any.only': 'Payment mode must be one of: cash, card, online, cheque, other.'
    }),
    payment_ref_no: joi.string().allow('').when('payment_mode', {
        not: 'cash',
        then: joi.required().messages({ 'any.required': 'Payment reference number is required when payment mode is not cash.' })
    }),
    GSTNo: joi.string().allow('').optional(),
    update_inventory: joi.boolean().default(true).optional(),
    grandAmount: joi.number().required().messages({
        'any.required': 'Grand amount is required.',
        'number.base': 'Grand amount must be a number.'
    }),
    discount: joi.number().default(0).optional(),
    paidAmount: joi.number().default(0).optional(), // Added
    paymentDate: joi.date().optional(), // Added
    delivery_charge: joi.number().default(0).optional(),
    invoice_date: joi.date().optional(),
    invoice_number: joi.string().allow('').optional(),
    Po_no: joi.number().default(0).optional(),
    rawMaterialData: joi.array().items(
        joi.object({
            id: joi.number().optional(), // Optional for new raw materials
            raw_material_id: joi.number().greater(0).required().messages({
                'any.required': 'Raw material ID is required.',
                'number.greater': 'Please select a valid raw material.'
            }),
            qty: joi.number().greater(0).required().messages({
                'any.required': 'Quantity is required.',
                'number.greater': 'Quantity must be greater than 0.'
            }),
            price: joi.number().greater(0).required().messages({
                'any.required': 'Price is required.',
                'number.greater': 'Price must be greater than 0.'
            }),
            amount: joi.number().required().messages({
                'any.required': 'Amount is required.',
                'number.base': 'Amount must be a number.'
            }),
            cgst: joi.number().default(0).optional(),
            sgst: joi.number().default(0).optional(),
            igst: joi.number().default(0).optional(),
            unit_id: joi.number().greater(0).required().messages({
                'any.required': 'Unit ID is required.',
                'number.greater': 'Please select a valid unit.'
            })
        })
    ).required().messages({
        'any.required': 'Raw material data is required.',
        'array.base': 'Raw material data must be an array.'
    }),
    discount_type: joi.string().valid("fix", "pr").default("fix").optional(), // Added
    discount_value: joi.number().default(0).optional(), // Added
    sub_total: joi.number().default(0).optional(), // Added
});

const deletePurchaseOrderSchema = joi.object({
    id: joi.number().greater(0).required().messages({
        'any.required': 'Purchase order ID is required.',
        'number.greater': 'Please provide a valid purchase order ID.'
    })
});
const paymentDoneSchema = joi.object({
    id: joi.number().greater(0).required().messages({
        'any.required': 'Purchase order ID is required.',
        'number.greater': 'Please provide a valid purchase order ID.'
    }),
    payment_mode: joi.string().valid("cash", "card", "online", "cheque", "other").messages({
        'any.only': 'Payment mode must be one of: cash, card, online, cheque, other.'
    }),
    payment_ref_no: joi.string().allow('').when('payment_mode', {
        not: 'cash',
        then: joi.required().messages({ 'any.required': 'Payment reference number is required when payment mode is not cash.' })
    }),
    payment_date: joi.date().required(),
    paidAmount: joi.number().greater(0).required(),

});

const promoSchema = joi.object({
    promo_code_name: joi.string()
        .required()
        .messages({
            "string.base": "Promo code name must be a string",
            "any.required": "Promo code name is required",
        }),

    promo_code: joi.string()
        .required()
        .messages({
            "string.base": "Promo code must be a string",
            "any.required": "Promo code is required",
        }),

    discount_type: joi.string()
        .valid("fix", "pr")
        .required()
        .messages({
            "any.only": 'Discount type must be either "fix" or "pr"',
            "any.required": "Discount type is required",
        }),

    discount_value: joi.number()
        .required()
        .when("discount_type", {
            is: "pr",
            then: joi.number().min(0).max(100).messages({
                "number.min": "Discount value must be at least 0 when discount type is 'pr'",
                "number.max": "Discount value must not exceed 100 when discount type is 'pr'",
            }),
        })
        .messages({
            "number.base": "Discount value must be a number",
            "any.required": "Discount value is required",
        }),
});
const updatePromoCodeValidation = joi.object({
    id: joi.number()
        .required()
        .messages({
            "string.base": "Id must be a Number",
            "any.required": "Id is required",
        }),
    promo_code_name: joi.string()
        .required()
        .messages({
            "string.base": "Promo code name must be a string",
            "any.required": "Promo code name is required",
        }),

    promo_code: joi.string()
        .required()
        .messages({
            "string.base": "Promo code must be a string",
            "any.required": "Promo code is required",
        }),

    discount_type: joi.string()
        .valid("fix", "pr")
        .required()
        .messages({
            "any.only": 'Discount type must be either "fix" or "pr"',
            "any.required": "Discount type is required",
        }),

    discount_value: joi.number()
        .required()
        .when("discount_type", {
            is: "pr",
            then: joi.number().min(0).max(100).messages({
                "number.min": "Discount value must be at least 0 when discount type is 'pr'",
                "number.max": "Discount value must not exceed 100 when discount type is 'pr'",
            }),
        })
        .messages({
            "number.base": "Discount value must be a number",
            "any.required": "Discount value is required",
        }),

})

const taxTypeCreateValidation = joi.object({
    tax_name: joi.string().required().messages({
        'string.base': 'Tax name must be a string.',
        'any.required': 'Tax name is required.',
        'string.empty': 'Tax name cannot be empty.'
    }),

    tax_value: joi.string()
        .valid("fix", "pr")
        .required()
        .messages({
            'any.only': 'Tax value must be either "fix" or "persentage".',
            'any.required': 'Tax value is required.',
            'string.base': 'Tax value must be a string.'
        })
    ,

    amount: joi.number().greater(0).required().messages({
        'number.base': 'Amount must be a number.',
        'number.greater': 'Amount must be greater than 0.',
        'any.required': 'Amount is required.'
    }),

    order_type: joi.array()
        .items(joi.string().valid('pickup', 'dinin').messages({
            'any.only': 'Order type must be either pickup or dinin.',
            'string.base': 'Each order type must be a string.'
        }))
        .min(1)
        .required()
        .messages({
            'array.base': 'Order type must be an array.',
            'array.min': 'At least one order type must be selected.',
            'any.required': 'Order type is required.'
        }),

    active: joi.boolean().required().messages({
        'boolean.base': 'Active must be true or false.',
        'any.required': 'Active status is required.'
    }),
    menu_ids: joi.array()
        .items(joi.number().greater(0).messages({
            'any.greater': 'Wrong Menu Item Select',
            'number.base': 'Each Menu Item Must Be Valid.'
        }))
        .required()
        .messages({
            'array.base': 'Menu Item must be an array.',
            'any.required': 'Menu Items is required.'
        }),
    table_categ_ids: joi.array()
        .items(joi.number().greater(0).messages({
            'any.greater': 'Wrong Area Select',
            'number.base': 'Each Area Must Be Valid.'
        }))
        .required()
        .messages({
            'array.base': 'Area must be an array.',
            'any.required': 'Area is required.'
        })
});

const taxTypeEditValidation = joi.object({
    id: joi.number().greater(0).required().messages({
        'number.required': "Id Must Be Required",
        'number.base': 'Id must be a number.',
        'number.greater': 'Id must be greater than 0.'
    }),
    tax_name: joi.string().optional().messages({
        'string.base': 'Tax name must be a string.',
        'string.empty': 'Tax name cannot be empty.'
    }),

    tax_value: joi.string()
        .valid("fix", "pr")
        .required()
        .messages({
            'any.only': 'Tax value must be either "fix" or "persentage".',
            'any.required': 'Tax value is required.',
            'string.base': 'Tax value must be a string.'
        }),

    amount: joi.number().greater(0).optional().messages({
        'number.base': 'Amount must be a number.',
        'number.greater': 'Amount must be greater than 0.'
    }),

    order_type: joi.array()
        .items(joi.string().valid('pickup', 'dinin').messages({
            'any.only': 'Order type must be either pickup or dinin.',
            'string.base': 'Each order type must be a string.'
        }))
        .min(1)
        .required()
        .messages({
            'array.base': 'Order type must be an array.',
            'array.min': 'At least one order type must be selected.',
            'any.required': 'Order type is required.'
        }),

    active: joi.boolean().optional().messages({
        'boolean.base': 'Active must be true or false.'
    }),
    menu_ids: joi.array()
        .items(joi.number().greater(0).messages({
            'any.greater': 'Wrong Menu Item Select',
            'number.base': 'Each Menu Item Must Be Valid.'
        }))
        .required()
        .messages({
            'array.base': 'Menu Item must be an array.',
            'any.required': 'Menu Items is required.'
        }),
    table_categ_ids: joi.array()
        .items(joi.number().greater(0).messages({
            'any.greater': 'Wrong Area Select',
            'number.base': 'Each Area Must Be Valid.'
        }))
        .required()
        .messages({
            'array.base': 'Area must be an array.',
            'any.required': 'Area is required.'
        })
});

const purchaseValidationSchema = joi.object({
    name: joi.string().trim().min(2).max(100).required(),
    mobile: joi.string()
        .pattern(/^[0-9]{10}$/) // only 10 digit numbers
        .required(),
    address1: joi.string().trim().max(255).required(),
    email: joi.string().email().max(255).required(),
    address2: joi.string().trim().max(255).allow(null, ""), // optional
    city: joi.string().trim().max(100).required(),
    state: joi.string().trim().max(100).required(),
    Country: joi.string().trim().max(100).optional().allow(null, ""),
    pincode: joi.string()
        .pattern(/^[0-9]{5,10}$/) // India 6 digits, but flexible
        .required(),
    items: joi.array()
        .items(
            joi.object({
                id: joi.number().integer().optional(),
                image: joi.string().trim().optional(),
                title: joi.string().trim().optional(),
                quantity: joi.number().min(1).optional(),
                price: joi.number().min(0).optional(),
            })
        )
        .min(1)
        .required(),
    subtotal: joi.number().min(0).required(),
    gst: joi.number().min(0).required(),
    grandAmount: joi.number().min(0).required(),
});

const websitePurchasevalidation1 = joi.object({
    // hotel_name: joi.string().trim().min(2).max(150).required().messages({
    //     "any.required": "Hotel name is required",
    //     "string.empty": "Hotel name is required",
    //     "string.min": "Hotel name must be at least 2 characters",
    //     "string.max": "Hotel name cannot exceed 150 characters"
    // }),
    // refer_code: joi.string().trim().max(50).optional().allow('').messages({
    //     "string.max": "Refer code cannot exceed 50 characters"
    // }),
    name: joi.string().trim().min(2).max(100).required().messages({
        "any.required": "Name is required",
        "string.empty": "Name is required",
        "string.min": "Name must be at least 2 characters",
        "string.max": "Name cannot exceed 100 characters"
    }),
    plan_id: joi.number().required().messages({
        "any.required": "Plan Id is required",
        "number.base": "Plan Id must be a valid number"
    }),
    mobile: joi.string()
        .pattern(/^[0-9]{10}$/)
        .required()
        .messages({
            "any.required": "Mobile number is required",
            "string.empty": "Mobile number is required",
            "string.pattern.base": "Mobile number must be a valid 10-digit number"
        }),
    email: joi.string().email().required().messages({
        "any.required": "Email is required",
        "string.empty": "Email is required",
        "string.email": "Email must be a valid email address"
    }),
    // password: joi.string().min(6).max(50).required().messages({
    //     "any.required": "Password is required",
    //     "string.empty": "Password is required",
    //     "string.min": "Password must be at least 6 characters long",
    //     "string.max": "Password cannot exceed 50 characters"
    // }),
    // pincode: joi.string()
    //     .pattern(/^[0-9]{5,10}$/)
    //     .required()
    //     .messages({
    //         "any.required": "Pincode is required",
    //         "string.empty": "Pincode is required",
    //         "string.pattern.base": "Pincode must be between 5 to 10 digits"
    //     }),
    // address1: joi.string().trim().max(255).optional().messages({
    //     "string.max": "Address1 cannot exceed 255 characters"
    // }),
    // address2: joi.string().trim().max(255).optional().messages({
    //     "string.max": "Address2 cannot exceed 255 characters"
    // })
});
const websitePurchasevalidation = joi.object({
    hotel_name: joi.string().trim().min(2).max(150).required().messages({
        "any.required": "Hotel name is required",
        "string.empty": "Hotel name is required",
        "string.min": "Hotel name must be at least 2 characters",
        "string.max": "Hotel name cannot exceed 150 characters"
    }),
    refer_code: joi.string().trim().max(50).optional().allow('').messages({
        "string.max": "Refer code cannot exceed 50 characters"
    }),
    name: joi.string().trim().min(2).max(100).required().messages({
        "any.required": "Name is required",
        "string.empty": "Name is required",
        "string.min": "Name must be at least 2 characters",
        "string.max": "Name cannot exceed 100 characters"
    }),
    plan_id: joi.number().required().messages({
        "any.required": "Plan Id is required",
        "number.base": "Plan Id must be a valid number"
    }),
    mobile: joi.string()
        .pattern(/^[0-9]{10}$/)
        .required()
        .messages({
            "any.required": "Mobile number is required",
            "string.empty": "Mobile number is required",
            "string.pattern.base": "Mobile number must be a valid 10-digit number"
        }),
    email: joi.string().email().required().messages({
        "any.required": "Email is required",
        "string.empty": "Email is required",
        "string.email": "Email must be a valid email address"
    }),
    password: joi.string().min(6).max(50).required().messages({
        "any.required": "Password is required",
        "string.empty": "Password is required",
        "string.min": "Password must be at least 6 characters long",
        "string.max": "Password cannot exceed 50 characters"
    }),
    pincode: joi.string()
        .pattern(/^[0-9]{5,10}$/)
        .required()
        .messages({
            "any.required": "Pincode is required",
            "string.empty": "Pincode is required",
            "string.pattern.base": "Pincode must be between 5 to 10 digits"
        }),
    address1: joi.string().trim().max(255).optional().messages({
        "string.max": "Address1 cannot exceed 255 characters"
    }),
    address2: joi.string().trim().max(255).optional().messages({
        "string.max": "Address2 cannot exceed 255 characters"
    })
});

const websitePurchaseUpdateValidation = joi.object({
    id: joi.number().min(1).required().messages({
        "number.base": "Id must be a number",
        "number.min": "Id must be greater than 0",
        "any.required": "Id is required"
    }),
    hotel_name: joi.string().trim().min(2).max(150).required().messages({
        "string.empty": "Hotel name is required",
        "string.min": "Hotel name must be at least 2 characters",
        "string.max": "Hotel name cannot exceed 150 characters"
    }),
    name: joi.string().trim().min(2).max(100).required().messages({
        "string.empty": "Name is required",
        "string.min": "Name must be at least 2 characters",
        "string.max": "Name cannot exceed 100 characters"
    }),
    mobile: joi.string()
        .pattern(/^[0-9]{10}$/)
        .required()
        .messages({
            "string.empty": "Mobile number is required",
            "string.pattern.base": "Mobile number must be a valid 10-digit number"
        }),
    email: joi.string().email().required().messages({
        "string.empty": "Email is required",
        "string.email": "Email must be a valid email address"
    }),
    password: joi.string().min(6).max(50).required().messages({
        "string.empty": "Password is required",
        "string.min": "Password must be at least 6 characters long",
        "string.max": "Password cannot exceed 50 characters"
    }),
    pincode: joi.string()
        .pattern(/^[0-9]{5,10}$/)
        .required()
        .messages({
            "string.empty": "Pincode is required",
            "string.pattern.base": "Pincode must be between 5 to 10 digits"
        }),
    address1: joi.string().trim().max(255).required().messages({
        "string.empty": "Address1 is required",
        "string.max": "Address1 cannot exceed 255 characters"
    }),
    address2: joi.string().trim().max(255).required().messages({
        "string.empty": "Address2 is required",
        "string.max": "Address2 cannot exceed 255 characters"
    })
});

const planPurchaseValidation =
    joi.object(
        {
            plan_id: joi.number().required().messages(
                {
                    "any.required":
                        "Plan Id is required", "number.base": "Plan Id must be a valid number"
                }
            ),
            subtotal: joi.number().min(0).required().messages({
                "any.required": "Subtotal is required", "number.base": "Subtotal must be a valid number", "number.min": "Subtotal cannot be negative"
            }),
            grandAmount: joi.number().min(0).required().messages({
                "any.required": "Grand amount is required", "number.base": "Grand amount must be a valid number", "number.min": "Grand amount cannot be negative"
            }),
            gst: joi.number().min(0).default(0).messages({
                "number.base": "GST must be a valid number", "number.min": "GST cannot be negative"
            }),
            discount: joi.number().min(0).default(0).messages({
                "number.base": "Discount must be a valid number", "number.min": "Discount cannot be negative"
            }),
            discountType: joi.string().valid("fix", "pr").optional().messages({
                "any.only": "Discount type must be either 'Fix' or 'Pr'"
            }),
            discountValue: joi.number().min(0).default(0).messages({
                "number.base": "Discount value must be a valid number", "number.min": "Discount value cannot be negative"
            }),
            coupenCode: joi.string().trim().max(50).allow("").optional().messages({
                "string.max": "Coupon code cannot exceed 50 characters"
            }),
            temp_hotel_id: joi.number().optional().messages({
                "number.base": "Temp Hotel Id must be a valid number"
            })
        });

const westageCreateValidaionSchema = joi.array().items(
    joi.object({
        raw_material_id: joi.string().trim().required().messages({
            "string.empty": "Raw material ID is required"
        }),

        unit_id: joi.string().trim().required().messages({
            "string.empty": "Unit ID is required"
        }),

        qty: joi.number().positive().required().messages({
            "number.base": "Quantity must be a valid number",
            "number.positive": "Quantity must be greater than 0",
            "any.required": "Quantity is required"
        }),

        reason: joi.string().trim().max(255).required().messages({
            "string.empty": "Reason is required",
            "string.max": "Reason cannot exceed 255 characters"
        }),

        notes: joi.string().trim().max(500).allow(null, "").messages({
            "string.max": "Notes cannot exceed 500 characters"
        })
    })
);

module.exports = {
    websitePurchasevalidation1,
    westageCreateValidaionSchema,
    planPurchaseValidation,
    websitePurchaseUpdateValidation,
    websitePurchasevalidation,
    purchaseValidationSchema,
    taxTypeEditValidation,
    taxTypeCreateValidation,
    // Raw material consumption schemas
    recordConsumptionSchema,
    consumptionHistoryQuerySchema,
    consumptionSummaryQuerySchema,

    // Purchase Order schemas
    createPurchaseOrderSchema,
    updatePurchaseOrderSchema,
    deletePurchaseOrderSchema,

    // Existing schemas
    promoSchema,
    updatePromoCodeValidation,
    createTableSchema,
    printerSchemaEdit,
    editMenuSchema,
    updatedAddonsSchema,
    createAddonSchema,
    websiteUserSchema,
    userSchemaUpdate,
    outStockSchema,
    addRecipeSchema,
    allEntrySchema,
    deleteExpenseSchema,
    editExpenseSchema,
    addExpenseSchema,
    inOutStockSchema,
    deleteStockHiStorySchema,
    editStockHistorySchema,
    editUnitSchema,
    editRawMaterialSchema,
    addRawMaterialSchema,
    addUnitSchema,
    printerSchema,
    hotelSchema,
    restaurantLogin,
    userSchema,
    tableSchema,
    menuSchema,
    bookTable,
    paymentDoneSchema
}