const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middlewares/errorHandler');

// Routes
const authRoutes            = require('./routes/auth');
const adminRoutes           = require('./routes/admin');
const managerRoutes         = require('./routes/manager');
const hrRoutes              = require('./routes/hr');
const cashierRoutes         = require('./routes/cashier');
const chefRoutes            = require('./routes/chef');
const waiterRoutes          = require('./routes/waiter');
const deliveryRoutes        = require('./routes/delivery');
const inventoryRoutes       = require('./routes/inventory');
const inventoryOfficerRoutes = require('./routes/inventoryOfficer');
const coldDrinkRoutes       = require('./routes/Colddrink');
const barmanRoutes = require('./routes/barMan');

const app = express();

// ✅ FIXED CORS — credentials: true requires a real origin, NOT '*'
//    For mobile apps that don't send Origin headers, we allow all via function
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, curl)
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: false, // ← set false unless you specifically need cookies;
                      //   JWT in Authorization header does NOT need this
  optionsSuccessStatus: 200,
}));

// ✅ Handle preflight
app.options('*', cors());

// ✅ Payload limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ✅ Request logging (development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`\n📱 ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
      // Hide password in logs
      const safeBody = { ...req.body };
      if (safeBody.password) safeBody.password = '***';
      console.log('Body:', JSON.stringify(safeBody, null, 2));
    }
    next();
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',             authRoutes);
app.use('/api/admin',            adminRoutes);
app.use('/api/manager',          managerRoutes);
app.use('/api/hr',               hrRoutes);
app.use('/api/inventory-officer',inventoryOfficerRoutes);
app.use('/api/cashier',          cashierRoutes);
app.use('/api/chef',             chefRoutes);
app.use('/api/waiter',           waiterRoutes);
app.use('/api/delivery',         deliveryRoutes);
app.use('/api/inventory',        inventoryRoutes);
app.use('/api/cold-drinks',      coldDrinkRoutes);
app.use('/api/barman', barmanRoutes);

// ✅ Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'Server is reachable!',
    timestamp: new Date().toISOString(),
  });
});

// Root
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'AlMadina Fast Food — Management API',
    version: '1.0.0',
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.url} not found` });
});

// Global error handler (must be last)
app.use(errorHandler);

module.exports = app;
//

//mongodb+srv://ahmad556sahib_db_user:d8NrZTEYycMEb3IU@cluster0.lk13axb.mongodb.net/restaurant_management?retryWrites=true&w=majority