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
 * Each role (client, staff, volunteer) gets its own dashboard view.
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

function isStaff(req) {
  return req.user && req.user.roles && req.user.roles.includes('staff');
}

function staffAuthorization(req, res, next) {
  if (!isStaff(req)) {
    res.status(403);
    res.render('errorMessage', { error: 'Not Authorized' });
    return;
  }
  next();
}

function isVolunteerOrStaff(req) {
  return req.user && req.user.roles &&
    (req.user.roles.includes('staff') || req.user.roles.includes('volunteer'));
}

function volunteerOrStaffAuthorization(req, res, next) {
  if (!isVolunteerOrStaff(req)) {
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
    user_type: Joi.string().valid('client', 'volunteer', 'staff').required()
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

    if (user.roles.includes('staff')) {
      res.redirect('/staff/dashboard');
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

app.use('/staff', sessionValidation, staffAuthorization);
app.get('/staff/dashboard', (req, res) => {
  res.render('staff-dashboard', { username: req.user.username });
});

app.use('/volunteer', sessionValidation, volunteerOrStaffAuthorization);
app.get('/volunteer/dashboard', (req, res) => {
  res.render('volunteer-dashboard', { username: req.user.username });
});

/* === Food Request API === */

// POST /api/requests — client submits a food request
app.post('/api/requests', (req, res, next) => {
  if (!isValidSession(req)) return res.status(401).json({ error: 'Not authenticated' });
  next();
}, async (req, res) => {
  const schema = Joi.object({
    householdSize: Joi.number().integer().min(1).max(20).required(),
    dietaryNeeds: Joi.array().items(Joi.string()).max(10).default([]),
    notes: Joi.string().max(500).allow('').optional(),
    pickupDate: Joi.date().optional(),
    pickupTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).optional()
  });

  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    const foodRequest = await FoodRequest.create({
      clientId: req.user.userId,
      householdSize: value.householdSize,
      dietaryNeeds: value.dietaryNeeds,
      notes: value.notes,
      pickupDate: value.pickupDate,
      pickupTime: value.pickupTime,
      status: 'pending'
    });
    return res.status(201).json(foodRequest);
  } catch (err) {
    console.error('FoodRequest create error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/requests/pending — staff views all pending requests (FIFO)
app.get('/api/requests/pending', sessionValidation, staffAuthorization, async (req, res) => {
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

// PATCH /api/requests/:id/approve — staff approves a request
app.patch('/api/requests/:id/approve', sessionValidation, staffAuthorization, async (req, res) => {
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
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ error: 'Request not found' });
    return res.status(200).json(updated);
  } catch (err) {
    console.error('Approve error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/requests/:id/deny — staff denies a request
app.patch('/api/requests/:id/deny', sessionValidation, staffAuthorization, async (req, res) => {
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
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ error: 'Request not found' });
    return res.status(200).json(updated);
  } catch (err) {
    console.error('Deny error:', err.message);
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
