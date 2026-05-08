require('./utils.js');
require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const mongoSanitizer = require('mongo-sanitizer').default;
const cookieParser = require('cookie-parser');

const { connectDB } = require('./databaseConnection');
const User = require('./models/User');
const FoodRequest = require('./models/FoodRequest');
const InventoryItem = require('./models/InventoryItem');

const app = express();

const PORT = process.env.PORT || 3000;
const saltRounds = 12;
const jwtExpireTime = '24h';
const jwt_secret = process.env.JWT_SECRET;

/* 
 * NOTE ON STRUCTURE:
 * Routes are defined inline in this file rather than split into /routes,
 * /controllers, etc.
 *
 * Views (EJS templates) live in /views and are rendered via res.render().
 * Each role (client, admin, volunteer) gets its own dashboard view.
 *
 * The /routes, /controllers, /middleware, /models, /config folders exist
 * for Sprint 3 refactoring if the file gets too long. For Sprint 2, we
 * keep everything here for simplicity and to mirror the instructor's style.
 */

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(mongoSanitizer({ replaceWith: '_' }));

/* === Auth helpers === */

function generateToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      username: user.username,
      roles: user.roles
    },
    jwt_secret,
    { expiresIn: jwtExpireTime }
  );
}

function verifyToken(req) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) return null;

  try {
    return jwt.verify(token, jwt_secret);
  } catch (err) {
    console.log('JWT verification failed:', err.message);
    return null;
  }
}

function isValidSession(req) {
  const decoded = verifyToken(req);
  if (decoded) {
    req.user = decoded;
    return true;
  }
  return false;
}

function sessionValidation(req, res, next) {
  if (isValidSession(req)) {
    next();
  } else {
    res.redirect('/login');
  }
}

function isAdmin(req) {
  return req.user && req.user.roles && req.user.roles.includes('admin');
}

function adminAuthorization(req, res, next) {
  if (!isAdmin(req)) {
    res.status(403);
    res.render('errorMessage', { error: 'Not Authorized' });
    return;
  }
  next();
}

function isVolunteerOrAdmin(req) {
  return req.user && req.user.roles &&
    (req.user.roles.includes('admin') || req.user.roles.includes('volunteer'));
}

function volunteerOrAdminAuthorization(req, res, next) {
  if (!isVolunteerOrAdmin(req)) {
    res.status(403);
    res.render('errorMessage', { error: 'Not Authorized' });
    return;
  }
  next();
}

/* === Public routes === */

