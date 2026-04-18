const Inventory  = require('../models/Inventory');
const Product    = require('../models/Product');
const Deal       = require('../models/Deal');
const ColdDrink  = require('../models/Colddrink');

// Food ingredient deduction — when kitchen system is OFF
const deductFoodIngredientsForOrder = async (items) => {
  try {
    for (const item of items) {
      if (item.isColdDrink || item.type === 'cold_drink') continue;

      const itemId = item.itemId?._id || item.itemId;
      if (!itemId) continue;

      const product = await Product.findById(itemId)
        .populate('sizes.ingredients.inventoryItemId');

      if (product) {
        const sizeData = product.sizes.find(
          s => s.size.toLowerCase() === (item.size || 'medium').toLowerCase()
        );
        if (sizeData?.ingredients?.length) {
          for (const ing of sizeData.ingredients) {
            const deductQty = ing.quantity * (item.quantity || 1);
            await Inventory.findByIdAndUpdate(
              ing.inventoryItemId?._id || ing.inventoryItemId,
              { $inc: { currentStock: -deductQty } }
            );
          }
        }
        continue;
      }

      const deal = await Deal.findById(itemId).populate({
        path: 'products.productId',
        populate: { path: 'sizes.ingredients.inventoryItemId' }
      });
      if (deal) {
        for (const dp of deal.products) {
          const prod = dp.productId;
          if (!prod) continue;
          const sizeData = prod.sizes.find(
            s => s.size.toLowerCase() === (dp.size || 'medium').toLowerCase()
          );
          if (sizeData?.ingredients) {
            for (const ing of sizeData.ingredients) {
              const deductQty = ing.quantity * (dp.quantity || 1) * (item.quantity || 1);
              await Inventory.findByIdAndUpdate(
                ing.inventoryItemId?._id || ing.inventoryItemId,
                { $inc: { currentStock: -deductQty } }
              );
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[deductFood] non-fatal:', err.message);
  }
};

// Cold drink deduction from ColdDrink model — when barman system is OFF
const deductColdDrinksForOrder = async (items) => {
  try {
    const cdItems = items.filter(i => i.isColdDrink || i.type === 'cold_drink');
    for (const item of cdItems) {
      const qty = item.quantity || 1;
      if (item.coldDrinkSizeId) {
        await ColdDrink.findOneAndUpdate(
          { 'sizes._id': item.coldDrinkSizeId },
          { $inc: { 'sizes.$.currentStock': -qty } }
        );
      } else if (item.coldDrinkId) {
        const drink = await ColdDrink.findById(item.coldDrinkId);
        if (drink) {
          const variant = drink.sizes.find(s => s.size === item.size);
          if (variant) {
            variant.currentStock = Math.max(0, variant.currentStock - qty);
            await drink.save();
          }
        }
      }
    }
  } catch (err) {
    console.error('[deductColdDrinks] non-fatal:', err.message);
  }
};

module.exports = { deductFoodIngredientsForOrder, deductColdDrinksForOrder };