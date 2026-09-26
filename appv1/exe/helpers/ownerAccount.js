// COPY of billerpe-local-exe/helpers/ownerAccount.js for the POS App (Plan 2) -
// written by scripts/vendor-exe-for-appv1.py. Do not edit here: change the
// exe's file and re-run the script, so both plans keep the same rules.

const { Hotel } = require("../model");

// THE owner's own login: the staff account whose mobile is the restaurant's
// owner number (hotel_registrations.owner_number - the number the outlet was
// registered with). Not the ROLE: every outlet's owner account is seeded with
// the legacy role code "A", which managers can carry too, so the role says
// nothing about who the owner is.
//
// Owner rule, 2026-09-22: nobody can turn this account off, delete it, change
// its role or touch its permissions - not even the owner. The owner alone may
// change their own name, mobile and password.
const digits = (value) => String(value ?? "").replace(/\D/g, "");

async function ownerNumberOf(hotelId, transaction) {
    const hotel = await Hotel.findOne({ where: { id: hotelId }, attributes: ["owner_number"], transaction });
    return digits(hotel?.owner_number);
}

/** True when `user` is that outlet's owner login. */
async function isOwnerAccount(hotelId, user, transaction) {
    const owner = await ownerNumberOf(hotelId, transaction);
    return Boolean(owner) && digits(user?.number) === owner;
}

const OWNER_LOCKED_MESSAGE =
    "This is the owner's account - it can't be turned off, renamed to another role or have its permissions changed.";
const OWNER_SELF_ONLY_MESSAGE =
    "Only the owner can change their own name, mobile number or password.";

module.exports = { isOwnerAccount, ownerNumberOf, digits, OWNER_LOCKED_MESSAGE, OWNER_SELF_ONLY_MESSAGE };
