const axios = require("axios")

const GRAPH_VERSION = "v22.0"
const PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN

// Meta's leadgen webhook only carries the leadgen_id — the submitted field values
// (name, phone, email, ...) must be fetched separately via the Graph API.
const fetchLeadData = async (leadgenId) => {
    const { data } = await axios.get(`https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}`, {
        params: {
            access_token: PAGE_ACCESS_TOKEN,
            fields: "field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,created_time,platform",
        },
    })
    return data
}

// field_data is an array of { name, values: [value] } pairs whose `name` keys vary per form
// (full_name / first_name+last_name, phone_number, email, ...). Map the common ones.
const mapFieldData = (fieldData = []) => {
    const get = (...keys) => {
        for (const key of keys) {
            const field = fieldData.find((f) => f.name?.toLowerCase() === key)
            if (field?.values?.length) return field.values[0]
        }
        return ""
    }

    const fullName = get("full_name") || [get("first_name"), get("last_name")].filter(Boolean).join(" ")

    return {
        name: fullName,
        phone_number: get("phone_number", "phone"),
        email: get("email"),
    }
}

module.exports = { fetchLeadData, mapFieldData }
