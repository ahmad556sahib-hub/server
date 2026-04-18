const User = require('../models/User');
const Branch = require('../models/Branch');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Salary = require('../models/Salary');
const Attendance = require('../models/Attendance');
const Inventory = require('../models/Inventory');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const bcrypt = require('bcryptjs');
const { getMonthDateRange } = require('../utils/dateHelpers');
const Table = require('../models/Table');
const Expense = require('../models/Expense');
const CustomerWallet = require('../models/Customerwallet');

function getAdminSessionWindow() {
  const now   = new Date();
  const hour  = now.getHours();
 
  const sessionStart = new Date(now);
  if (hour < 9) {
    // Before 9 AM: session belongs to yesterday
    sessionStart.setDate(sessionStart.getDate() - 1);
  }
  sessionStart.setHours(9, 0, 0, 0);
 
  const sessionEnd = new Date(sessionStart);
  sessionEnd.setDate(sessionEnd.getDate() + 1);
  sessionEnd.setHours(4, 0, 0, 0);
 
  return { sessionStart, sessionEnd };
}

// ========== DASHBOARD ==========
exports.getDashboard = async (req, res) => {
  try {
    const { month, year, branchId } = req.query;
    let query = {};
    if (branchId) query.branchId = branchId;
    let dateQuery = {};
    if (month && year) {
      const { startDate, endDate } = getMonthDateRange(month, year);
      dateQuery = { createdAt: { $gte: startDate, $lte: endDate } };
    }

    const totalOrders = await Order.countDocuments({ ...query, ...dateQuery });
    const completedOrders = await Order.countDocuments({ ...query, ...dateQuery, status: 'completed' });
    const pendingOrders = await Order.countDocuments({ ...query, ...dateQuery, status: 'pending' });
    const orderCompletionRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;

    const revenueData = await Payment.aggregate([
      { $match: { ...query, ...(dateQuery.createdAt && { createdAt: dateQuery.createdAt }), status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueData.length > 0 ? revenueData[0].total : 0;

    let salaryQuery = { ...query };
    if (month && year) { salaryQuery.month = parseInt(month); salaryQuery.year = parseInt(year); }
    const salariesData = await Salary.aggregate([
      { $match: salaryQuery },
      { $group: { _id: null, total: { $sum: '$totalSalary' } } }
    ]);
    const totalSalaries = salariesData.length > 0 ? salariesData[0].total : 0;

    const inventoryData = await Inventory.aggregate([
      { $match: { ...(branchId ? { branchId } : {}), isActive: true } },
      { $project: { totalValue: { $multiply: ['$currentStock', { $ifNull: ['$averageCost', '$pricePerUnit'] }] } } },
      { $group: { _id: null, total: { $sum: '$totalValue' } } }
    ]);
    const totalInventoryCost = inventoryData.length > 0 ? inventoryData[0].total : 0;

    const totalExpenses = totalSalaries + (totalInventoryCost * 0.1);
    const profit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 100) : 0;

    const totalWorkers = await User.countDocuments({ ...query, role: { $ne: 'admin' } });
    const activeWorkers = await User.countDocuments({ ...query, isActive: true, isApproved: true, role: { $ne: 'admin' } });
    const inactiveWorkers = await User.countDocuments({ ...query, isActive: false, role: { $ne: 'admin' } });
    const pendingWorkers = await User.countDocuments({ ...query, isApproved: false, isActive: true, role: { $ne: 'admin' } });

    const totalProducts = await Product.countDocuments({ ...(branchId ? { branchId } : {}), isAvailable: true });
    const totalBranches = await Branch.countDocuments({});
    const activeBranches = await Branch.countDocuments({ isActive: true });
    const inactiveBranches = await Branch.countDocuments({ isActive: false });

    let attendanceQuery = { ...(branchId ? { branchId } : {}) };
    if (month && year) {
      const { startDate, endDate } = getMonthDateRange(month, year);
      attendanceQuery.date = { $gte: startDate, $lte: endDate };
    }
    const attendanceSummary = await Attendance.aggregate([
      { $match: attendanceQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const attendanceCounts = { present: 0, absent: 0, half_day: 0, leave: 0 };
    attendanceSummary.forEach(item => { attendanceCounts[item._id] = item.count; });
    const presentDays = attendanceCounts.present;
    const absentDays = attendanceCounts.absent;
    const totalAttendanceDays = presentDays + absentDays + attendanceCounts.half_day;
    const attendanceRate = totalAttendanceDays > 0 ? Math.round((presentDays / totalAttendanceDays) * 100) : 0;

    const lowStockItems = await Inventory.countDocuments({
      ...(branchId ? { branchId } : {}), isActive: true,
      $expr: { $lte: ['$currentStock', '$minimumStock'] }
    });

    const recentOrders = await Order.find({ ...query, ...dateQuery })
      .populate('waiterId chefId deliveryBoyId', 'name')
      .populate('branchId', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        totalOrders, completedOrders, pendingOrders, orderCompletionRate,
        totalRevenue, totalExpenses, totalSalaries, totalInventoryCost,
        profit, loss: profit < 0 ? Math.abs(profit) : 0, profitMargin,
        totalWorkers, activeWorkers, inactiveWorkers, pendingWorkers,
        totalProducts, totalBranches, activeBranches, inactiveBranches, lowStockItems,
        presentDays, absentDays, attendanceRate, attendance: attendanceCounts,
        recentOrders
      }
    });
  } catch (error) {
    console.error('Dashboard Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== BRANCHES ==========
exports.getAllBranches = async (req, res) => {
  try {
    const branches = await Branch.find().populate('managerId', 'name email managerRights');
    res.json({ success: true, branches });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.createBranch = async (req, res) => {
  try {
    const branch = await Branch.create(req.body);
    res.status(201).json({ success: true, branch });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.updateBranch = async (req, res) => {
  try {
    const branch = await Branch.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, branch });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.deleteBranch = async (req, res) => {
  try {
    await Branch.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Branch deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== USERS ==========
exports.getAllUsers = async (req, res) => {
  try {
    const { role, branchId } = req.query;
    let query = {};
    if (role) query.role = role;
    if (branchId) query.branchId = branchId;
    const users = await User.find(query).select('-password').populate('branchId', 'name city');
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isApproved: true, approvedBy: req.user._id },
      { new: true }
    ).select('-password');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id, { role, isApproved: false }, { new: true }
    ).select('-password');
    res.json({ success: true, user, message: 'Role updated, pending admin approval' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ FIXED: resetUserPassword
exports.resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: `Password reset successfully for ${user.name}`,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('resetUserPassword Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== MANAGER RIGHTS ==========
const DEFAULT_RIGHTS = {
  orders: false, parcel: false, staff: false, inventory: false,
  products: false, deals: false, reports: false, hr: false, fullControl: false
};

exports.getManagerRights = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('name email role managerRights branchId')
      .populate('branchId', 'name city');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let managerRights = { ...DEFAULT_RIGHTS };
    if (user.managerRights) {
      const raw = typeof user.managerRights.toObject === 'function'
        ? user.managerRights.toObject()
        : user.managerRights;
      const { _id, __v, ...cleanRights } = raw;
      managerRights = { ...DEFAULT_RIGHTS, ...cleanRights };
    }

    res.json({
      success: true,
      user: {
        _id: user._id, name: user.name, email: user.email,
        role: user.role, branchId: user.branchId, managerRights
      }
    });
  } catch (error) {
    console.error('getManagerRights Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.assignManagerRights = async (req, res) => {
  try {
    const { userId, rights } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });
    if (!rights) return res.status(400).json({ success: false, message: 'rights are required' });

    const targetUser = await User.findById(userId);
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

    let resolvedRights = { ...DEFAULT_RIGHTS, ...rights };
    if (rights.fullControl) {
      resolvedRights = {
        orders: true, parcel: true, staff: true, inventory: true,
        products: true, deals: true, reports: true, hr: true, fullControl: true
      };
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { managerRights: resolvedRights } },
      { new: true, runValidators: false }
    ).select('-password').populate('branchId', 'name');

    res.json({ success: true, message: `Rights updated for ${user.name}`, user, assignedRights: resolvedRights });
  } catch (error) {
    console.error('assignManagerRights Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== WORKER STATS ==========
exports.getWorkerStats = async (req, res) => {
  try {
    const { userId, month, year } = req.query;
    if (!userId || !month || !year) {
      return res.status(400).json({ success: false, message: 'userId, month, and year are required' });
    }
    const { startDate, endDate } = getMonthDateRange(month, year);
    const user = await User.findById(userId).select('-password').populate('branchId', 'name city');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const ordersQuery = {
      $or: [{ waiterId: userId }, { deliveryBoyId: userId }, { chefId: userId }, { cashierId: userId }],
      createdAt: { $gte: startDate, $lte: endDate }
    };
    const totalOrders = await Order.countDocuments(ordersQuery);
    const completedOrders = await Order.countDocuments({ ...ordersQuery, status: 'completed' });
    const recentOrders = await Order.find(ordersQuery)
      .populate('branchId', 'name').sort({ createdAt: -1 }).limit(20);

    const attendance = await Attendance.find({ userId, date: { $gte: startDate, $lte: endDate } }).sort({ date: -1 });
    const totalHours = attendance.reduce((sum, att) => sum + (att.hoursWorked || 0), 0);
    const presentDays = attendance.filter(a => a.status === 'present').length;
    const absentDays = attendance.filter(a => a.status === 'absent').length;
    const halfDays = attendance.filter(a => a.status === 'half_day').length;
    const leaveDays = attendance.filter(a => a.status === 'leave').length;

    const salary = await Salary.findOne({ userId, month: parseInt(month), year: parseInt(year) });

    let managerRights = null;
    if (user.role === 'manager') {
      managerRights = user.managerRights
        ? (typeof user.managerRights.toObject === 'function' ? user.managerRights.toObject() : user.managerRights)
        : DEFAULT_RIGHTS;
    }

    res.json({
      success: true,
      stats: {
        user: {
          _id: user._id, name: user.name, email: user.email, role: user.role,
          phone: user.phone, hourlyRate: user.hourlyRate, branch: user.branchId,
          joinDate: user.joinDate, isActive: user.isActive, isApproved: user.isApproved,
          managerRights
        },
        orders: { total: totalOrders, completed: completedOrders, recentOrders },
        attendance: {
          totalHours: Math.round(totalHours * 10) / 10,
          presentDays, absentDays, halfDays, leaveDays, totalDays: attendance.length
        },
        salary: salary || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== PRODUCTS ==========
exports.getAllProducts = async (req, res) => {
  try {
    const { branchId } = req.query;
    let query = {};
    if (branchId) query.branchId = branchId;
    const products = await Product.find(query)
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('sizes.ingredients.inventoryItemId', 'name currentStock unit');
    res.json({ success: true, products, count: products.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.deleteProduct = async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, { isAvailable: false });
    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DEALS ==========
exports.getAllDeals = async (req, res) => {
  try {
    const { branchId } = req.query;
    let query = {};
    if (branchId) query.branchId = branchId;
    const deals = await Deal.find(query)
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('products.productId', 'name');
    res.json({ success: true, deals, count: deals.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.deleteDeal = async (req, res) => {
  try {
    await Deal.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Deal deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== INVENTORY ==========
exports.getAllInventory = async (req, res) => {
  try {
    const { branchId, category } = req.query;
    let query = { isActive: true };
    if (branchId) query.branchId = branchId;
    if (category) query.category = category;
    const inventory = await Inventory.find(query).populate('branchId', 'name').sort({ name: 1 });
    const totalValue = inventory.reduce((sum, i) => sum + (i.currentStock * (i.averageCost || i.pricePerUnit)), 0);
    const lowStockCount = inventory.filter(i => i.currentStock <= i.minimumStock).length;
    res.json({ success: true, inventory, statistics: { totalItems: inventory.length, totalValue, lowStockCount } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ NEW: Admin kisi bhi branch ka inventory item delete kar sakta hai
exports.deleteInventoryItem = async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!item) return res.status(404).json({ success: false, message: 'Inventory item not found' });
    res.json({ success: true, message: `"${item.name}" deleted successfully` });
  } catch (error) {
    console.error('Admin deleteInventoryItem Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== ORDERS ==========
exports.getAllOrders = async (req, res) => {
  try {
    const { branchId, status, startDate, endDate } = req.query;
    let query = {};
    if (branchId) query.branchId = branchId;
    if (status) query.status = status;
    if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      const end = new Date(endDate); end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }
    const orders = await Order.find(query)
      .populate('branchId', 'name')
      .populate('waiterId chefId deliveryBoyId cashierId', 'name role')
      .sort({ createdAt: -1 }).lean();
    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // ✅ 1. Table free karo — sirf dine_in orders ke liye
    if (order.orderType === 'dine_in' && order.tableNumber && order.branchId) {
      await Table.findOneAndUpdate(
        {
          branchId: order.branchId,
          tableNumber: order.tableNumber,
          ...(order.floor ? { floor: order.floor } : {}),
        },
        {
          isOccupied: false,
          currentOrderId: null,
        }
      );
    }

    // ✅ 2. Payment records delete karo
    await Payment.deleteMany({ orderId: order._id });

    // ✅ 3. Order permanently delete karo
    await Order.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Order permanently deleted, table freed, payment records removed',
    });
  } catch (error) {
    console.error('deleteOrder Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });
    const validStatuses = ['pending', 'accepted', 'preparing', 'ready', 'delivered', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const updateData = { status };
    const tsMap = { accepted: 'acceptedAt', preparing: 'preparingAt', ready: 'readyAt', delivered: 'deliveredAt', completed: 'completedAt' };
    if (tsMap[status]) updateData[tsMap[status]] = new Date();
    const order = await Order.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      .populate('branchId waiterId chefId deliveryBoyId cashierId', 'name');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getProductsPerformance = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let matchQuery = { status: 'completed' };

    if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      const end = new Date(endDate); end.setHours(23, 59, 59, 999);
      matchQuery.createdAt = { $gte: start, $lte: end };
    }

    const orders = await Order.find(matchQuery).lean();

    const productMap = {};
    let totalItemsSold = 0;

    orders.forEach(order => {
      (order.items || []).forEach(item => {
        const key = `${item.name}__${item.size || ''}__${item.type}`;
        if (!productMap[key]) {
          productMap[key] = {
            name: item.name,
            size: item.size || '-',
            type: item.type || 'product',
            quantitySold: 0,
            revenue: 0,
            orderCount: 0,
          };
        }
        productMap[key].quantitySold += item.quantity || 1;
        productMap[key].revenue += (item.price || 0) * (item.quantity || 1);
        productMap[key].orderCount += 1;
        totalItemsSold += item.quantity || 1;
      });
    });

    const products = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue);

    res.json({
      success: true,
      products,
      summary: {
        totalProducts: products.length,
        totalItemsSold,
        totalRevenue: products.reduce((s, p) => s + p.revenue, 0),
        totalOrders: orders.length,
      }
    });
  } catch (error) {
    console.error('getProductsPerformance Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getWorkersPerformance = async (req, res) => {
  try {
    const { startDate, endDate, month, year } = req.query;

    let orderDateFilter = {};
    let attDateFilter = {};
    let salaryFilter = {};

    if (month && year) {
      const { startDate: s, endDate: e } = getMonthDateRange(month, year);
      orderDateFilter = { createdAt: { $gte: s, $lte: e } };
      attDateFilter = { date: { $gte: s, $lte: e } };
      salaryFilter = { month: parseInt(month), year: parseInt(year) };
    } else if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      const end = new Date(endDate); end.setHours(23, 59, 59, 999);
      orderDateFilter = { createdAt: { $gte: start, $lte: end } };
      attDateFilter = { date: { $gte: start, $lte: end } };
    }

    const [workers, orders, attendanceRecords, salaries] = await Promise.all([
      User.find({ role: { $ne: 'admin' } })
        .select('-password')
        .populate('branchId', 'name')
        .lean(),
      Order.find(orderDateFilter).lean(),
      Attendance.find(attDateFilter).lean(),
      Salary.find(salaryFilter).lean(),
    ]);

    const workerStats = workers.map(worker => {
      const wId = worker._id.toString();

      const ordersAsWaiter = orders.filter(o => o.waiterId?.toString() === wId).length;
      const ordersAsChef = orders.filter(o => o.chefId?.toString() === wId).length;
      const ordersAsDelivery = orders.filter(o => o.deliveryBoyId?.toString() === wId).length;
      const ordersAsCashier = orders.filter(o => o.cashierId?.toString() === wId).length;

      const workerAtt = attendanceRecords.filter(a => a.userId?.toString() === wId);
      const presentDays = workerAtt.filter(a => a.status === 'present').length;
      const absentDays = workerAtt.filter(a => a.status === 'absent').length;
      const halfDays = workerAtt.filter(a => a.status === 'half_day').length;
      const leaveDays = workerAtt.filter(a => a.status === 'leave').length;
      const totalHours = workerAtt.reduce((s, a) => s + (a.hoursWorked || 0), 0);
      const totalRecorded = workerAtt.length;
      const attendanceRate = totalRecorded > 0
        ? Math.round(((presentDays + halfDays * 0.5) / totalRecorded) * 100) : 0;

      const salary = salaries.find(s => s.userId?.toString() === wId);

      return {
        _id: worker._id,
        name: worker.name,
        role: worker.role,
        email: worker.email,
        phone: worker.phone,
        branch: worker.branchId?.name || 'N/A',
        isActive: worker.isActive,
        isApproved: worker.isApproved,
        ordersAsWaiter,
        ordersAsChef,
        ordersAsDelivery,
        ordersAsCashier,
        totalOrdersHandled: ordersAsWaiter + ordersAsChef + ordersAsDelivery + ordersAsCashier,
        attendance: {
          presentDays, absentDays, halfDays, leaveDays,
          totalHours: Math.round(totalHours * 10) / 10,
          totalRecorded,
          attendanceRate,
        },
        salary: salary ? {
          totalSalary: salary.totalSalary,
          baseSalary: salary.baseSalary,
          bonus: salary.bonus,
          deductions: salary.deductions,
          isPaid: salary.isPaid,
          paidDate: salary.paidDate,
        } : null,
      };
    });

    res.json({ success: true, workers: workerStats, total: workerStats.length });
  } catch (error) {
    console.error('getWorkersPerformance Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getHRReport = async (req, res) => {
  try {
    const { month, year } = req.query;
    if (!month || !year)
      return res.status(400).json({ success: false, message: 'month and year are required' });

    const { startDate, endDate } = getMonthDateRange(month, year);

    const [workers, attendanceRecords, salaries] = await Promise.all([
      User.find({ role: { $ne: 'admin' } })
        .select('-password')
        .populate('branchId', 'name')
        .lean(),
      Attendance.find({ date: { $gte: startDate, $lte: endDate } }).lean(),
      Salary.find({ month: parseInt(month), year: parseInt(year) }).lean(),
    ]);

    const hrData = workers.map(worker => {
      const wId = worker._id.toString();
      const workerAtt = attendanceRecords.filter(a => a.userId?.toString() === wId);
      const salary = salaries.find(s => s.userId?.toString() === wId);

      const present = workerAtt.filter(a => a.status === 'present').length;
      const absent = workerAtt.filter(a => a.status === 'absent').length;
      const halfDay = workerAtt.filter(a => a.status === 'half_day').length;
      const leave = workerAtt.filter(a => a.status === 'leave').length;
      const totalHours = workerAtt.reduce((s, a) => s + (a.hoursWorked || 0), 0);
      const totalRecorded = workerAtt.length;
      const attRate = totalRecorded > 0
        ? Math.round(((present + halfDay * 0.5) / totalRecorded) * 100) : 0;

      return {
        _id: worker._id,
        name: worker.name,
        role: worker.role,
        branch: worker.branchId?.name || 'N/A',
        wageType: worker.wageType,
        isActive: worker.isActive,
        isApproved: worker.isApproved,
        attendance: { present, absent, halfDay, leave, totalHours: Math.round(totalHours), totalRecorded, attRate },
        salary: salary ? {
          baseSalary: salary.baseSalary,
          bonus: salary.bonus,
          deductions: salary.deductions,
          totalSalary: salary.totalSalary,
          isPaid: salary.isPaid,
          paidDate: salary.paidDate,
        } : null,
      };
    });

    const totalPaid = salaries.filter(s => s.isPaid).reduce((sum, s) => sum + s.totalSalary, 0);
    const totalUnpaid = salaries.filter(s => !s.isPaid).reduce((sum, s) => sum + s.totalSalary, 0);
    const totalPresent = attendanceRecords.filter(a => a.status === 'present').length;
    const totalAbsent = attendanceRecords.filter(a => a.status === 'absent').length;
    const totalHoursAll = attendanceRecords.reduce((s, a) => s + (a.hoursWorked || 0), 0);

    res.json({
      success: true,
      hrData,
      summary: {
        totalWorkers: workers.length,
        totalPaidSalaries: totalPaid,
        totalUnpaidSalaries: totalUnpaid,
        salaryGenerated: salaries.length,
        totalPresent,
        totalAbsent,
        totalHours: Math.round(totalHoursAll),
      }
    });
  } catch (error) {
    console.error('getHRReport Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.getFinancialReport = async (req, res) => {
  try {
    const { year, month, startDate, endDate } = req.query;

    const MONTH_NAMES = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    let periods = [];

    if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      const end = new Date(endDate); end.setHours(23, 59, 59, 999);
      periods = [{ label: `${startDate} → ${endDate}`, startDate: start, endDate: end, isCustom: true }];
    } else if (month && year) {
      const { startDate: s, endDate: e } = getMonthDateRange(month, year);
      periods = [{ label: `${MONTH_NAMES[parseInt(month) - 1]} ${year}`, startDate: s, endDate: e, month: parseInt(month), year: parseInt(year) }];
    } else if (year) {
      periods = Array.from({ length: 12 }, (_, i) => {
        const { startDate: s, endDate: e } = getMonthDateRange(i + 1, year);
        return { label: MONTH_NAMES[i], startDate: s, endDate: e, month: i + 1, year: parseInt(year) };
      });
    } else {
      return res.status(400).json({ success: false, message: 'Provide year, month+year, or startDate+endDate' });
    }

    const periodData = await Promise.all(periods.map(async (period) => {
      const createdAtFilter = { $gte: period.startDate, $lte: period.endDate };

      const [revenueData, salaryData, completedOrders, totalOrders] = await Promise.all([
        Payment.aggregate([
          { $match: { status: 'paid', createdAt: createdAtFilter } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        // For monthly/yearly: match by month+year; for custom: match by createdAt
        period.isCustom
          ? Salary.aggregate([
            { $match: { createdAt: createdAtFilter } },
            { $group: { _id: null, paid: { $sum: { $cond: ['$isPaid', '$totalSalary', 0] } }, unpaid: { $sum: { $cond: ['$isPaid', 0, '$totalSalary'] } }, total: { $sum: '$totalSalary' } } }
          ])
          : period.month && period.year
            ? Salary.aggregate([
              { $match: { month: period.month, year: period.year } },
              { $group: { _id: null, paid: { $sum: { $cond: ['$isPaid', '$totalSalary', 0] } }, unpaid: { $sum: { $cond: ['$isPaid', 0, '$totalSalary'] } }, total: { $sum: '$totalSalary' } } }
            ])
            : Promise.resolve([]),
        Order.countDocuments({ status: 'completed', createdAt: createdAtFilter }),
        Order.countDocuments({ createdAt: createdAtFilter }),
      ]);

      const revenue = revenueData[0]?.total || 0;
      const salaryTotal = salaryData[0]?.total || 0;
      const salaryPaid = salaryData[0]?.paid || 0;
      const salaryUnpaid = salaryData[0]?.unpaid || 0;
      const profit = revenue - salaryTotal;

      return {
        label: period.label,
        revenue,
        salaryTotal,
        salaryPaid,
        salaryUnpaid,
        profit,
        profitMargin: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
        completedOrders,
        totalOrders,
        avgOrderValue: completedOrders > 0 ? Math.round(revenue / completedOrders) : 0,
      };
    }));

    const totalRevenue = periodData.reduce((s, p) => s + p.revenue, 0);
    const totalSalaries = periodData.reduce((s, p) => s + p.salaryTotal, 0);
    const totalProfit = totalRevenue - totalSalaries;
    const totalOrders = periodData.reduce((s, p) => s + p.totalOrders, 0);
    const totalCompleted = periodData.reduce((s, p) => s + p.completedOrders, 0);

    res.json({
      success: true,
      periods: periodData,
      summary: {
        totalRevenue,
        totalSalaries,
        totalProfit,
        profitMargin: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : 0,
        totalOrders,
        totalCompleted,
      }
    });
  } catch (error) {
    console.error('getFinancialReport Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'admin')
      return res.status(403).json({ success: false, message: 'Admin ko delete nahi kar sakte' });

    await User.findByIdAndUpdate(req.params.id, {
      isActive: false,
      isApproved: false
    });

    res.json({ success: true, message: `${user.name} ka login band kar diya gaya` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.permanentDeleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.role === 'admin')
      return res.status(403).json({ success: false, message: 'Admin ko delete nahi kar sakte' });

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: `${user.name} permanently delete ho gaya` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getFinanceSummary = async (req, res) => {
  try {
    const { branchId, startDate, endDate, period } = req.query;

    // ── Build base queries ──
    let expQuery = {};
    let walletQuery = { isActive: true };

    if (branchId) {
      expQuery.branchId = branchId;
      walletQuery.branchId = branchId;
    }

    // ── Date range logic ──
    // period: 'today' | 'week' | 'month' | 'year' | 'custom'
    const now = new Date();
    let dateStart = null;
    let dateEnd = null;

    if (period === 'today') {
      dateStart = new Date(now); dateStart.setHours(0, 0, 0, 0);
      dateEnd = new Date(now); dateEnd.setHours(23, 59, 59, 999);
    } else if (period === 'week') {
      const day = now.getDay();                          // 0=Sun
      dateStart = new Date(now);
      dateStart.setDate(now.getDate() - day);
      dateStart.setHours(0, 0, 0, 0);
      dateEnd = new Date(now); dateEnd.setHours(23, 59, 59, 999);
    } else if (period === 'month') {
      dateStart = new Date(now.getFullYear(), now.getMonth(), 1);
      dateEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (period === 'year') {
      dateStart = new Date(now.getFullYear(), 0, 1);
      dateEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else if (period === 'custom' && startDate && endDate) {
      dateStart = new Date(startDate); dateStart.setHours(0, 0, 0, 0);
      dateEnd = new Date(endDate); dateEnd.setHours(23, 59, 59, 999);
    }

    if (dateStart && dateEnd) {
      expQuery.date = { $gte: dateStart, $lte: dateEnd };
    }

    // ── Fetch expenses (with date filter) ──
    const expenses = await Expense.find(expQuery)
      .populate('addedBy', 'name')
      .populate('branchId', 'name')
      .sort({ date: -1 })
      .limit(1000);

    // ── Fetch customer wallets (no date filter — wallets are current balance) ──
    const customers = await CustomerWallet.find(walletQuery)
      .select('-transactions')
      .populate('branchId', 'name')
      .sort({ name: 1 });

    // ── Compute wallet totals ──
    const totalAdvance = customers.filter(c => c.balance > 0).reduce((s, c) => s + c.balance, 0);
    const totalDebt = customers.filter(c => c.balance < 0).reduce((s, c) => s + Math.abs(c.balance), 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    const expenseByCategory = expenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {});

    const expenseByBranch = expenses.reduce((acc, e) => {
      const bn = e.branchId?.name || 'Unknown';
      acc[bn] = (acc[bn] || 0) + e.amount;
      return acc;
    }, {});

    // ── Monthly breakdown (for charts / yearly view) ──
    const monthlyBreakdown = {};
    expenses.forEach(e => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyBreakdown[key] = (monthlyBreakdown[key] || 0) + e.amount;
    });

    res.json({
      success: true,
      expenses,
      wallet: {
        summary: {
          totalCustomers: customers.length,
          totalAdvance,
          totalDebt,
          debtCustomers: customers.filter(c => c.balance < 0).length,
          advanceCustomers: customers.filter(c => c.balance > 0).length,
          netBalance: totalAdvance - totalDebt,
        },
        customers,
      },
      summary: {
        totalExpenses,
        expenseByCategory,
        expenseByBranch,
        expenseCount: expenses.length,
        monthlyBreakdown,
      },
      // Echo back applied filter for frontend awareness
      appliedFilter: {
        period: period || 'all',
        startDate: dateStart,
        endDate: dateEnd,
        branchId: branchId || null,
      },
    });
  } catch (error) {
    console.error('getFinanceSummary Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminExpenses = async (req, res) => {
  try {
    const { startDate, endDate, branchId } = req.query;
 
    let query = {};
 
    if (branchId) query.branchId = branchId;
 
    if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      const end   = new Date(endDate);   end.setHours(23, 59, 59, 999);
      query.date  = { $gte: start, $lte: end };
    }
 
    const expenses = await Expense.find(query)
      .populate('addedBy', 'name')
      .populate('branchId', 'name')
      .sort({ date: -1 });
 
    const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
 
    // Group by category for summary
    const byCategory = expenses.reduce((acc, e) => {
      const cat = e.category || 'Other';
      acc[cat] = (acc[cat] || 0) + e.amount;
      return acc;
    }, {});
 
    res.json({
      success:    true,
      expenses,
      total,
      byCategory,
      count:      expenses.length,
    });
  } catch (error) {
    console.error('getAdminExpenses Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAdminTodayReport = async (req, res) => {
  try {
    const { branchId } = req.query;
    const { sessionStart, sessionEnd } = getAdminSessionWindow();
 
    const branchFilter = branchId ? { branchId } : {};
 
    // ── Order / Payment filters ────────────────────────────────────
    const orderQ   = { ...branchFilter, createdAt:  { $gte: sessionStart, $lte: sessionEnd } };
    const paymentQ = { ...branchFilter, paidAt:     { $gte: sessionStart, $lte: sessionEnd }, status: 'paid' };
 
    // ── FIX: Expense query — match date OR createdAt ───────────────
    // Cashier expenses may store `date` as midnight OR use createdAt
    // Using $or catches both cases
    const expenseQ = {
      ...branchFilter,
      $or: [
        { date:      { $gte: sessionStart, $lte: sessionEnd } },
        { createdAt: { $gte: sessionStart, $lte: sessionEnd } },
      ],
    };
 
    // ── Parallel fetches ───────────────────────────────────────────
    const [
      totalOrders,
      completedOrders,
      pendingOrders,
      cancelledOrders,
      orders,
      payments,
      expenses,
    ] = await Promise.all([
      Order.countDocuments(orderQ),
      Order.countDocuments({ ...orderQ, status: 'completed' }),
      Order.countDocuments({ ...orderQ, status: 'pending' }),
      Order.countDocuments({ ...orderQ, status: 'cancelled' }),
 
      Order.find(orderQ)
        .populate('branchId', 'name')
        .populate('waiterId chefId cashierId', 'name')
        .sort({ createdAt: -1 })
        .lean(),
 
      Payment.find(paymentQ).lean(),
 
      Expense.find(expenseQ)
        .populate('addedBy', 'name')
        .populate('branchId', 'name')
        .lean(),
    ]);
 
    // ── Revenue ────────────────────────────────────────────────────
    const totalRevenue = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const paymentMethods = payments.reduce((acc, p) => {
      const m = p.method || 'cash';
      if (!acc[m]) acc[m] = { count: 0, total: 0 };
      acc[m].count++;
      acc[m].total += p.amount || 0;
      return acc;
    }, {});
 
    // ── Expenses — deduplicate (avoid counting same expense twice if
    //    both date AND createdAt fall in range)
    const uniqueExpenses = [];
    const seenIds = new Set();
    for (const e of expenses) {
      const id = String(e._id);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        uniqueExpenses.push(e);
      }
    }
 
    const totalExpenses = uniqueExpenses.reduce((s, e) => s + (e.amount || 0), 0);
    const expenseByCategory = uniqueExpenses.reduce((acc, e) => {
      acc[e.category] = (acc[e.category] || 0) + e.amount;
      return acc;
    }, {});
    const expenseByBranch = uniqueExpenses.reduce((acc, e) => {
      const bn = e.branchId?.name || 'Unknown';
      acc[bn] = (acc[bn] || 0) + e.amount;
      return acc;
    }, {});
 
    // ── Profit / Loss ──────────────────────────────────────────────
    const profit       = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 100) : 0;
 
    // ── Products sold (non cold-drink) ─────────────────────────────
    const productMap   = {};
    let totalItemsSold = 0;
 
    orders.forEach(order => {
      (order.items || []).forEach(item => {
        if (item.isColdDrink || item.type === 'cold_drink') return;
        const key = `${item.name}__${item.size || ''}`;
        if (!productMap[key]) {
          productMap[key] = { name: item.name, size: item.size || '-', qty: 0, revenue: 0 };
        }
        productMap[key].qty     += item.quantity || 1;
        productMap[key].revenue += (item.price || 0) * (item.quantity || 1);
        totalItemsSold          += item.quantity || 1;
      });
    });
 
    const topProducts = Object.values(productMap).sort((a, b) => b.qty - a.qty);
 
    // ── Cold drinks ────────────────────────────────────────────────
    const coldDrinkMap       = {};
    let cdTotalQty           = 0;
    let cdTotalRevenue       = 0;
    let ordersWithColdDrinks = 0;
 
    orders.forEach(order => {
      const cdItems = (order.items || []).filter(i => i.isColdDrink || i.type === 'cold_drink');
      if (cdItems.length) ordersWithColdDrinks++;
      cdItems.forEach(item => {
        const key = `${item.name}__${item.size || ''}`;
        if (!coldDrinkMap[key]) {
          coldDrinkMap[key] = { name: item.name, size: item.size || '-', qty: 0, revenue: 0 };
        }
        coldDrinkMap[key].qty     += item.quantity || 1;
        coldDrinkMap[key].revenue += (item.price || 0) * (item.quantity || 1);
        cdTotalQty                += item.quantity || 1;
        cdTotalRevenue            += (item.price || 0) * (item.quantity || 1);
        totalItemsSold            += item.quantity || 1;
      });
    });
 
    const coldDrinksList = Object.values(coldDrinkMap).sort((a, b) => b.qty - a.qty);
 
    // ── Order type breakdown ───────────────────────────────────────
    const orderTypeMap = orders.reduce((acc, o) => {
      const t = o.orderType || 'unknown';
      if (!acc[t]) acc[t] = { count: 0, revenue: 0 };
      acc[t].count++;
      acc[t].revenue += o.totalAmount || o.total || 0;
      return acc;
    }, {});
 
    // ── Branch breakdown ───────────────────────────────────────────
    const branchMap = orders.reduce((acc, o) => {
      const bn = o.branchId?.name || 'Unknown';
      if (!acc[bn]) acc[bn] = { count: 0, revenue: 0, completed: 0 };
      acc[bn].count++;
      acc[bn].revenue += o.totalAmount || o.total || 0;
      if (o.status === 'completed') acc[bn].completed++;
      return acc;
    }, {});
 
    // ── Hourly revenue ─────────────────────────────────────────────
    const hourlyMap = {};
    payments.forEach(p => {
      const h = new Date(p.paidAt).getHours();
      if (!hourlyMap[h]) hourlyMap[h] = { hour: h, revenue: 0, count: 0 };
      hourlyMap[h].revenue += p.amount || 0;
      hourlyMap[h].count++;
    });
    const hourlyData = Object.values(hourlyMap).sort((a, b) => a.hour - b.hour);
 
    const avgOrderValue = completedOrders > 0 ? Math.round(totalRevenue / completedOrders) : 0;
 
    res.json({
      success: true,
      session: {
        start : sessionStart.toISOString(),
        end   : sessionEnd.toISOString(),
        label : `${sessionStart.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} – ${sessionEnd.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`,
      },
      orders: {
        total          : totalOrders,
        completed      : completedOrders,
        pending        : pendingOrders,
        cancelled      : cancelledOrders,
        completionRate : totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0,
        avgOrderValue,
        byType         : orderTypeMap,
        byBranch       : Object.entries(branchMap).map(([name, d]) => ({ name, ...d })),
        recent         : orders.slice(0, 15),
      },
      revenue: {
        total    : totalRevenue,
        byMethod : paymentMethods,
      },
      expenses: {
        total      : totalExpenses,
        count      : uniqueExpenses.length,
        byCategory : expenseByCategory,
        byBranch   : expenseByBranch,
        list       : uniqueExpenses.slice(0, 100),
      },
      inventory: {
        totalItemsSold,
        totalProducts : topProducts.length,
        topSelling    : topProducts.slice(0, 20),
      },
      coldDrinks: {
        ordersWithColdDrinks,
        totalSold  : cdTotalQty,
        revenue    : cdTotalRevenue,
        breakdown  : coldDrinksList,
      },
      profitLoss: {
        revenue      : totalRevenue,
        expenses     : totalExpenses,
        profit,
        loss         : profit < 0 ? Math.abs(profit) : 0,
        isProfit     : profit >= 0,
        profitMargin,
      },
      hourly: hourlyData,
    });
  } catch (error) {
    console.error('getAdminTodayReport Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== SYSTEM SETTINGS ==========
exports.getSystemSettings = async (req, res) => {
  try {
    const { branchId } = req.params;
    const branch = await Branch.findById(branchId)
      .select('name kitchenSystemEnabled barmanSystemEnabled');
    if (!branch)
      return res.status(404).json({ success: false, message: 'Branch not found' });

    res.json({
      success: true,
      settings: {
        branchId:              branch._id,
        branchName:            branch.name,
        kitchenSystemEnabled:  branch.kitchenSystemEnabled !== false,
        barmanSystemEnabled:   branch.barmanSystemEnabled  !== false,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSystemSettings = async (req, res) => {
  try {
    const { branchId } = req.params;
    const { kitchenSystemEnabled, barmanSystemEnabled } = req.body;

    const updateData = {};
    if (kitchenSystemEnabled !== undefined)
      updateData.kitchenSystemEnabled = Boolean(kitchenSystemEnabled);
    if (barmanSystemEnabled !== undefined)
      updateData.barmanSystemEnabled  = Boolean(barmanSystemEnabled);

    const branch = await Branch.findByIdAndUpdate(
      branchId,
      { $set: updateData },
      { new: true }
    ).select('name kitchenSystemEnabled barmanSystemEnabled');

    if (!branch)
      return res.status(404).json({ success: false, message: 'Branch not found' });

    res.json({
      success: true,
      message: 'System settings updated',
      settings: {
        branchId:              branch._id,
        branchName:            branch.name,
        kitchenSystemEnabled:  branch.kitchenSystemEnabled !== false,
        barmanSystemEnabled:   branch.barmanSystemEnabled  !== false,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
 
module.exports = exports;