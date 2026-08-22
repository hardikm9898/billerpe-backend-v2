const express = require('express');
const { createFranchiseOrder, getFranchiseOrders, getOrderById, updateOrderStatus, adjustOrderQty, deliverOrder, deleteFranchiseOrder, editFranchiseOrder, getFranchiseOrdersForOutlet, getRawMaterials, getOrderStats } = require('../controller/franchise/franchise');
const { adminAuth } = require('../middleware/adminAuth');
const { merchantAuth } = require('../middleware/merchantauth');

const router = express.Router();

// Franchise Side
router.post('/order', adminAuth, createFranchiseOrder);
router.get('/raw-materials', merchantAuth, getRawMaterials);

// Merchant Dashboard
router.get('/merchant/orders', merchantAuth, getFranchiseOrders);
router.get('/merchant/order/:id', merchantAuth, getOrderById);
router.put('/merchant/order/:id/status', merchantAuth, updateOrderStatus);
router.put('/merchant/order/:id/adjust', merchantAuth, adjustOrderQty);
router.put('/merchant/order/:id/deliver', merchantAuth, deliverOrder);
router.get('/merchant/orders/stats', merchantAuth, getOrderStats);

// Add these routes
router.get('/orders', adminAuth, getFranchiseOrdersForOutlet);
router.put('/order/:id/edit', adminAuth, editFranchiseOrder);
router.delete('/order/:id', adminAuth, deleteFranchiseOrder);

module.exports = router;