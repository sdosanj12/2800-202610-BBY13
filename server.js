require('./utils.js');
require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const mongoSanitizer = require('mongo-sanitizer').default;
const cookieParser = require('cookie-parser');

const app = express();

const PORT = process.env.PORT || 3000;
const saltRounds = 12;
const jwtExpireTime = '24h'; // 1 day

/* secret information section */
const mongodb_host = process.env.MONGODB_HOST;
const mongodb_user = process.env.MONGODB_USER;
const mongodb_password = process.env.MONGODB_PASSWORD;
const mongodb_user_database = process.env.MONGODB_USER_DATABASE;
const jwt_secret = process.env.JWT_SECRET;
/* END secret section */

const { database } = include('databaseConnection');
const userCollection = database.db(mongodb_user_database).collection('users');

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());

// NoSQL injection prevention
app.use(mongoSanitizer({ replaceWith: '_' }));

/* === Auth helper functions === */

function generateToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      username: user.username,
      user_type: user.user_type
    },
    jwt_secret,
    { expiresIn: jwtExpireTime }
  );
}

function verifyToken(req) {
  // Try Authorization header first, fall back to cookie
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
    req.user = decoded; // attach user info for later use
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
  return req.user && req.user.user_type === 'admin';
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
  return req.user && (req.user.user_type === 'admin' || req.user.user_type === 'volunteer');
}

function volunteerOrAdminAuthorization(req, res, next) {
  if (!isVolunteerOrAdmin(req)) {
    res.status(403);
    res.render('errorMessage', { error: 'Not Authorized' });
    return;
  }
  next();
}

// public routes

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

// Authentication routes

app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/submitUser', async (req, res) => {
  const username = req.body.username;
  const email = req.body.email;
  const password = req.body.password;
  const userType = req.body.user_type || 'client';

  const schema = Joi.object({
    username: Joi.string().alphanum().max(20).required(),
    email: Joi.string().email().max(254).required(),
    password: Joi.string().max(20).required(),
    user_type: Joi.string().valid('client', 'volunteer', 'admin').required()
  });

  const validationResult = schema.validate({ username, email, password, user_type: userType });
  if (validationResult.error != null) {
    console.log(validationResult.error);
    res.redirect('/signup');
    return;
  }

  // Check if username already exists
  const existingUser = await userCollection.findOne({ username: username });
  if (existingUser) {
    console.log('Username already exists');
    res.redirect('/signup');
    return;
  }

  const hashedPassword = await bcrypt.hash(password, saltRounds);

  const result = await userCollection.insertOne({
    username: username,
    email: email,
    password: hashedPassword,
    user_type: userType,
    createdAt: new Date()
  });
  console.log('Inserted user');

  // Auto-login: generate JWT and set cookie
  const newUser = {
    _id: result.insertedId,
    username: username,
    user_type: userType
  };
  const token = generateToken(newUser);

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 1 day in ms
  });

  res.render('submitUser');
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/loggingin', async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  const schema = Joi.string().max(20).required();
  const validationResult = schema.validate(username);
  if (validationResult.error != null) {
    console.log(validationResult.error);
    res.redirect('/login');
    return;
  }

  const result = await userCollection
    .find({ username: username })
    .project({ username: 1, password: 1, user_type: 1, _id: 1 })
    .toArray();

  console.log(result);
  if (result.length != 1) {
    console.log('user not found');
    res.redirect('/login');
    return;
  }

  if (await bcrypt.compare(password, result[0].password)) {
    console.log('correct password');

    // Generate JWT
    const token = generateToken(result[0]);

    // Send token as httpOnly cookie (more secure than localStorage)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000
    });

    // Redirect based on role
    if (result[0].user_type === 'admin') {
      res.redirect('/admin/dashboard');
    } else if (result[0].user_type === 'volunteer') {
      res.redirect('/volunteer/dashboard');
    } else {
      res.redirect('/client/dashboard');
    }
    return;
  } else {
    console.log('incorrect password');
    res.redirect('/login');
    return;
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.render('loggedout');
});

// API endpoint version of login for postman and testing for frontend

app.post('/api/auth/login', async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  const schema = Joi.string().max(20).required();
  const validationResult = schema.validate(username);
  if (validationResult.error != null) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const result = await userCollection
    .find({ username: username })
    .project({ username: 1, password: 1, user_type: 1, _id: 1 })
    .toArray();

  if (result.length != 1) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (await bcrypt.compare(password, result[0].password)) {
    const token = generateToken(result[0]);
    return res.status(200).json({
      token: token,
      user: {
        username: result[0].username,
        user_type: result[0].user_type
      }
    });
  } else {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
});

// routes for certain roles (admin/client/volunteer)

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

/* === Static files + 404 fallback === */

app.use(express.static(__dirname + '/public'));

app.use((req, res) => {
  res.status(404);
  res.render('404');
});

/* === Start server === */

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});