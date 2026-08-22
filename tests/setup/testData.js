// ─────────────────────────────────────────────────────────────────────────────
// Realistic seed data for "The Grand Spice" restaurant
// ─────────────────────────────────────────────────────────────────────────────

const HOTEL = {
  id: 1,
  hotel_name: "The Grand Spice",
  gst_no: "27AAACR5055K1Z5",
  owner_number: 9876543210,
  address1: "123 MG Road, Pune",
};

const HOTEL_USER = {
  id: 10,
  hotel_id: 1,
  name: "Ravi Admin",
  email: "ravi@grandspice.com",
  number: "9876543210",
  active: true,
  role: "admin",
};

const CAPTAIN_USER = {
  id: 11,
  hotel_id: 1,
  name: "Suresh Waiter",
  number: "9876500001",
  role: "C",
  active: true,
  tableNumber: "T1",
};

const MOBILE_USER = {
  id: 12,
  hotel_id: 1,
  name: "Priya Cashier",
  number: "9876500002",
  active: true,
};

// Tables
const TABLE_T1 = { id: 1, tableNumber: "T1", hotel_id: 1, status: "available", capacity: 4 };
const TABLE_T2 = { id: 2, tableNumber: "T2", hotel_id: 1, status: "available", capacity: 2 };
const TABLE_T3 = { id: 3, tableNumber: "T3", hotel_id: 1, status: "running", capacity: 8 };
const TABLE_OUTDOOR = { id: 4, tableNumber: "OUT-1", hotel_id: 1, status: "available", capacity: 6 };

// Menu items
const MENU_BUTTER_CHICKEN = {
  id: 101,
  name: "Butter Chicken",
  price: 320,
  hotel_id: 1,
  category_id: 1,
  shortCode: "BC",
  available: true,
  gst: 5,
};
const MENU_PANEER_TIKKA = {
  id: 102,
  name: "Paneer Tikka",
  price: 280,
  hotel_id: 1,
  category_id: 1,
  shortCode: "PT",
  available: true,
  gst: 5,
};
const MENU_BIRYANI = {
  id: 103,
  name: "Chicken Biryani",
  price: 350,
  hotel_id: 1,
  category_id: 1,
  shortCode: "CB",
  available: true,
  gst: 5,
};
const MENU_NAAN = {
  id: 104,
  name: "Butter Naan",
  price: 40,
  hotel_id: 1,
  category_id: 2,
  shortCode: "BN",
  available: true,
  gst: 5,
};
const MENU_SOFT_DRINK = {
  id: 105,
  name: "Pepsi (250ml)",
  price: 60,
  hotel_id: 1,
  category_id: 3,
  shortCode: "SD",
  available: true,
  gst: 12,
};
const MENU_BEER = {
  id: 106,
  name: "Kingfisher Beer",
  price: 180,
  hotel_id: 1,
  category_id: 3,
  shortCode: "KF",
  available: true,
  gst: 28,
};
const MENU_UNAVAILABLE_ITEM = {
  id: 107,
  name: "Fish Curry",
  price: 299,
  hotel_id: 1,
  available: false,
  shortCode: "FC",
};

// Variants / Addons
const VARIANT_HALF_FULL = {
  id: 201,
  name: "Half / Full",
  hotel_id: 1,
  options: [
    { id: 2011, name: "Half", price: 0 },
    { id: 2012, name: "Full", price: 80 },
  ],
};

const ADDON_EXTRA_CHEESE = {
  id: 301,
  name: "Extra Cheese",
  price: 30,
  hotel_id: 1,
};

// Tax types
const TAX_5_PERCENT = { id: 1, tax_name: "GST 5%", tax_value: 5, hotel_id: 1 };
const TAX_12_PERCENT = { id: 2, tax_name: "GST 12%", tax_value: 12, hotel_id: 1 };
const TAX_18_PERCENT = { id: 3, tax_name: "GST 18%", tax_value: 18, hotel_id: 1 };
const TAX_28_PERCENT = { id: 4, tax_name: "GST 28%", tax_value: 28, hotel_id: 1 };

// Service charge
const SERVICE_CHARGE = { id: 1, hotel_id: 1, percentage: 10, active: true };

// Sample order
const ORDER_DININ = {
  id: 1001,
  hotel_id: 1,
  tableId: 1,
  order_type: "dinin",
  status: "in-progress",
  bill_no: "GS-2024-0001",
  total_amount: 640,
  tax_amount: 32,
  payable_amount: 672,
  deleted: false,
};

const ORDER_PICKUP = {
  id: 1002,
  hotel_id: 1,
  order_type: "pickup",
  status: "in-progress",
  customer_name: "Amit Shah",
  bill_no: "GS-2024-0002",
  total_amount: 350,
  payable_amount: 368,
  deleted: false,
};

