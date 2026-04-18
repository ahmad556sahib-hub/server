// routes/cashier.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');

const {
  getPendingOrders,
  getCompletedOrders,
  receivePayment,
  getPaymentHistory,
  getPaymentSlip,
  getHourlyIncomeReport,
  getCashierShiftReport,    // ✅ NEW
  updateOrderStatus,
  createOrder,
  createProduct,
  updateProduct,
  getProducts,
  createDeal,
  updateDeal,
  getDeals,
  getTables,
  createTable,
  updateTable,
  deleteTable,
  seedTables,
  receiveAdvancePayment,
  completeAdvancePaidOrder,
  getOrderById,
  getAmountSummary,
  addMissedOrderPayment,
  addManualPayment,
  replaceOrderPayment, 
  updateActiveOrder,
  payDeliveryBoyFuel,
  getCashierSystemInfo,
} = require('../controllers/cashierController');

const {
  getAllCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  addAdvancePayment,
  creditPurchase,
  useBalance,
  clearDebt,
  getWalletSummary,
  // ✅ NEW: Expense functions
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  getExpensesByDateTimeRange,
  

} = require('../controllers/walletController');
const deliveryController = require('../controllers/deliveryController');

const coldDrinkCtrl = require('../controllers/Colddrinkcontroller');

router.use(protect);
router.use(checkRole(UserRole.CASHIER));

// ===== ORDERS — SPECIFIC ROUTES FIRST =====
router.get('/orders/pending', getPendingOrders);
router.get('/orders/completed', getCompletedOrders);

router.post('/orders', createOrder);
router.post('/orders/:id/advance-payment', receiveAdvancePayment);
router.post('/orders/:id/complete-advance', completeAdvancePaidOrder);
router.put('/orders/:id/status', updateOrderStatus);
router.get('/orders/:id', getOrderById);

// ===== PAYMENTS =====
router.post('/payment', receivePayment);
router.get('/payments', getPaymentHistory);
router.get('/payment-slip/:id', getPaymentSlip);

// ===== REPORTS =====
router.get('/reports/hourly-income', getHourlyIncomeReport);
router.get('/reports/shift', getCashierShiftReport);   // ✅ NEW: Cashier shift slip

// ===== PRODUCTS =====
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.get('/products', getProducts);

// ===== DEALS =====
router.post('/deals', createDeal);
router.put('/deals/:id', updateDeal);
router.get('/deals', getDeals);

// ===== TABLES — /tables/seed MUST be before /:id =====
router.post('/tables/seed', seedTables);
router.get('/tables', getTables);
router.post('/tables', createTable);
router.put('/tables/:id', updateTable);
router.delete('/tables/:id', deleteTable);

// ===== COLD DRINKS =====
router.get('/cold-drinks', coldDrinkCtrl.getAllColdDrinks);

// ===== CUSTOMER WALLET — /wallet/summary MUST be before /:id =====
router.get('/wallet/summary', getWalletSummary);
router.get('/wallet', getAllCustomers);
router.get('/wallet/:id', getCustomer);
router.post('/wallet', createCustomer);
router.put('/wallet/:id', updateCustomer);
router.post('/wallet/:id/advance', addAdvancePayment);
router.post('/wallet/:id/credit', creditPurchase);
router.post('/wallet/:id/use-balance', useBalance);
router.post('/wallet/:id/clear-debt', clearDebt);

// ===== EXPENSES ✅ NEW =====
router.get('/expenses/summary', getExpenseSummary);
router.get('/expenses/range', getExpensesByDateTimeRange);
router.get('/expenses', getExpenses);
router.post('/expenses', createExpense);
router.put('/expenses/:id', updateExpense);
router.delete('/expenses/:id', deleteExpense);

router.get('/amount-summary', getAmountSummary);        // Live session breakdown
router.post('/payments/add-missed', addMissedOrderPayment);    // Missed order payment
router.post('/payments/manual-entry', addManualPayment);         // Free-form manual entry
router.post('/payments/replace', replaceOrderPayment);
router.put('/orders/:id/update-items', updateActiveOrder);
router.get('/delivery/stats',    deliveryController.getDeliveryBoyStats);
router.post('/delivery/pay-fuel', payDeliveryBoyFuel);
router.get('/system-info', getCashierSystemInfo);


module.exports = router;