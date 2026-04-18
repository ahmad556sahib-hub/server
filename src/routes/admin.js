const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');
const {
  getDashboard,
  getAllBranches,
  createBranch,
  updateBranch,
  deleteBranch,
  getAllUsers,
  approveUser,
  updateUserRole,
  resetUserPassword,
  getWorkerStats,
  getAllOrders,
  updateOrderStatus,
  deleteOrder,
  getAllProducts,
  deleteProduct,
  getAllDeals,
  deleteDeal,
  getAllInventory,
  deleteInventoryItem,      // ✅ NEW
  assignManagerRights,
  getManagerRights,
  getProductsPerformance,
  getWorkersPerformance,
  getHRReport,
  getFinancialReport,
  deleteUser,
  permanentDeleteUser,
  getFinanceSummary,
  getAdminExpenses,
  getSystemSettings,
  updateSystemSettings,
  getAdminTodayReport
} = require('../controllers/adminController');

router.use(protect);
router.use(checkRole(UserRole.ADMIN));

// Dashboard
router.get('/dashboard', getDashboard);

// Branches
router.get('/branches', getAllBranches);
router.post('/branches', createBranch);
router.put('/branches/:id', updateBranch);
router.delete('/branches/:id', deleteBranch);

// Users
router.get('/users', getAllUsers);
router.put('/users/:id/approve', approveUser);
router.put('/users/:id/role', updateUserRole);
router.put('/users/:id/reset-password', resetUserPassword);
router.get('/worker-stats', getWorkerStats);

// Manager Rights
router.post('/manager-rights', assignManagerRights);
router.get('/manager-rights/:id', getManagerRights);

// Orders
router.get('/orders', getAllOrders);
router.put('/orders/:id/status', updateOrderStatus);
router.delete('/orders/:id', deleteOrder);

// Products
router.get('/products', getAllProducts);
router.delete('/products/:id', deleteProduct);

// Deals
router.get('/deals', getAllDeals);
router.delete('/deals/:id', deleteDeal);

// Inventory
router.get('/inventory', getAllInventory);
router.delete('/inventory/:id', deleteInventoryItem);

router.get('/reports/products-performance', getProductsPerformance);
router.get('/reports/workers-performance', getWorkersPerformance);
router.get('/reports/hr', getHRReport);
router.get('/reports/financial', getFinancialReport);
router.delete('/users/:id', deleteUser);
router.delete('/users/:id/permanent', permanentDeleteUser);
router.get('/finance-summary', getFinanceSummary);
router.get('/expenses', getAdminExpenses);
router.get('/today-report', getAdminTodayReport);
router.get('/system-settings/:branchId',  getSystemSettings);
router.put('/system-settings/:branchId',  updateSystemSettings);

module.exports = router;