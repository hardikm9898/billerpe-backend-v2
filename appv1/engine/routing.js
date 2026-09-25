// COPY of billerpe-local-exe/helpers/kotPrinterRouting.js - the POS App (Plan 2)
// routes KOTs exactly like the exe. Keep the two identical.

// Where a KOT's items go: which KOT printers print them, and which KDS
// kitchens show them. Both use the same three filters, each set on the
// printer / kitchen in Settings, and each "empty = all":
//   order_type     - "dinin" / "pickup"
//   table_ids      - which tables (the setup screen picks them by table
//                    category; what is stored is the table ids)
//   menu_categ_ids - which menu categories
//
// Originally ported from uat-backend-v2/controller/kto.js's
// arranPrintersForKotWithTheseItems. That version called .includes() on
// the stored lists directly, which only works while they are real arrays.
// They are JSON columns, and a row that arrives through the cloud pull can
// come back as the JSON TEXT instead (the Web POS's mapRawKitchen /
// mapRawPrinter already parse both shapes for this reason). On text,
// .includes() is a substring search: table 2 matched a printer set to
// table 12, category 1 matched 11 and 21, and an unrestricted printer's
// "[]" (length 2, not empty) matched no dine-in table at all. Every list is
// normalised to real ids first and compared as whole values.

// Real array of strings, whatever shape the column came back in (array,
// JSON text, or JSON text of JSON text from a double-encoded write).
function toIdList(value) {
    let v = value;
    for (let i = 0; i < 3 && typeof v === "string"; i++) {
        try {
            v = JSON.parse(v || "[]");
        } catch {
            return [];
        }
    }
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

// Does this printer/kitchen take this order type and table at all?
function acceptsOrder(target, orderType, tableId) {
    const orderTypes = toIdList(target.order_type);
    if (orderTypes.length && !orderTypes.includes(String(orderType))) return false;
    if (orderType === "pickup") return true;
    const tableIds = toIdList(target.table_ids);
    return !tableIds.length || tableIds.includes(String(tableId));
}

// Does it take this item's category? An item with no category (a custom
// item) goes everywhere the order goes.
function acceptsItem(target, item) {
    const categIds = toIdList(target.menu_categ_ids);
    return !categIds.length || !item.menu_categ_id || categIds.includes(String(item.menu_categ_id));
}

// A custom item sent to one chosen printer/kitchen goes only there - unless
// that printer/kitchen has since been removed, then it goes where an item
// with no category goes (everywhere), so it is never silently lost.
function routedTo(targets, item, field) {
    const id = Number(item[field]);
    return id && targets.some((t) => Number(t.id) === id) ? id : null;
}

// KOT printers -> [{ printer, printerSize, items }] for the printers that
// get at least one item. An item no printer takes is not printed - that is
// the owner's configuration, same as before.
function arranPrintersForKotWithTheseItems(printers, items, order_type, table_id) {
    return printers
        .filter((printer) => acceptsOrder(printer, order_type, table_id))
        .map((printer) => ({
            printer,
            printerSize: printer.printer_size,
            items: items.filter((item) => {
                const chosen = routedTo(printers, item, "route_printer_id");
                return chosen ? Number(printer.id) === chosen : acceptsItem(printer, item);
            }),
        }))
        .filter((el) => el.items.length);
}

// KDS kitchens -> [{ kitchen, items }]. Same filters as the printers, with
// one difference: an item NO kitchen takes still goes to the first kitchen
// instead of disappearing, because on an outlet without a KOT printer the
// KDS is the only way the kitchen learns about an order. (The Web POS's
// resolveKitchen always had the same "first kitchen" fallback.)
function routeItemsToKitchens(kitchens, items, order_type, table_id) {
    if (!kitchens.length) return [];
    const sorted = [...kitchens].sort((a, b) => a.id - b.id);
    const routed = sorted.map((kitchen) => ({
        kitchen,
        items: acceptsOrder(kitchen, order_type, table_id)
            ? items.filter((item) => {
                const chosen = routedTo(kitchens, item, "route_kitchen_id");
                return chosen ? Number(kitchen.id) === chosen : acceptsItem(kitchen, item);
            })
            : [],
    }));
    const orphans = items.filter((item) => !routed.some((r) => r.items.includes(item)));
    if (orphans.length) routed[0].items = [...routed[0].items, ...orphans];
    return routed.filter((r) => r.items.length);
}

module.exports = { arranPrintersForKotWithTheseItems, routeItemsToKitchens, toIdList };
