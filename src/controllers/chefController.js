const Order = require('../models/Order');
const Inventory = require('../models/Inventory');
const ChefInventory = require('../models/Chefinventory');
const { InventoryRequest, InventoryTransaction } = require('../models/InventoryOfficer');
const notificationService = require('../services/notificationService');
const InventoryReturnRequest = require('../models/InventoryReturnRequest');
const { getSystemSettings } = require('../utils/systemSettings');


// ══════════════════════════════════════════════════════════════════════════════
//  UNIT CONVERSION HELPER
// ══════════════════════════════════════════════════════════════════════════════
const UNIT_TO_BASE = {
  kg: 1, half_kg: 0.5, quarter_kg: 0.25, g: 0.001, gram: 0.001, grams: 0.001,
  liter: 1, litre: 1, l: 1, half_liter: 0.5, ml: 0.001, milliliter: 0.001, millilitre: 0.001,
  pieces: 1, piece: 1, pcs: 1, nos: 1,
};

const convertToInventoryUnit = (ingredientQty, ingredientUnit, inventoryUnit) => {
  const qty = parseFloat(ingredientQty) || 0;
  if (qty === 0) return 0;
  const fromUnit = (ingredientUnit || '').toLowerCase().trim();
  const toUnit = (inventoryUnit || '').toLowerCase().trim();
  if (fromUnit === toUnit) return qty;
  const fromBase = UNIT_TO_BASE[fromUnit];
  const toBase = UNIT_TO_BASE[toUnit];
  if (!fromBase || !toBase) {
    console.warn(`[UnitConvert] Unknown units: ${fromUnit} → ${toUnit}. Returning qty as-is.`);
    return qty;
  }
  return (qty * fromBase) / toBase;
};

// ══════════════════════════════════════════════════════════════════════════════
//  HELPER: aaj ki active inventory check
// ══════════════════════════════════════════════════════════════════════════════
const getTodayRange = () => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  return { today, tomorrow };
};

// ══════════════════════════════════════════════════════════════════════════════
//  ORDER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

