// What an outlet's plan includes (free printers, free rolls) and how much of
// it has been sent. Filled by the outlet setup (outlet creation with plan and
// hardware); until an outlet has a setup, its plan includes nothing.

/** How many more of this item the outlet's plan still includes. */
async function remaining(hotelId, itemId, t) {
    return 0;
}

module.exports = { remaining };
