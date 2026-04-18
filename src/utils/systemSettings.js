const Branch = require('../models/Branch');

const getSystemSettings = async (branchId) => {
  try {
    if (!branchId) return { kitchenSystemEnabled: true, barmanSystemEnabled: true };
    const branch = await Branch.findById(branchId)
      .select('kitchenSystemEnabled barmanSystemEnabled')
      .lean();
    if (!branch) return { kitchenSystemEnabled: true, barmanSystemEnabled: true };
    return {
      kitchenSystemEnabled: branch.kitchenSystemEnabled !== false,
      barmanSystemEnabled:  branch.barmanSystemEnabled  !== false,
    };
  } catch {
    return { kitchenSystemEnabled: true, barmanSystemEnabled: true };
  }
};

module.exports = { getSystemSettings };