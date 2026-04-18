const Order = require('../models/Order');
const ColdDrink = require('../models/Colddrink');
const BarmanInventory = require('../models/BarmanInventory');
const BarmanColdDrinkRequest = require('../models/BarmanColdDrinkRequest');
const { getSystemSettings } = require('../utils/systemSettings');


const getTodayRange = () => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  return { today, tomorrow };
};

// ── HELPER: item cold drink hai? ─────────────────────────────────────────────
const isColdDrinkItem = (item) =>
  item.isColdDrink === true || item.type === 'cold_drink';

// ── HELPER: order mein food (non-cold-drink) items hain? ─────────────────────
const orderHasFoodItems = (order) =>
  (order.items || []).some(item => !isColdDrinkItem(item));

// ══════════════════════════════════════════════════════════════════════════════
//  GET PENDING COLD DRINK ORDERS
//  Barman ke liye — hasColdDrinks=true, coldDrinksStatus=pending
// ══════════════════════════════════════════════════════════════════════════════
exports.getPendingOrders = async (req, res) => {
  try {
    const { barmanSystemEnabled } = await getSystemSettings(req.user.branchId);

    if (!barmanSystemEnabled) {
      return res.json({ success: true, orders: [], count: 0, barmanSystemEnabled: false });
    }

    const orders = await Order.find({
      branchId: req.user.branchId,
      coldDrinksStatus: 'pending',
      status: { $nin: ['completed', 'cancelled'] },
      $or: [
        { hasColdDrinks: true },
        { 'items.isColdDrink': true },
        { 'items.type': 'cold_drink' },
      ],
    })
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('cashierId', 'name')
      .populate('items.itemId')
      .sort({ createdAt: 1 })
      .lean();

    res.json({ success: true, orders, count: orders.length, barmanSystemEnabled: true });
  } catch (error) {
    console.error('Barman getPendingOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// ══════════════════════════════════════════════════════════════════════════════
//  GET MY ACTIVE ORDERS
//  Barman ne jo orders accept ki hain aur abhi deliver nahi ki
// ══════════════════════════════════════════════════════════════════════════════
exports.getMyOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const orders = await Order.find({
      branchId,
      barmanId: req.user._id,
      coldDrinksStatus: 'delivered',
      coldDrinksDeliveredAt: { $gte: today, $lt: tomorrow },
    })
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId')
      .sort({ coldDrinksDeliveredAt: -1 })
      .lean();

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Barman getMyOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deliverColdDrinks = async (req, res) => {
  try {
    const { barmanSystemEnabled } = await getSystemSettings(req.user.branchId);
    if (!barmanSystemEnabled) {
      return res.status(400).json({
        success: false,
        message: 'Barman system is disabled. Admin se enable karwayein.',
      });
    }

    // ... baqi existing deliverColdDrinks code SAME rahega ...
    // (copy existing deliverColdDrinks body yahan)
    const { orderId } = req.body;
    if (!orderId)
      return res.status(400).json({ success: false, message: 'orderId zaroori hai' });

    const order = await Order.findById(orderId).populate('items.itemId');
    if (!order)
      return res.status(404).json({ success: false, message: 'Order nahi mili' });
    if (String(order.branchId) !== String(req.user.branchId))
      return res.status(403).json({ success: false, message: 'Yeh aapki branch ki order nahi' });
    if (!order.hasColdDrinks)
      return res.status(400).json({ success: false, message: 'Is order mein cold drinks nahi hain' });
    if (order.coldDrinksStatus === 'delivered')
      return res.status(400).json({ success: false, message: 'Cold drinks pehle hi deliver ho chuki hain' });
    if (['completed', 'cancelled'].includes(order.status))
      return res.status(400).json({ success: false, message: `Order already ${order.status} hai` });

    const { today, tomorrow } = getTodayRange();
    const issuedRecord = await BarmanInventory.findOne({
      barmanId: req.user._id,
      status: { $in: ['active', 'partial_return'] },
      date: { $gte: today, $lt: tomorrow },
    });

    if (!issuedRecord) {
      return res.status(400).json({
        success: false, noStock: true,
        message: 'Aapke paas aaj koi issued cold drinks nahi hain.',
      });
    }

    const coldDrinkItems = order.items.filter(isColdDrinkItem);

    const findIssuedItem = (item) => {
      if (item.coldDrinkId && item.coldDrinkSizeId) {
        const byId = issuedRecord.items.find(
          i => String(i.coldDrinkId) === String(item.coldDrinkId) &&
            String(i.coldDrinkSizeId) === String(item.coldDrinkSizeId)
        );
        if (byId) return byId;
      }
      const itemName = (item.name || '').trim().toLowerCase();
      const itemSize = (item.size || '').trim().toLowerCase();
      if (itemName) {
        return issuedRecord.items.find(i => {
          const iName = (i.name || '').trim().toLowerCase();
          const iSize = (i.size || '').trim().toLowerCase();
          return iName === itemName && (!itemSize || !iSize || iSize === itemSize);
        });
      }
      return null;
    };

    for (const item of coldDrinkItems) {
      const issuedItem = findIssuedItem(item);
      if (!issuedItem)
        return res.status(400).json({ success: false, noStock: true, message: `${item.name} aapki issued stock mein nahi hai.` });
      const available = issuedItem.issuedQuantity - issuedItem.deliveredQuantity - issuedItem.returnedQuantity;
      if (available < (item.quantity || 1))
        return res.status(400).json({ success: false, noStock: true, message: `${item.name} ka stock kam hai. Available: ${available}` });
    }

    const deliveredColdDrinkItems = [];
    for (const item of coldDrinkItems) {
      deliveredColdDrinkItems.push({ name: item.name || 'Cold Drink', size: item.size || null, quantity: item.quantity || 1 });
      const issuedItem = findIssuedItem(item);
      if (issuedItem) issuedItem.deliveredQuantity += (item.quantity || 1);
    }
    await issuedRecord.save();

    order.coldDrinksStatus = 'delivered';
    order.barmanId = req.user._id;
    order.coldDrinksDeliveredAt = new Date();
    const foodExists = orderHasFoodItems(order);
    if (!foodExists) { order.status = 'delivered'; order.deliveredAt = new Date(); }
    await order.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`branch-${String(order.branchId)}`).emit('cold-drinks-delivered', {
        orderId: String(order._id), orderNumber: order.orderNumber,
        barmanId: String(req.user._id), barmanName: req.user.name || 'Barman',
        coldDrinksDeliveredAt: order.coldDrinksDeliveredAt,
        newOrderStatus: order.status, coldDrinkItems: deliveredColdDrinkItems,
      });
    }

    const populated = await Order.findById(order._id)
      .populate('waiterId', 'name').populate('deliveryBoyId', 'name')
      .populate('barmanId', 'name').populate('items.itemId');

    res.json({ success: true, order: populated, message: `✅ Cold drinks deliver ho gayi order #${order.orderNumber} ke liye` });
  } catch (error) {
    console.error('deliverColdDrinks error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  GET COMPLETED ORDERS (history)
// ══════════════════════════════════════════════════════════════════════════════
exports.getCompletedOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const skip = (page - 1) * limit;

    const query = {
      branchId,
      barmanId: req.user._id,
      coldDrinksStatus: 'delivered',
    };

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('waiterId', 'name')
        .populate('deliveryBoyId', 'name')
        .populate('barmanId', 'name')
        .sort({ coldDrinksDeliveredAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);

    res.json({
      success: true,
      orders,
      count: orders.length,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Barman getCompletedOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.getColdDrinksStock = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const now = new Date();

    const drinks = await ColdDrink.find({ branchId, isActive: true })
      .sort({ company: 1, name: 1 });

    const result = drinks.map(d => ({
      _id: d._id,
      name: d.name,
      company: d.company,
      totalStock: d.sizes.reduce((s, v) => s + v.currentStock, 0),
      sizes: d.sizes.map(s => ({
        _id: s._id,
        size: s.size,
        currentStock: s.currentStock,
        minimumStock: s.minimumStock || 0,
        salePrice: s.salePrice,
        purchasePrice: s.purchasePrice,
        expiryDate: s.expiryDate || null,
        isLow: s.currentStock > 0 && s.currentStock <= (s.minimumStock || 0),
        isOut: s.currentStock === 0,
        isExpired: s.expiryDate ? new Date(s.expiryDate) <= now : false,
      })),
    }));

    const lowStockCount = result.reduce(
      (n, d) => n + d.sizes.filter(s => s.isLow).length, 0
    );
    const outOfStockCount = result.reduce(
      (n, d) => n + d.sizes.filter(s => s.isOut).length, 0
    );

    res.json({
      success: true,
      coldDrinks: result,
      count: result.length,
      summary: { lowStockCount, outOfStockCount },
    });
  } catch (error) {
    console.error('Barman getColdDrinksStock error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('barmanId', 'name')
      .populate('cashierId', 'name')
      .populate('items.itemId');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order nahi mili' });
    }

    if (String(order.branchId) !== String(req.user.branchId)) {
      return res.status(403).json({ success: false, message: 'Yeh aapki branch ki order nahi' });
    }

    res.json({ success: true, order });
  } catch (error) {
    console.error('Barman getOrderById error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// ══ NEW: Get barman's issued stock for today ═══════════════════════════════════
exports.getBarmanIssuedStock = async (req, res) => {
  try {
    const { today, tomorrow } = getTodayRange();

    const record = await BarmanInventory.findOne({
      barmanId: req.user._id,
      status: { $in: ['active', 'partial_return'] },
      date: { $gte: today, $lt: tomorrow },
    });

    res.json({ success: true, issuedStock: record || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══ NEW: Barman requests cold drinks from IO ═══════════════════════════════════
exports.requestColdDrinks = async (req, res) => {
  try {
    const { items, notes } = req.body;

    if (!items || items.length === 0)
      return res.status(400).json({ success: false, message: 'Items zaroori hain' });

    const request = await BarmanColdDrinkRequest.create({
      barmanId: req.user._id,
      branchId: req.user.branchId,
      items,
      notes,
    });

    res.status(201).json({
      success: true,
      request,
      message: 'Request inventory officer ko bhej di gayi',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};



module.exports = exports;