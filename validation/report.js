const joi = require("joi")

const expenseReportsSchema = joi.object({
    startDate: joi.string()
        .required()
        .pattern(/^\d{2}\/\d{2}\/\d{4}$/)
        .messages({
            'any.required': 'Start date is required',
            'string.pattern.base': 'Start date must be in DD/MM/YYYY format'
        }),

    endDate: joi.string()
        .required()
        .pattern(/^\d{2}\/\d{2}\/\d{4}$/)
        .messages({
            'any.required': 'End date is required',
            'string.pattern.base': 'End date must be in DD/MM/YYYY format'
        }),

    wise: joi.string()
        .valid('day', 'week', 'month', 'year')
        .default('day')
        .messages({
            'any.only': 'Time filter must be one of: day, week, month, year'
        }),
});


module.exports = { expenseReportsSchema }