const ORDER_HOLD = {
  id: 1003,
  hotel_id: 1,
  tableId: 2,
  order_type: "dinin",
  status: "hold",
  bill_no: "GS-2024-0003",
  total_amount: 280,
  deleted: false,
};

// Cart items
const CART_ITEM_1 = {
  id: 501,
  MenuId: 101,
  UserId: 11,
  TableId: 1,
  hotel_id: 1,
  qty: 2,
  totalAmount: 640,
};

const CART_ITEM_2 = {
  id: 502,
  MenuId: 104,
  UserId: 11,
  TableId: 1,
  hotel_id: 1,
  qty: 4,
  totalAmount: 160,
};

// Promo codes
const PROMO_FLAT50 = {
  id: 1,
  code: "FLAT50",
  discount: 50,
  discount_type: "flat",
  hotel_id: 1,
  active: true,
  min_amount: 200,
};
const PROMO_PERCENT10 = {
  id: 2,
  code: "SAVE10",
  discount: 10,
  discount_type: "percent",
  hotel_id: 1,
  active: true,
  min_amount: 300,
};

// Due payment
const DUE_PAYMENT = {
  id: 701,
  hotel_id: 1,
  customer_name: "Rohan Mehta",
  customer_number: "9900000001",
  due_amount: 450,
  status: "pending",
  orderId: 1001,
};

// Zomato order
const ZOMATO_ORDER = {
  id: 901,
  hotel_id: 1,
  platform: "zomato",
  external_order_id: "ZMT-2024-XYZ",
  status: "pending",
  items: [
    { name: "Butter Chicken", qty: 1, price: 320 },
    { name: "Naan", qty: 2, price: 40 },
  ],
  total_amount: 400,
};

// Expense
const EXPENSE_HEAD_UTILITIES = { id: 1, name: "Utilities", hotel_id: 1 };
const EXPENSE_ENTRY = {
  id: 1,
  head_id: 1,
  amount: 2500,
  note: "Electricity bill April",
  hotel_id: 1,
  date: "2024-04-01",
};

// Inventory
const RAW_MATERIAL_CHICKEN = {
  id: 1,
  name: "Chicken",
  unit: "kg",
  current_stock: 15,
  min_stock: 2,
  hotel_id: 1,
};
const RAW_MATERIAL_TOMATO = {
  id: 2,
  name: "Tomato",
  unit: "kg",
  current_stock: 5,
  min_stock: 1,
  hotel_id: 1,
};
const RECIPE_BUTTER_CHICKEN = {
  id: 1,
  menu_id: 101,
  hotel_id: 1,
  ingredients: [
    { raw_material_id: 1, qty: 0.25, unit: "kg" },
    { raw_material_id: 2, qty: 0.1, unit: "kg" },
  ],
};

// Printer
const PRINTER_BILLING = { id: 1, hotel_id: 1, printer_name: "BillingPrinter", ip: "192.168.1.100", port: 9100, is_default: true };
const PRINTER_KDS = { id: 2, hotel_id: 1, printer_name: "KitchenPrinter", ip: "192.168.1.101", port: 9100, is_default: false };

// Table booking
const TABLE_BOOKING = {
  id: 1,
  hotel_id: 1,
  table_id: 1,
  customer_name: "Neha Patel",
  customer_number: "9800000001",
  booking_date: "2024-04-15",
  booking_time: "19:00",
  party_size: 4,
  status: "confirmed",
};

module.exports = {
  HOTEL, HOTEL_USER, CAPTAIN_USER, MOBILE_USER,
  TABLE_T1, TABLE_T2, TABLE_T3, TABLE_OUTDOOR,
  MENU_BUTTER_CHICKEN, MENU_PANEER_TIKKA, MENU_BIRYANI,
  MENU_NAAN, MENU_SOFT_DRINK, MENU_BEER, MENU_UNAVAILABLE_ITEM,
  VARIANT_HALF_FULL, ADDON_EXTRA_CHEESE,
  TAX_5_PERCENT, TAX_12_PERCENT, TAX_18_PERCENT, TAX_28_PERCENT,
  SERVICE_CHARGE,
  ORDER_DININ, ORDER_PICKUP, ORDER_HOLD,
  CART_ITEM_1, CART_ITEM_2,
  PROMO_FLAT50, PROMO_PERCENT10,
  DUE_PAYMENT, ZOMATO_ORDER,
  EXPENSE_HEAD_UTILITIES, EXPENSE_ENTRY,
  RAW_MATERIAL_CHICKEN, RAW_MATERIAL_TOMATO, RECIPE_BUTTER_CHICKEN,
  PRINTER_BILLING, PRINTER_KDS,
  TABLE_BOOKING,
};