app.get('/', (req, res) => {
  res.render('index');
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.get('/contact', (req, res) => {
  const missingEmail = req.query.missing;
  res.render('contact', { missing: missingEmail });
});

/* === Auth routes === */

app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/submitUser', async (req, res) => {
  const { username, email, password } = req.body;
  const user_type = req.body.user_type || 'client';

  const schema = Joi.object({
    username: Joi.string().alphanum().min(3).max(20).required(),
    email: Joi.string().email().max(254).required(),
    password: Joi.string().min(8).max(20).required(),
    user_type: Joi.string().valid('client', 'volunteer', 'admin').required()
  });

  const { error } = schema.validate({ username, email, password, user_type });
  if (error) {
    console.log('Validation error:', error.details[0].message);
    res.redirect('/signup');
    return;
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      roles: [user_type]
    });

    const token = generateToken(newUser);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.render('submitUser');
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      console.log(`Duplicate ${field}:`, err.keyValue[field]);
      res.redirect('/signup');
    } else {
      console.error('Signup error:', err.message);
      res.status(500).render('errorMessage', { error: 'Server error during signup' });
    }
  }
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/loggingin', async (req, res) => {
  const { username, password } = req.body;

  const { error } = Joi.string().min(3).max(20).required().validate(username);
  if (error) {
    console.log('Validation error:', error.details[0].message);
    res.redirect('/login');
    return;
  }

  try {
    const user = await User.findOne({ username }).select('+password');
    if (!user) {
      console.log('User not found:', username);
      res.redirect('/login');
      return;
    }

    const passwordMatch = await user.comparePassword(password);
    if (!passwordMatch) {
      console.log('Incorrect password for:', username);
      res.redirect('/login');
      return;
    }

    const token = generateToken(user);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });

    if (user.roles.includes('admin')) {
      res.redirect('/admin/dashboard');
    } else if (user.roles.includes('volunteer')) {
      res.redirect('/volunteer/dashboard');
    } else {
      res.redirect('/client/dashboard');
    }
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).render('errorMessage', { error: 'Server error during login' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  const { error } = Joi.string().min(3).max(20).required().validate(username);
  if (error) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    const user = await User.findOne({ username }).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordMatch = await user.comparePassword(password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);
    return res.status(200).json({
      token,
      user: { username: user.username, roles: user.roles }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.render('loggedout');
});

/* === Protected routes === */

app.use('/client', sessionValidation);
app.get('/client/dashboard', (req, res) => {
  res.render('client-dashboard', { username: req.user.username });
});

app.use('/admin', sessionValidation, adminAuthorization);
app.get('/admin/dashboard', (req, res) => {
  res.render('admin-dashboard', { username: req.user.username });
});

app.use('/volunteer', sessionValidation, volunteerOrAdminAuthorization);
app.get('/volunteer/dashboard', (req, res) => {
  res.render('volunteer-dashboard', { username: req.user.username });
});

/* === Food Request API === */

// A1: POST /api/requests — client submits a food request
app.post('/api/requests', (req, res, next) => {
  if (!isValidSession(req)) return res.status(401).json({ error: 'Not authenticated' });
  next();
}, async (req, res) => {
  const schema = Joi.object({
    householdSize: Joi.number().integer().min(1).max(20).required(),
    dietaryNeeds: Joi.array().items(Joi.string()).max(10).default([]),
    notes: Joi.string().max(500).allow('').optional()
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const request = await FoodRequest.create({
      clientId: req.user.userId,
      householdSize: value.householdSize,
      dietaryNeeds: value.dietaryNeeds,
      notes: value.notes,
      status: 'pending'
    });
    return res.status(201).json({ message: 'Request submitted', request });
  } catch (err) {
    console.error('FoodRequest create error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/requests/pending — adminviews all pending requests (FIFO)
app.get('/api/requests/pending', sessionValidation, adminAuthorization, async (req, res) => {
  try {
    const requests = await FoodRequest.find({ status: 'pending' })
      .populate('clientId', 'username email householdSize dietaryNeeds')
      .sort({ createdAt: 1 });
    return res.status(200).json({ count: requests.length, requests });
  } catch (err) {
    console.error('Fetch pending error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/requests/me — client views their own request history
app.get('/api/requests/me', sessionValidation, async (req, res) => {
  try {
    const requests = await FoodRequest.find({ clientId: req.user.userId })
      .sort({ createdAt: -1 });
    return res.status(200).json({ count: requests.length, requests });
  } catch (err) {
    console.error('Fetch my requests error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/requests/:id/approve — adminapproves a request
app.patch('/api/requests/:id/approve', sessionValidation, adminAuthorization, async (req, res) => {
  const schema = Joi.object({
    pickupDate: Joi.date().greater('now').required(),
    pickupTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).required()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const updated = await FoodRequest.findByIdAndUpdate(
      req.params.id,
      {
        status: 'approved',
        pickupDate: value.pickupDate,
        pickupTime: value.pickupTime,
        approvedBy: req.user.userId,
        approvedAt: new Date()
      },
      { returnDocument: 'after', runValidators: true }
    );

    if (!updated) return res.status(404).json({ error: 'Request not found' });
    return res.status(200).json({ message: 'Request approved', request: updated });
  } catch (err) {
    console.error('Approve error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/requests/:id/deny — admindenies a request
app.patch('/api/requests/:id/deny', sessionValidation, adminAuthorization, async (req, res) => {
  const schema = Joi.object({
    denialReason: Joi.string().max(500).allow('').optional()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const updated = await FoodRequest.findByIdAndUpdate(
      req.params.id,
      {
        status: 'denied',
        denialReason: value.denialReason || '',
        approvedBy: req.user.userId,
        approvedAt: new Date()
      },
      { returnDocument: 'after', runValidators: true }
    );

    if (!updated) return res.status(404).json({ error: 'Request not found' });
    return res.status(200).json({ message: 'Request denied', request: updated });
  } catch (err) {
    console.error('Deny error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* === Inventory API === */

// POST /api/inventory — adminadds an item
app.post('/api/inventory', sessionValidation, adminAuthorization, async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(100).required(),
    category: Joi.string().valid('canned', 'fresh', 'dry', 'frozen', 'beverages', 'baby', 'other').required(),
    quantity: Joi.number().min(0).required(),
    unit: Joi.string().valid('cans', 'bags', 'boxes', 'units', 'kg', 'lbs', 'liters').required(),
    expiryDate: Joi.date().greater('now').optional(),
    storageLocation: Joi.string().valid('shelf', 'fridge', 'freezer', 'pantry').optional(),
    notes: Joi.string().max(500).allow('').optional()
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const item = await InventoryItem.create({ ...value, addedBy: req.user.userId });
    return res.status(201).json({ message: 'Item added', item });
  } catch (err) {
    console.error('Inventory create error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/inventory — any authed user, supports ?status, ?category, ?expiringSoon=true
app.get('/api/inventory', sessionValidation, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.expiringSoon === 'true') {
      const now = new Date();
      const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      filter.expiryDate = { $gte: now, $lte: sevenDays };
    }

    const items = await InventoryItem.find(filter)
      .populate('addedBy', 'username')
      .sort({ expiryDate: 1, name: 1 });

    return res.status(200).json({ count: items.length, items });
  } catch (err) {
    console.error('Inventory fetch error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/inventory/low-stock — admin dashboard view
app.get('/api/inventory/low-stock', sessionValidation, adminAuthorization, async (req, res) => {
  try {
    const items = await InventoryItem.find({ status: { $in: ['low-stock', 'out-of-stock'] } })
      .populate('addedBy', 'username')
      .sort({ name: 1 });
    return res.status(200).json({ count: items.length, items });
  } catch (err) {
    console.error('Low-stock fetch error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/inventory/:id — adminupdates an item (status auto-recomputes via pre-hook)
app.patch('/api/inventory/:id', sessionValidation, adminAuthorization, async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(100).optional(),
    category: Joi.string().valid('canned', 'fresh', 'dry', 'frozen', 'beverages', 'baby', 'other').optional(),
    quantity: Joi.number().min(0).optional(),
    unit: Joi.string().valid('cans', 'bags', 'boxes', 'units', 'kg', 'lbs', 'liters').optional(),
    expiryDate: Joi.date().optional(),
    storageLocation: Joi.string().valid('shelf', 'fridge', 'freezer', 'pantry').optional(),
    notes: Joi.string().max(500).allow('').optional()
  }).min(1);

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    Object.assign(item, value);
    await item.save();

    return res.status(200).json({ message: 'Item updated', item });
  } catch (err) {
    console.error('Inventory update error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/inventory/:id — adminremoves an item
app.delete('/api/inventory/:id', sessionValidation, adminAuthorization, async (req, res) => {
  try {
    const deleted = await InventoryItem.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Item not found' });
    return res.status(200).json({ message: 'Item deleted', deletedId: deleted._id });
  } catch (err) {
    console.error('Inventory delete error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* === User Preferences API (Pop-Up Challenge) === */

// C1: GET /api/user/preferences — returns firstTimeMode + hintsSeen
app.get('/api/user/preferences', sessionValidation, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('firstTimeMode hintsSeen');
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({
      firstTimeMode: user.firstTimeMode,
      hintsSeen: user.hintsSeen
    });
  } catch (err) {
    console.error('Get preferences error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// C2: PATCH /api/user/preferences — toggle firstTimeMode OR add a hint to hintsSeen
app.patch('/api/user/preferences', sessionValidation, async (req, res) => {
  const schema = Joi.object({
    firstTimeMode: Joi.boolean(),
    dismissHint: Joi.string().min(1).max(100)
  }).xor('firstTimeMode', 'dismissHint');

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const update = value.firstTimeMode !== undefined
      ? { $set: { firstTimeMode: value.firstTimeMode } }
      : { $addToSet: { hintsSeen: value.dismissHint } };

    const user = await User.findByIdAndUpdate(
      req.user.userId,
      update,
      { returnDocument: 'after', runValidators: true }
    ).select('firstTimeMode hintsSeen');

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.status(200).json({
      message: 'Preferences updated',
      preferences: { firstTimeMode: user.firstTimeMode, hintsSeen: user.hintsSeen }
    });
  } catch (err) {
    console.error('Update preferences error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* === Static + 404 === */

app.use(express.static(__dirname + '/public'));

app.use((req, res) => {
  res.status(404);
  res.render('404');
});

/* === Start === */

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