exports.getPendingOrders = async (req, res) => {
  try {
    const { kitchenSystemEnabled } = await getSystemSettings(req.user.branchId);

    // Kitchen system OFF → chef ko koi orders nahi milne chahiyein
    if (!kitchenSystemEnabled) {
      return res.json({ success: true, orders: [], count: 0, kitchenSystemEnabled: false });
    }

    const orders = await Order.find({
      branchId: req.user.branchId,
      status: 'pending',
      items: {
        $elemMatch: {
          isColdDrink: { $ne: true },
          type: { $ne: 'cold_drink' },
        },
      },
    })
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .sort({ createdAt: 1 })
      .lean();

    res.json({ success: true, orders, count: orders.length, kitchenSystemEnabled: true });
  } catch (error) {
    console.error('getPendingOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ UPDATED: 'accepted' status hata diya — sirf preparing/ready dikhte hain
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      chefId: req.user._id,
      status: { $in: ['preparing', 'ready'] },
    })
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .sort({ acceptedAt: 1 })
      .lean();

    const ordersWithFlag = orders.map(o => ({
      ...o,
      updatedByWaiter: o.updatedByWaiter || false,
      updatedByCashier: o.updatedByCashier || false,
      waiterUpdatedAt: o.waiterUpdatedAt || null,
      waiterUpdatedBy: o.waiterUpdatedBy || null,
    }));

    res.json({ success: true, orders: ordersWithFlag, count: ordersWithFlag.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  ✅ UPDATED: acceptOrder — pehle inventory check, phir accepting
// ══════════════════════════════════════════════════════════════════════════════
exports.acceptOrder = async (req, res) => {
  try {
    const { kitchenSystemEnabled } = await getSystemSettings(req.user.branchId);
    if (!kitchenSystemEnabled) {
      return res.status(400).json({
        success: false,
        message: 'Kitchen system is disabled. Admin se enable karwayein.',
      });
    }

    const { orderId } = req.body;

    const { today, tomorrow } = getTodayRange();
    const activeInventory = await ChefInventory.findOne({
      chefId: req.user._id,
      status: 'active',
      date: { $gte: today, $lt: tomorrow },
    });

    if (!activeInventory) {
      return res.status(400).json({
        success: false,
        noInventory: true,
        message: 'Aapke paas aaj ki inventory issue nahi hui. IO se inventory lein.',
      });
    }

    const order = await Order.findById(orderId);
    if (!order)
      return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'pending')
      return res.status(400).json({ success: false, message: 'Order is not pending' });

    order.status = 'preparing';
    order.chefId = req.user._id;
    order.acceptedAt = new Date();
    order.preparingAt = new Date();
    await order.save();

    const notifyId = order.waiterId || order.deliveryBoyId;
    if (notifyId)
      await notificationService.sendOrderNotification(notifyId, order.orderNumber, 'preparing');

    const populated = await Order.findById(order._id)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name');

    res.json({ success: true, order: populated, message: 'Order accepted and preparing started' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  UPDATE ORDER STATUS
// ══════════════════════════════════════════════════════════════════════════════
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId, status, additionalDelay } = req.body;
    // NOTE: ColdDrink require HATA diya — chef cold drinks deduct nahi karta ab
    // const ColdDrink = require('../models/Colddrink'); // ← YEH LINE HATAO

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.chefId && order.chefId.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, message: 'Not authorized' });

    order.status = status;

    if (additionalDelay && parseInt(additionalDelay) > 0)
      order.additionalDelay = (order.additionalDelay || 0) + parseInt(additionalDelay);

    if (status === 'preparing') order.preparingAt = new Date();

    // ════════════════════════════════════════════════════════
    //  READY → DEDUCT FOOD INGREDIENTS ONLY + BROADCAST
    //  ✅ CHANGED: Cold drink deduction HATA diya
    //  Barman cold drinks deduct karta hai apne deliverColdDrinks action mein
    // ════════════════════════════════════════════════════════
    if (status === 'ready' && !order.stockDeducted) {
      order.readyAt = new Date();

      const { today, tomorrow } = getTodayRange();
      const chefRecord = await ChefInventory.findOne({
        chefId: req.user._id,
        status: 'active',
        date: { $gte: today, $lt: tomorrow },
      });

      let chefRecordDirty = false;

      for (const item of order.items) {
        const orderQty = item.quantity || 1;

        // ✅ CHANGED: Cold drink items SKIP karo — barman handle karta hai
        if (item.isColdDrink || item.type === 'cold_drink') {
          console.log(`[Chef] Skipping cold drink item: ${item.name} — barman will handle`);
          continue;
        }

        // ── PRODUCT INGREDIENTS ─────────────────────────────────────────────
        const Product = require('../models/Product');
        let ingredients = [];

        try {
          const product = await Product.findById(item.itemId).lean();
          if (product) {
            const sizeData = product.sizes.find(s => s.size === item.size);
            if (sizeData && sizeData.ingredients && sizeData.ingredients.length > 0) {
              ingredients = sizeData.ingredients;
            }
          }
        } catch (e) {
          console.error('[Ingredients] Product fetch error:', e.message);
        }

        if (ingredients.length === 0) continue;

        for (const ing of ingredients) {
          if (!ing.inventoryItemId || !ing.quantity) continue;

          try {
            const invItem = await Inventory.findById(ing.inventoryItemId).lean();
            if (!invItem) {
              console.warn(`[Ingredients] Inventory item not found: ${ing.inventoryItemId}`);
              continue;
            }

            const ingredientQtyInInventoryUnit = convertToInventoryUnit(
              ing.quantity * orderQty,
              ing.unit || invItem.unit,
              invItem.unit
            );

            console.log(
              `[Ingredients] ${invItem.name}: ${ing.quantity * orderQty} ${ing.unit || invItem.unit}` +
              ` → ${ingredientQtyInInventoryUnit.toFixed(4)} ${invItem.unit}`
            );

            if (chefRecord) {
              const chefItem = chefRecord.items.find(
                ci => ci.inventoryItemId.toString() === ing.inventoryItemId.toString()
              );

              if (chefItem) {
                const remaining = chefItem.issuedQuantity - chefItem.usedQuantity - chefItem.returnedQuantity;
                const actualDeduct = Math.min(ingredientQtyInInventoryUnit, Math.max(remaining, 0));
                if (actualDeduct > 0) {
                  chefItem.usedQuantity += actualDeduct;
                  chefRecordDirty = true;
                  console.log(`[ChefInventory] ${invItem.name}: usedQty +${actualDeduct.toFixed(4)} ${invItem.unit}`);
                } else {
                  console.warn(`[ChefInventory] ${invItem.name}: no remaining stock for chef`);
                }
              } else {
                console.warn(`[ChefInventory] ${invItem.name} not found in chef's issued items. Skipping.`);
              }
            } else {
              console.warn(`[ChefInventory] No active record for chef ${req.user._id}. Falling back to main inventory.`);
              await Inventory.findByIdAndUpdate(ing.inventoryItemId, {
                $inc: { currentStock: -ingredientQtyInInventoryUnit },
                $push: {
                  stockHistory: { date: new Date(), quantity: ingredientQtyInInventoryUnit, type: 'out' },
                },
              });
            }
          } catch (e) {
            console.error(`[Ingredients] Error processing ingredient ${ing.inventoryItemId}:`, e.message);
          }
        }
      }

      if (chefRecord && chefRecordDirty) {
        try {
          await chefRecord.save();
          console.log('[ChefInventory] Record saved after order-ready deductions.');
        } catch (e) {
          console.error('[ChefInventory] Save error:', e.message);
        }
      }

      order.stockDeducted = true;

      // ── BROADCAST: Delivery order ready + no delivery boy ────────────────
      if (order.orderType === 'delivery' && !order.deliveryBoyId) {
        try {
          const io = req.app.get('io');
          if (io) {
            const branchIdStr = String(order.branchId);
            const populatedForBroadcast = await Order.findById(order._id)
              .populate('waiterId', 'name')
              .populate('items.itemId', 'name')
              .lean();

            io.to(`branch-${branchIdStr}`).emit('new-unassigned-delivery', {
              orderId: String(order._id),
              orderNumber: order.orderNumber,
              customerName: order.customerName,
              customerPhone: order.customerPhone,
              deliveryAddress: order.deliveryAddress,
              total: order.total,
              itemCount: order.items.length,
              items: (populatedForBroadcast.items || []).map(i => ({
                name: i.itemId?.name || i.name || 'Item',
                size: i.size,
                quantity: i.quantity,
              })),
              readyAt: new Date(),
              branchId: branchIdStr,
            });

            console.log(
              `[Chef→Broadcast] ✅ Delivery order ${order.orderNumber} READY → unassigned → broadcast to branch-${branchIdStr}`
            );
          }
        } catch (broadcastErr) {
          console.error('[Chef→Broadcast] Broadcast error (non-fatal):', broadcastErr.message);
        }
      }
    }

    await order.save();

    const notifyId = order.waiterId || order.deliveryBoyId;
    if (notifyId)
      await notificationService.sendOrderNotification(notifyId, order.orderNumber, status);

    const populated = await Order.findById(order._id)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name');

    res.json({ success: true, order: populated, message: `Order updated to ${status}` });
  } catch (error) {
    console.error('updateOrderStatus error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  ✅ NEW: COMPLETED ORDERS HISTORY (chef ke ready/delivered orders)
// ══════════════════════════════════════════════════════════════════════════════
exports.getCompletedOrders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const skip = (page - 1) * limit;

    const orders = await Order.find({
      chefId: req.user._id,
      status: { $in: ['ready', 'delivered', 'completed'] },
    })
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .sort({ readyAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Order.countDocuments({
      chefId: req.user._id,
      status: { $in: ['ready', 'delivered', 'completed'] },
    });

    res.json({
      success: true,
      orders,
      count: orders.length,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('getCompletedOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Acknowledge waiter update ────────────────────────────────────────────────
exports.acknowledgeOrderUpdate = async (req, res) => {
  try {
    const { orderId } = req.body;
    await Order.findByIdAndUpdate(orderId, {
      $set: { updatedByWaiter: false, updatedByCashier: false },
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  CHEF'S OWN INVENTORY
// ══════════════════════════════════════════════════════════════════════════════

exports.getMyInventory = async (req, res) => {
  try {
    const { today, tomorrow } = getTodayRange();

    // ✅ FIX: status filter hata diya — aaj ki koi bhi record dikhao
    // Pehle active dhundo, nahi mili toh partial_return, nahi mili toh returned
    let chefInventory = await ChefInventory.findOne({
      chefId: req.user._id,
      status: 'active',
      date: { $gte: today, $lt: tomorrow },
    }).populate('items.inventoryItemId', 'name unit currentStock');

    if (!chefInventory) {
      // Active nahi mili — partial_return dhundo
      chefInventory = await ChefInventory.findOne({
        chefId: req.user._id,
        status: 'partial_return',
        date: { $gte: today, $lt: tomorrow },
      }).populate('items.inventoryItemId', 'name unit currentStock');
    }

    if (!chefInventory) {
      // Partial return bhi nahi — returned dhundo (officer ne le liya)
      chefInventory = await ChefInventory.findOne({
        chefId: req.user._id,
        status: 'returned',
        date: { $gte: today, $lt: tomorrow },
      }).populate('items.inventoryItemId', 'name unit currentStock');
    }

    res.json({ success: true, chefInventory: chefInventory || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateItemUsage = async (req, res) => {
  try {
    const { chefInventoryId, inventoryItemId, usedQuantity } = req.body;

    const record = await ChefInventory.findOne({ _id: chefInventoryId, chefId: req.user._id });
    if (!record) return res.status(404).json({ success: false, message: 'Chef inventory not found' });

    const item = record.items.find(i => i.inventoryItemId.toString() === inventoryItemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const totalUsed = item.usedQuantity + parseFloat(usedQuantity);
    if (totalUsed + item.returnedQuantity > item.issuedQuantity)
      return res.status(400).json({ success: false, message: 'Usage exceeds issued quantity' });

    item.usedQuantity = totalUsed;
    await record.save();

    res.json({ success: true, chefInventory: record, message: 'Usage updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.returnInventory = async (req, res) => {
  try {
    const { chefInventoryId, returnItems } = req.body;

    const record = await ChefInventory.findOne({
      _id: chefInventoryId,
      chefId: req.user._id,
      status: 'active',
    });
    if (!record) return res.status(404).json({ success: false, message: 'Active chef inventory not found' });

    for (const ret of returnItems) {
      const item = record.items.find(i => i.inventoryItemId.toString() === ret.inventoryItemId);
      if (!item) continue;

      const maxReturnable = item.issuedQuantity - item.usedQuantity - item.returnedQuantity;
      const actualReturn = Math.min(parseFloat(ret.returnQuantity), maxReturnable);
      if (actualReturn <= 0) continue;

      item.returnedQuantity += actualReturn;

      await Inventory.findByIdAndUpdate(ret.inventoryItemId, {
        $inc: { currentStock: actualReturn },
        $push: { stockHistory: { date: new Date(), quantity: actualReturn, type: 'in' } },
      });

      await InventoryTransaction.create({
        itemId: ret.inventoryItemId, type: 'return',
        quantity: actualReturn, unit: item.unit,
        issuedTo: req.user._id, receivedBy: req.user._id,
        notes: `Returned by chef ${req.user.name}`, date: new Date(),
      });
    }

    const allReturned = record.items.every(
      i => i.usedQuantity + i.returnedQuantity >= i.issuedQuantity
    );
    record.status = allReturned ? 'returned' : 'partial_return';
    record.returnedAt = new Date();
    await record.save();

    res.json({ success: true, chefInventory: record, message: 'Inventory returned successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyReturnHistory = async (req, res) => {
  try {
    const records = await ChefInventory.find({
      chefId: req.user._id,
      status: { $in: ['returned', 'partial_return'] },
    })
      .populate('items.inventoryItemId', 'name unit')
      .sort({ returnedAt: -1 })
      .limit(30);

    res.json({ success: true, records });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  INVENTORY (chef view)
// ══════════════════════════════════════════════════════════════════════════════

exports.getInventory = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const inventory = await Inventory.find({ branchId, isActive: true }).sort({ name: 1 }).lean();
    const withFlags = inventory.map(item => ({
      ...item,
      isLowStock: item.currentStock <= item.minimumStock,
    }));
    res.json({ success: true, inventory: withFlags, count: withFlags.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.requestInventory = async (req, res) => {
  try {
    const { items, notes } = req.body;
    if (!items || items.length === 0)
      return res.status(400).json({ success: false, message: 'At least one item required' });

    const normalizedItems = items.map(item => ({
      inventoryItemId: item.inventoryItemId || item.itemId,
      requestedQuantity: item.requestedQuantity || item.quantity,
      unit: item.unit || 'kg',
      purpose: item.purpose || '',
    }));

    const request = await InventoryRequest.create({
      requestedBy: req.user._id,
      items: normalizedItems,
      notes,
      status: 'pending',
    });

    const populated = await InventoryRequest.findById(request._id)
      .populate('requestedBy', 'name role')
      .populate('items.inventoryItemId', 'name unit currentStock');

    res.status(201).json({ success: true, request: populated, message: 'Request submitted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyRequests = async (req, res) => {
  try {
    const requests = await InventoryRequest.find({ requestedBy: req.user._id })
      .populate('approvedBy', 'name')
      .populate('issuedBy', 'name')
      .populate('items.inventoryItemId', 'name unit currentStock')
      .sort({ requestDate: -1 });

    res.json({ success: true, requests, count: requests.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.submitReturnRequest = async (req, res) => {
  try {
    const { chefInventoryId, items, notes } = req.body;

    if (!items || items.length === 0)
      return res.status(400).json({ success: false, message: 'Kam se kam ek item zaroori hai' });

    const record = await ChefInventory.findOne({
      _id: chefInventoryId, chefId: req.user._id, status: 'active',
    });
    if (!record)
      return res.status(404).json({ success: false, message: 'Active inventory record nahi mili' });

    for (const ret of items) {
      const item = record.items.find(i => i.inventoryItemId.toString() === ret.inventoryItemId);
      if (!item)
        return res.status(400).json({ success: false, message: `Item nahi mila: ${ret.inventoryItemId}` });

      const maxReturn = item.issuedQuantity - item.usedQuantity - item.returnedQuantity;
      if (parseFloat(ret.returnQuantity) > maxReturn)
        return res.status(400).json({
          success: false,
          message: `${item.name}: max returnable ${maxReturn} ${item.unit}`,
        });
    }

    const returnRequest = await InventoryReturnRequest.create({
      chefId: req.user._id, chefInventoryId,
      branchId: req.user.branchId, items, notes,
    });

    res.status(201).json({
      success: true, returnRequest,
      message: 'Return request submit ho gayi. Officer approve karega.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyReturnRequests = async (req, res) => {
  try {
    const requests = await InventoryReturnRequest.find({ chefId: req.user._id })
      .populate('items.inventoryItemId', 'name unit')
      .sort({ createdAt: -1 });
    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;