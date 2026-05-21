require("./utils.js");
require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Joi = require("joi");
const mongoSanitizer = require("mongo-sanitizer").default;
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { GoogleGenerativeAI } = require("@google/generative-ai");

const { connectDB } = require("./databaseConnection");
const User = require("./models/User");
const Employee = require("./models/Employee");
const FoodRequest = require("./models/FoodRequest");
const InventoryItem = require("./models/InventoryItem");
const Notification = require("./models/Notification");

const protect = require("./middleware/auth");
const AuditLog = require("./models/AuditLog");

const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY);

const app = express();

const PORT = process.env.PORT || 3001;
const saltRounds = 12;
const jwtExpireTime = "24h";
const jwt_secret = process.env.JWT_SECRET;
const admin_jwt_secret = process.env.ADMIN_JWT_SECRET || jwt_secret + '_admin';

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

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// CSP is disabled because the demo uses Tailwind CDN and inline scripts in EJS templates.
// For production, define an explicit CSP policy that whitelists only required sources.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(mongoSanitizer({ replaceWith: "_" }));
app.use(express.static(__dirname + "/public"));

/* === Rate limiting === */

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/login", authLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/submitUser", authLimiter);

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 AI calls per hour per user (protects free Gemini quota)
  message: {
    error:
      "AI assistant temporarily unavailable due to high usage. Please try again later or fill out the form manually.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user?.userId) return req.user.userId;
    return req.socket.remoteAddress ?? 'unknown';
  },
});

app.use("/api/ai/parse-request", aiLimiter);

/* === Auth helpers === */

function generateToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      username: user.username,
      roles: user.roles,
    },
    jwt_secret,
    { expiresIn: jwtExpireTime },
  );
}

function generateAdminToken(employee) {
  return jwt.sign(
    {
      employeeId: employee.employeeId,
      employeeDbId: employee._id,
      name: employee.name,
      role: employee.role,
      type: "employee",
    },
    admin_jwt_secret,
    { expiresIn: jwtExpireTime },
  );
}

function verifyToken(req) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) return null;

  try {
    return jwt.verify(token, jwt_secret);
  } catch (err) {
    console.log("JWT verification failed:", err.message);
    return null;
  }
}

function verifyAdminToken(req) {
  const token = req.cookies && req.cookies.admin_token;
  if (!token) return null;
  try {
    return jwt.verify(token, admin_jwt_secret);
  } catch (err) {
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
    res.redirect("/login");
  }
}

function adminSessionValidation(req, res, next) {
  const decoded = verifyAdminToken(req);
  if (decoded && decoded.type === "employee") {
    req.employee = decoded;
    next();
  } else {
    res.redirect("/admin/login");
  }
}

function isAdmin(req) {
  return req.user && req.user.roles && req.user.roles.includes("admin");
}

function adminAuthorization(req, res, next) {
  if (!isAdmin(req)) {
    res.status(403);
    res.render("errorMessage", { error: "Not Authorized" });
    return;
  }
  next();
}

function isVolunteerOrAdmin(req) {
  return (
    req.user &&
    req.user.roles &&
    (req.user.roles.includes("admin") || req.user.roles.includes("volunteer"))
  );
}

function volunteerOrAdminAuthorization(req, res, next) {
  if (!isVolunteerOrAdmin(req)) {
    res.status(403);
    res.render("errorMessage", { error: "Not Authorized" });
    return;
  }
  next();
}

/* === Translation helper === */

async function translateText(text, targetLanguage) {
  if (!targetLanguage || targetLanguage === "en") return text;
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { temperature: 0 },
    });
    const result = await model.generateContent(
      `Translate the following text to ${targetLanguage}. Return ONLY the translated text, no explanation:\n\n${text}`
    );
    return result.response.text().trim();
  } catch (err) {
    console.error("Translation failed, returning original:", err.message);
    return text;
  }
}

/* === Public routes === */

app.get("/", (req, res) => {
  res.render("index");
});

// food request ejs page
app.get('/request', (req, res) => {
    res.render('request'); 
});

app.get("/about", (req, res) => {
  res.render("about");
});

app.get("/contact", (req, res) => {
  const missingEmail = req.query.missing;
  res.render("contact", { missing: missingEmail });
});

/* === Auth routes === */

app.get("/signup", (req, res) => {
  res.render("signup", { error: null });
});

app.post("/submitUser", async (req, res) => {
  const { username, email, password } = req.body;
  const user_type = req.body.user_type || "client";

  const schema = Joi.object({
    username: Joi.string().alphanum().min(3).max(20).required(),
    email: Joi.string().email().max(254).required(),
    password: Joi.string().min(8).max(20).required(),
    user_type: Joi.string().valid("client", "volunteer", "admin").required(),
  });

  const { error } = schema.validate({ username, email, password, user_type });
  if (error) {
    console.log("Validation error:", error.details[0].message);
    return res.render("signup", { error: error.details[0].message });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      roles: [user_type],
    });

    const token = generateToken(newUser);
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.redirect("/onboarding");
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      console.log(`Duplicate ${field}:`, err.keyValue[field]);
      return res.render("signup", {
        error: `That ${field} is already taken. Please choose another.`,
      });
    } else {
      console.error("Signup error:", err.message);
      res
        .status(500)
        .render("errorMessage", { error: "Server error during signup" });
    }
  }
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const { error } = Joi.string().min(3).max(20).required().validate(username);
  if (error) {
    console.log("Validation error:", error.details[0].message);
    return res.render("login", { error: "Invalid username or password." });
  }

  try {
    const user = await User.findOne({ username }).select("+password");
    if (!user) {
      console.log("User not found:", username);
      return res.render("login", { error: "Invalid username or password." });
    }

    const passwordMatch = await user.comparePassword(password);
    if (!passwordMatch) {
      console.log("Incorrect password for:", username);
      return res.render("login", { error: "Invalid username or password." });
    }

    const token = generateToken(user);
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    });

    if (user.roles.includes("admin")) {
      res.redirect("/admin/dashboard");
    } else if (user.roles.includes("volunteer")) {
      res.redirect("/volunteer/dashboard");
    } else {
      res.redirect("/client/dashboard");
    }
  } catch (err) {
    console.error("Login error:", err.message);
    res
      .status(500)
      .render("errorMessage", { error: "Server error during login" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;

  const { error } = Joi.string().min(3).max(20).required().validate(username);
  if (error) {
    return res.status(400).json({ error: "Invalid input" });
  }

  try {
    const user = await User.findOne({ username }).select("+password");
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const passwordMatch = await user.comparePassword(password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken(user);
    return res.status(200).json({
      token,
      user: { username: user.username, roles: user.roles },
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.render("loggedout");
});

app.get("/onboarding", sessionValidation, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      res.clearCookie("token");
      return res.redirect("/login");
    }

    const dashboardRole = user.roles.includes("admin")
      ? "admin"
      : user.roles.includes("volunteer")
        ? "volunteer"
        : "client";

    if (
      user.firstTimeMode === false ||
      user.hintsSeen.includes("onboarding-complete")
    ) {
      return res.redirect(`/${dashboardRole}/dashboard`);
    }

    res.render("onboarding", {
      username: user.username,
      dashboardRole,
    });
  } catch (err) {
    console.error("Onboarding load error:", err.message);
    res
      .status(500)
      .render("errorMessage", { error: "Could not load onboarding" });
  }
});

// This looks at the food request form submission
app.post('/submit-request', (req, res) => {
    
    // 1. Capture the data (optional)
    const formData = req.body; 

    // 2. Create your reference ID
    const ref = "FB-" + Math.floor(Math.random() * 100000);

    // 3. THE TRIGGER: Send the confirmation page back to the browser
    res.render('confirmation', { referenceId: ref });
});

/* === Admin login routes — MUST be before app.use("/admin", ...) === */

app.get("/admin/login", (req, res) => {
  const decoded = verifyAdminToken(req);
  if (decoded && decoded.type === "employee") {
    return res.redirect("/admin/dashboard");
  }
  res.render("admin-login", { error: null, prefill: "" });
});

app.post("/admin/login", async (req, res) => {
  const { employeeId, pin } = req.body;

  const idSchema = Joi.string().pattern(/^EMP-[A-Z2-9]{8}$/).required();
  const pinSchema = Joi.string().pattern(/^\d{4,8}$/).required();

  const idErr = idSchema.validate(employeeId).error;
  const pinErr = pinSchema.validate(pin).error;

  if (idErr || pinErr) {
    return res.render("admin-login", {
      error: "Invalid Employee ID or PIN format.",
      prefill: employeeId || "",
    });
  }

  try {
    const employee = await Employee.findOne({ employeeId, isActive: true }).select("+pin");

    if (!employee) {
      return res.render("admin-login", {
        error: "Employee ID not found or account is inactive.",
        prefill: "",
      });
    }

    const pinMatch = await employee.comparePin(pin);
    if (!pinMatch) {
      return res.render("admin-login", {
        error: "Incorrect PIN. Please try again.",
        prefill: employeeId,
      });
    }

    await Employee.updateOne({ _id: employee._id }, { lastLogin: new Date() });

    const token = generateAdminToken(employee);
    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.redirect("/admin/dashboard");
  } catch (err) {
    console.error("Admin login error:", err.message);
    return res.status(500).render("errorMessage", { error: "Server error during admin login" });
  }
});

app.get("/admin/logout", (req, res) => {
  res.clearCookie("admin_token");
  res.redirect("/admin/login");
});

/* === Protected routes === */

app.use("/client", sessionValidation);
app.get("/client/dashboard", (req, res) => {
  res.render("client-dashboard", { username: req.user.username });
});
app.get("/client/ai-request", (req, res) => {
  res.render("ai-request");
});

/* === Admin Employee Routes — must be before app.use("/admin", ...) === */

app.get("/admin/employees/codes", adminSessionValidation, (req, res) => {
  res.render("admin-generate-code", { error: null, prefill: "" });
});

app.get("/admin/inventory/alerts", adminSessionValidation, (req, res) => {
  res.redirect("/admin/low-stock-alerts");
});

app.get("/admin/inventory/history", adminSessionValidation, (req, res) => {
  res.redirect("/admin/audit-log");
});

app.get("/admin/employees", adminSessionValidation, async (req, res) => {
  try {
    const employees = await Employee.find().sort({ name: 1 }).lean();
    res.render("admin-employees", { employee: req.employee, employees });
  } catch (err) {
    console.error("Employees page error:", err.message);
    res.status(500).render("errorMessage", { error: "Could not load employees" });
  }
});

app.use("/admin", adminSessionValidation);
app.get("/admin/dashboard", (req, res) => {
  res.render("admin-dashboard", { username: req.employee.name, employee: req.employee });
});

app.use("/volunteer", sessionValidation, volunteerOrAdminAuthorization);
app.get("/volunteer/dashboard", (req, res) => {
  res.render("volunteer-dashboard", { username: req.user.username });
});

/* === Food Request API === */

// A1: POST /api/requests — client submits a food request
app.post(
  "/api/requests",
  (req, res, next) => {
    if (!isValidSession(req))
      return res.status(401).json({ error: "Not authenticated" });
    next();
  },
  async (req, res) => {
    const schema = Joi.object({
      householdSize: Joi.number().integer().min(1).max(20).required(),
      dietaryNeeds: Joi.array().items(Joi.string()).max(10).default([]),
      notes: Joi.string().max(500).allow("").optional(),
      clientNotes: Joi.string().max(500).allow("").optional(),
      staffNotes: Joi.string().max(1000).allow("").optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
      const request = await FoodRequest.create({
        clientId: req.user.userId,
        householdSize: value.householdSize,
        dietaryNeeds: value.dietaryNeeds,
        notes: value.notes || "",
        clientNotes: value.clientNotes || value.notes || "",
        staffNotes: value.staffNotes || "",
        status: "pending",
      });
      return res.status(201).json({ message: "Request submitted", request });
    } catch (err) {
      console.error("FoodRequest create error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// GET /api/requests/pending — admin views all pending requests (FIFO)
app.get(
  "/api/requests/pending",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    try {
      const requests = await FoodRequest.find({ status: "pending" })
        .populate("clientId", "username email householdSize dietaryNeeds")
        .sort({ createdAt: 1 });
      return res.status(200).json({ count: requests.length, requests });
    } catch (err) {
      console.error("Fetch pending error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// GET /api/requests/me — client views their own request history
app.get("/api/requests/me", sessionValidation, async (req, res) => {
  try {
    const requests = await FoodRequest.find({ clientId: req.user.userId }).sort(
      { createdAt: -1 },
    );
    return res.status(200).json({ count: requests.length, requests });
  } catch (err) {
    console.error("Fetch my requests error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET route to fetch all food requests
app.get('/api/requests', async (req, res) => {
    try {
        const requests = await FoodRequest.find().sort({ createdAt: -1 });
        res.json(requests);
    } catch (err) {
        res.status(500).json({ message: "Error fetching requests" });
    }
});

// PATCH /api/requests/:id/approve — admin approves a request
app.patch(
  "/api/requests/:id/approve",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    const schema = Joi.object({
      pickupDate: Joi.date().greater("now").required(),
      pickupTime: Joi.string()
        .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
        .required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    try {
      const updated = await FoodRequest.findByIdAndUpdate(
        req.params.id,
        {
          status: "approved",
          pickupDate: value.pickupDate,
          pickupTime: value.pickupTime,
          approvedBy: req.user.userId,
          approvedAt: new Date(),
        },
        { returnDocument: "after", runValidators: true },
      );

      if (!updated) return res.status(404).json({ error: "Request not found" });

      // Create approval notification for the client
      try {
        const pickupDateStr = new Date(value.pickupDate).toLocaleDateString();
        await Notification.create({
          userId: updated.clientId,
          type: "request-approved",
          message: `Your food request has been approved. Pickup: ${pickupDateStr} at ${value.pickupTime}.`,
          relatedId: updated._id,
          relatedType: "FoodRequest",
        });
      } catch (notifErr) {
        console.error("Failed to create approval notification:", notifErr.message);
      }

      return res.status(200).json({ message: "Request approved", request: updated });
    } catch (err) {
      console.error("Approve error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /api/requests/:id/deny — admin denies a request
app.patch(
  "/api/requests/:id/deny",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    const schema = Joi.object({
      denialReason: Joi.string().max(500).allow("").optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    try {
      const updated = await FoodRequest.findByIdAndUpdate(
        req.params.id,
        {
          status: "denied",
          denialReason: value.denialReason || "",
          approvedBy: req.user.userId,
          approvedAt: new Date(),
        },
        { returnDocument: "after", runValidators: true },
      );

      if (!updated) return res.status(404).json({ error: "Request not found" });

      // Create denial notification for the client
      try {
        const reason = value.denialReason ? ` Reason: ${value.denialReason}` : "";
        await Notification.create({
          userId: updated.clientId,
          type: "request-denied",
          message: `Your food request was not approved.${reason}`,
          relatedId: updated._id,
          relatedType: "FoodRequest",
        });
      } catch (notifErr) {
        console.error("Failed to create denial notification:", notifErr.message);
      }

      return res.status(200).json({ message: "Request denied", request: updated });
    } catch (err) {
      console.error("Deny error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /api/requests/:id/allocate — admin allocates inventory items to an approved request
app.patch(
  "/api/requests/:id/allocate",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    const schema = Joi.object({
      items: Joi.array()
        .items(
          Joi.object({
            itemId: Joi.string().required(),
            quantity: Joi.number().integer().min(1).required(),
          })
        )
        .min(1)
        .required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
      const request = await FoodRequest.findById(req.params.id);
      if (!request) return res.status(404).json({ error: "Request not found" });

      if (request.status !== "approved") {
        return res.status(400).json({
          error: `Cannot allocate items to a request with status '${request.status}'. Request must be approved.`,
        });
      }

      // Validate each item exists and has enough quantity
      for (const item of value.items) {
        const inventoryItem = await InventoryItem.findById(item.itemId);
        if (!inventoryItem) {
          return res.status(404).json({ error: `Inventory item '${item.itemId}' not found` });
        }
        if (inventoryItem.quantity < item.quantity) {
          return res.status(400).json({
            error: `Insufficient quantity for '${inventoryItem.name}'. Available: ${inventoryItem.quantity}, requested: ${item.quantity}`,
          });
        }
      }

      // Save allocated items on the request (do NOT decrement inventory yet)
      request.itemsAllocated = value.items.map((i) => ({
        itemId: i.itemId,
        quantity: i.quantity,
      }));
      await request.save();

      const updated = await FoodRequest.findById(request._id).populate(
        "itemsAllocated.itemId",
        "name category quantity unit"
      );

      return res.status(200).json({ message: "Items allocated", request: updated });
    } catch (err) {
      console.error("Allocate error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /api/requests/:id/pickup — admin confirms pickup and decrements inventory
app.patch(
  "/api/requests/:id/pickup",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    try {
      const request = await FoodRequest.findById(req.params.id);
      if (!request) return res.status(404).json({ error: "Request not found" });

      if (request.status !== "approved") {
        return res.status(400).json({
          error: `Cannot confirm pickup for a request with status '${request.status}'. Request must be approved.`,
        });
      }

      if (!request.itemsAllocated || request.itemsAllocated.length === 0) {
        return res.status(400).json({ error: "Allocate items before confirming pickup." });
      }

      // Decrement inventory for each allocated item
      // Note: partial-failure is acceptable for COMP 2800 scope (no transactions)
      for (const allocation of request.itemsAllocated) {
        const item = await InventoryItem.findById(allocation.itemId);
        if (!item) {
          console.error(`Pickup: inventory item ${allocation.itemId} not found, skipping`);
          continue;
        }

        if (item.quantity < allocation.quantity) {
          return res.status(409).json({
            error: `Conflict: '${item.name}' now has ${item.quantity} ${item.unit} but ${allocation.quantity} were allocated. Inventory may have changed since allocation.`,
          });
        }

        const oldStatus = item.status;
        item.quantity -= allocation.quantity;
        await item.save(); // pre-save hook fires, auto-updates status

        // Fire low-stock/out-of-stock notification if status transitioned
        try {
          const isNowLowOrOut = ["low-stock", "out-of-stock"].includes(item.status);
          const wasLowOrOut = ["low-stock", "out-of-stock"].includes(oldStatus);
          if (isNowLowOrOut && !wasLowOrOut) {
            const adminUsers = await User.find({ roles: "admin" }).select("_id").lean();
            const notifications = adminUsers.map((u) => ({
              userId: u._id,
              type: "low-stock",
              message: `${item.name} is ${item.status === "out-of-stock" ? "out of stock" : "running low"} (${item.quantity} ${item.unit} remaining).`,
              relatedId: item._id,
              relatedType: "InventoryItem",
            }));
            if (notifications.length > 0) {
              await Notification.insertMany(notifications);
            }
          }
        } catch (notifErr) {
          console.error("Failed to create low-stock notification during pickup:", notifErr.message);
        }
      }

      // Mark request as picked-up
      request.status = "picked-up";
      await request.save();

      // Create pickup-confirmed notification for the client (translated if non-English)
      try {
        const englishMessage = "Your food request pickup has been confirmed. Thank you!";
        const client = await User.findById(request.clientId).select("preferredLanguage").lean();
        const lang = client?.preferredLanguage || "en";
        const message = await translateText(englishMessage, lang);

        await Notification.create({
          userId: request.clientId,
          type: "pickup-confirmed",
          message,
          originalMessage: lang !== "en" ? englishMessage : undefined,
          language: lang,
          relatedId: request._id,
          relatedType: "FoodRequest",
        });
      } catch (notifErr) {
        console.error("Failed to create pickup-confirmed notification:", notifErr.message);
      }

      const updated = await FoodRequest.findById(request._id).populate(
        "itemsAllocated.itemId",
        "name category quantity unit"
      );

      return res.status(200).json({ message: "Pickup confirmed", request: updated });
    } catch (err) {
      console.error("Pickup error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /api/requests/:id/cancel — client cancels their own pending request
app.patch(
  "/api/requests/:id/cancel",
  sessionValidation,
  async (req, res) => {
    const schema = Joi.object({
      id: Joi.string()
        .pattern(/^[0-9a-fA-F]{24}$/)
        .required(),
    });

    const { error } = schema.validate(req.params);
    if (error) {
      return res.status(400).json({ error: "Invalid request ID" });
    }

    try {
      const request = await FoodRequest.findById(req.params.id);
      if (!request) return res.status(404).json({ error: "Request not found" });

      if (request.clientId.toString() !== req.user.userId) {
        return res.status(403).json({ error: "You can only cancel your own requests" });
      }

      if (request.status !== "pending") {
        return res.status(400).json({
          error: `Cannot cancel a request with status '${request.status}'. Only pending requests can be cancelled.`,
        });
      }

      request.status = "cancelled";
      await request.save();

      return res.status(200).json({ message: "Request cancelled", request });
    } catch (err) {
      console.error("Cancel error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

/* === Inventory API === */

// POST /api/inventory — admin adds an item
app.post(
  "/api/inventory",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    const schema = Joi.object({
      name: Joi.string().min(3).max(100).required(),
      category: Joi.string()
        .valid("canned", "fresh", "dry", "frozen", "beverages", "baby", "other")
        .required(),
      quantity: Joi.number().min(0).required(),
      unit: Joi.string()
        .valid("cans", "bags", "boxes", "units", "kg", "lbs", "liters")
        .required(),
      expiryDate: Joi.date().greater("now").optional(),
      storageLocation: Joi.string()
        .valid("shelf", "fridge", "freezer", "pantry")
        .optional(),
      notes: Joi.string().max(500).allow("").optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
      const item = await InventoryItem.create({
        ...value,
        addedBy: req.user.userId,
      });
      // Write audit log entry
      try {
        await AuditLog.log('added', item.name, `Added ${item.quantity} ${item.unit} to ${item.storageLocation || 'shelf'}`, req.user.username, req.user.roles?.[0] || 'admin', item._id);
      } catch (e) { /* non-fatal */ }
      return res.status(201).json({ message: "Item added", item });
    } catch (err) {
      console.error("Inventory create error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// GET /api/inventory — any authed user, supports ?status, ?category, ?expiringSoon=true
app.get("/api/inventory", sessionValidation, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.expiringSoon === "true") {
      const now = new Date();
      const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      filter.expiryDate = { $gte: now, $lte: sevenDays };
    }

    const items = await InventoryItem.find(filter)
      .populate("addedBy", "username")
      .sort({ expiryDate: 1, name: 1 });

    let result = items.map((i) => i.toObject());

    // Optionally include allocated quantities across approved (not yet picked-up) requests
    if (req.query.includeAllocated === "true") {
      const allocations = await FoodRequest.aggregate([
        { $match: { status: "approved" } },
        { $unwind: "$itemsAllocated" },
        {
          $group: {
            _id: "$itemsAllocated.itemId",
            allocatedQuantity: { $sum: "$itemsAllocated.quantity" },
          },
        },
      ]);

      const allocMap = {};
      for (const a of allocations) {
        allocMap[a._id.toString()] = a.allocatedQuantity;
      }

      result = result.map((item) => ({
        ...item,
        allocatedQuantity: allocMap[item._id.toString()] || 0,
      }));
    }

    return res.status(200).json({ count: result.length, items: result });
  } catch (err) {
    console.error("Inventory fetch error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/inventory/low-stock — admin dashboard view
app.get(
  "/api/inventory/low-stock",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    try {
      const items = await InventoryItem.find({
        status: { $in: ["low-stock", "out-of-stock"] },
      })
        .populate("addedBy", "username")
        .sort({ name: 1 });
      return res.status(200).json({ count: items.length, items });
    } catch (err) {
      console.error("Low-stock fetch error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /api/inventory/:id — admin updates an item (status auto-recomputes via pre-hook)
app.patch(
  "/api/inventory/:id",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    const schema = Joi.object({
      name: Joi.string().min(3).max(100).optional(),
      category: Joi.string()
        .valid("canned", "fresh", "dry", "frozen", "beverages", "baby", "other")
        .optional(),
      quantity: Joi.number().min(0).optional(),
      unit: Joi.string()
        .valid("cans", "bags", "boxes", "units", "kg", "lbs", "liters")
        .optional(),
      expiryDate: Joi.date().optional(),
      storageLocation: Joi.string()
        .valid("shelf", "fridge", "freezer", "pantry")
        .optional(),
      notes: Joi.string().max(500).allow("").optional(),
    }).min(1);

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    try {
      const item = await InventoryItem.findById(req.params.id);
      if (!item) return res.status(404).json({ error: "Item not found" });

      const oldStatus = item.status;
      Object.assign(item, value);
      await item.save();

      // Notify admin users on transition into low-stock or out-of-stock
      try {
        const isNowLowOrOut = ["low-stock", "out-of-stock"].includes(item.status);
        const wasLowOrOut = ["low-stock", "out-of-stock"].includes(oldStatus);
        if (isNowLowOrOut && !wasLowOrOut) {
          const adminUsers = await User.find({ roles: "admin" }).select("_id").lean();
          const notifications = adminUsers.map((u) => ({
            userId: u._id,
            type: "low-stock",
            message: `${item.name} is ${item.status === "out-of-stock" ? "out of stock" : "running low"} (${item.quantity} ${item.unit} remaining).`,
            relatedId: item._id,
            relatedType: "InventoryItem",
          }));
          if (notifications.length > 0) {
            await Notification.insertMany(notifications);
          }
        }
      } catch (notifErr) {
        console.error("Failed to create low-stock notification:", notifErr.message);
      }

      return res.status(200).json({ message: "Item updated", item });
    } catch (err) {
      console.error("Inventory update error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// DELETE /api/inventory/:id — admin removes an item
app.delete(
  "/api/inventory/:id",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    try {
      const deleted = await InventoryItem.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Item not found" });
      return res.status(200).json({ message: "Item deleted", deletedId: deleted._id });
    } catch (err) {
      console.error("Inventory delete error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

/* === User Preferences API (Pop-Up Challenge) === */

// C1: GET /api/user/preferences — returns firstTimeMode + hintsSeen
app.get("/api/user/preferences", sessionValidation, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select(
      "firstTimeMode hintsSeen",
    );
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.status(200).json({
      firstTimeMode: user.firstTimeMode,
      hintsSeen: user.hintsSeen,
    });
  } catch (err) {
    console.error("Get preferences error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// C2: PATCH /api/user/preferences — toggle firstTimeMode OR add a hint to hintsSeen
app.patch("/api/user/preferences", sessionValidation, async (req, res) => {
  const schema = Joi.object({
    firstTimeMode: Joi.boolean(),
    dismissHint: Joi.string().min(1).max(100),
  }).xor("firstTimeMode", "dismissHint");

  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const update =
      value.firstTimeMode !== undefined
        ? { $set: { firstTimeMode: value.firstTimeMode } }
        : { $addToSet: { hintsSeen: value.dismissHint } };

    const user = await User.findByIdAndUpdate(req.user.userId, update, {
      returnDocument: "after",
      runValidators: true,
    }).select("firstTimeMode hintsSeen");

    if (!user) return res.status(404).json({ error: "User not found" });

    return res.status(200).json({
      message: "Preferences updated",
      preferences: {
        firstTimeMode: user.firstTimeMode,
        hintsSeen: user.hintsSeen,
      },
    });
  } catch (err) {
    console.error("Update preferences error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

/* === AI Smart Food Request Assistant === */

const AI_SYSTEM_PROMPT = `You are a food bank intake assistant. Your job is to parse a client's natural-language description of their household into structured data for a food request.

Rules:
- Output ONLY valid JSON matching this exact schema: { "householdSize": integer 1-20, "dietaryNeeds": array of strings, "clientNotes": string, "staffNotes": string, "confidence": "high"|"medium"|"low", "warnings": array of strings }
- Do NOT output any markdown, prose, or explanation — ONLY the JSON object.
- householdSize: count every person in the household including the speaker. If unclear, default to 1 and add a warning "Household size unclear, defaulted to 1".
- dietaryNeeds: specific, lowercase, short phrases like "diabetic", "halal", "no pork", "gluten-free", "peanut allergy", "vegetarian". Maximum 10 items, each max 50 characters.
- clientNotes: things the client explicitly said that staff should know, NOT repeating householdSize or dietaryNeeds. Max 500 characters. Leave empty string if nothing relevant.
- confidence: set to "high" if the description is clear and specific. Set to "medium" if some ambiguity exists but a reasonable interpretation is possible. Set to "low" if the description is vague, very short, or largely ambiguous.
- warnings: add warnings for any of: medical claims that need staff attention, requests for non-food items (diapers, clothes, etc — note that baby formula IS food), urgent/crisis language suggesting immediate danger, anything outside normal food bank scope. Each warning should be a short, clear sentence.
- NEVER invent details not present in or clearly implied by the description.
- If the description is in a language other than English, do your best to parse it and add a warning noting the language.

STAFF NOTES (intake summary): You are also acting as an experienced intake coordinator. Write "staffNotes" as a brief, professional summary that helps staff prepare for this client. Include:
1. One-line summary of household composition and key dietary considerations
2. Any priority flags (urgent need, first-time visitor cues, mentions of food insecurity duration)
3. Operational considerations (cultural/religious dietary requirements, medical conditions affecting food choices, accessibility needs, language)
4. Non-food asks the client mentioned that staff should address through referrals (note these as "Referral needed: ...")
5. Anything ambiguous staff should clarify in person
Format as 2-5 short sentences or bullet points. Be neutral and professional — no judgments, no assumptions about client's situation. Only include information present in or directly implied by the description.
If the input language is not English, note that at the start: "Client communicates in [language]."
Do NOT repeat the householdSize or dietaryNeeds verbatim in staffNotes — these are already structured fields. Instead, reference them as context for the summary.
Max 1000 characters for staffNotes.

Examples:
Description: "I have 4 kids and my husband. We don't eat pork." staffNotes: "Family of 6 (2 adults, 4 children). Halal/no-pork household — please avoid pork products and consider halal-certified meat if available. No other dietary restrictions mentioned."
Description: "My kids haven't eaten in 3 days please help" staffNotes: "PRIORITY: Client reports household has been without food for 3 days — please flag for urgent processing. Household size unclear, defaulted to 1 — confirm in person. Recommend connecting with crisis services in addition to food assistance."
Description: "Tengo 3 hijos, somos vegetarianos, mi hija necesita pañales" staffNotes: "Client communicates in Spanish. Family of 4 (1 adult, 3 children), vegetarian household. Referral needed: client mentioned diapers — connect with partner agency for non-food supplies."`;

const aiOutputSchema = Joi.object({
  householdSize: Joi.number().integer().min(1).max(20).required(),
  dietaryNeeds: Joi.array().items(Joi.string().max(50)).max(10).default([]),
  clientNotes: Joi.string().max(500).allow("").default(""),
  staffNotes: Joi.string().max(1000).allow("").default(""),
  confidence: Joi.string().valid("high", "medium", "low").required(),
  warnings: Joi.array().items(Joi.string()).default([]),
});

// POST /api/ai/parse-request — AI parses natural-language description into structured request data
app.post("/api/ai/parse-request", sessionValidation, async (req, res) => {
  const inputSchema = Joi.object({
    description: Joi.string().min(10).max(2000).required(),
  });

  const { error, value } = inputSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  try {
    // Card 1C: Fetch previous requests for personalization
    const previousRequests = await FoodRequest.find({
      clientId: req.user.userId,
    })
      .sort({ createdAt: -1 })
      .limit(3)
      .select("householdSize dietaryNeeds notes clientNotes")
      .lean();

    let prompt = AI_SYSTEM_PROMPT;
    const usedPreviousRequests = previousRequests.length > 0;

    if (usedPreviousRequests) {
      prompt += `\n\nFor context, this user's previous requests had: ${JSON.stringify(previousRequests)} Use this only to resolve ambiguity, not to override what they say now.`;
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: value.description }] }],
      systemInstruction: { parts: [{ text: prompt }] },
    });

    let rawText = result.response.text();

    // Strip markdown code fences if present
    rawText = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error("AI returned invalid JSON:", rawText);
      return res.status(502).json({
        error: "AI returned unexpected response, please try rephrasing your description.",
      });
    }

    const { error: validationError, value: validatedOutput } =
      aiOutputSchema.validate(parsed, { stripUnknown: true });
    if (validationError) {
      console.error("AI output failed validation:", validationError.details, "Raw:", parsed);
      return res.status(502).json({
        error: "AI returned unexpected response, please try rephrasing your description.",
      });
    }

    return res.status(200).json({
      parsed: validatedOutput,
      meta: {
        model: "gemini-2.5-flash",
        usedPreviousRequests,
      },
    });
  } catch (err) {
    console.error("AI parse-request error:", err.message);
    return res.status(500).json({
      error: "Something went wrong with the AI assistant. Please try again later.",
    });
  }
});

/* === Notifications API === */

// GET /api/notifications — current user's notifications
app.get('/api/notifications', sessionValidation, async (req, res) => {
  try {
    const filter = { userId: req.user.userId };
    if (req.query.unreadOnly === 'true') {
      filter.read = false;
    }

    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const unreadCount = await Notification.countDocuments({ userId: req.user.userId, read: false });

    return res.status(200).json({ notifications, unreadCount });
  } catch (err) {
    console.error('Fetch notifications error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notifications/unread-count — lightweight badge count
app.get('/api/notifications/unread-count', sessionValidation, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user.userId, read: false });
    return res.status(200).json({ count });
  } catch (err) {
    console.error('Unread count error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/notifications/read-all — mark all unread as read
app.patch('/api/notifications/read-all', sessionValidation, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user.userId, read: false },
      { $set: { read: true } }
    );
    return res.status(200).json({ updated: result.modifiedCount });
  } catch (err) {
    console.error('Read-all error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/notifications/:id/read — mark single notification as read
app.patch('/api/notifications/:id/read', sessionValidation, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    if (notification.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    notification.read = true;
    await notification.save();
    return res.status(200).json({ notification });
  } catch (err) {
    console.error('Mark read error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/notifications/:id — dismiss a notification
app.delete('/api/notifications/:id', sessionValidation, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    if (notification.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await notification.deleteOne();
    return res.sendStatus(204);
  } catch (err) {
    console.error('Delete notification error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// SAVE SETTINGS TO USER PROFILE
app.post("/api/profile", protect, async (req, res) => {
  try {
    const { householdSize, allergies, dietaryRestrictions } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { householdSize, allergies, dietaryRestrictions },
      { new: true }
    );

    res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PROFILE PAGE
app.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.render("profile", { user });
  } catch (err) {
    console.error(err);
    res.render("profile", { user: {}, error: "Failed to load profile" });
  }
});

// SAVE PROFILE
app.post("/profile", protect, async (req, res) => {
  try {
    const { householdSize, allergies, dietaryRestrictions } = req.body;

    await User.findByIdAndUpdate(req.user._id, {
      householdSize,
      allergies: allergies || [],
      dietaryRestrictions: dietaryRestrictions || [],
    });

    const updatedUser = await User.findById(req.user._id);
    res.render("profile", { user: updatedUser, success: "Profile updated successfully" });
  } catch (err) {
    console.error(err);
    res.render("profile", { user: req.user, error: "Failed to update profile" });
  }
});

/* ===================================================================
   ADMIN INVENTORY PAGE  —  GET /admin/inventory
   =================================================================== */

app.get("/admin/inventory", adminSessionValidation, async (req, res) => {
  try {
    const { search, category, status, location } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (status)   filter.status   = status;
    if (location) filter.storageLocation = location;
    if (search)   filter.name = { $regex: search, $options: 'i' };

    const [items, total, inStock, lowStock, outOfStock] = await Promise.all([
      InventoryItem.find(filter).populate('addedBy', 'username').sort({ name: 1 }).lean(),
      InventoryItem.countDocuments(),
      InventoryItem.countDocuments({ status: 'in-stock' }),
      InventoryItem.countDocuments({ status: 'low-stock' }),
      InventoryItem.countDocuments({ status: 'out-of-stock' }),
    ]);

    res.render('manage-inventory', {
      username: req.employee.employeeId,
      items,
      stats: { total, inStock, lowStock, outOfStock },
      filters: { search, category, status, location },
      success: req.flash ? req.flash('success') : [],
      error:   req.flash ? req.flash('error')   : [],
    });
  } catch (err) {
    console.error('Inventory page error:', err.message);
    res.status(500).render('errorMessage', { error: 'Could not load inventory page' });
  }
});

// POST /admin/inventory — add item (form submit from EJS modal)
app.post("/admin/inventory", adminSessionValidation, async (req, res) => {
  const schema = Joi.object({
    name: Joi.string().min(3).max(100).required(),
    category: Joi.string().valid('canned','fresh','dry','frozen','beverages','baby','other').required(),
    quantity: Joi.number().min(0).required(),
    unit: Joi.string().valid('cans','bags','boxes','units','kg','lbs','liters').required(),
    expiryDate: Joi.date().optional().allow(''),
    storageLocation: Joi.string().valid('shelf','fridge','freezer','pantry').optional(),
    notes: Joi.string().max(500).allow('').optional(),
  });

  const { error, value } = schema.validate(req.body);
  if (error) return res.redirect('/admin/inventory?err=' + encodeURIComponent(error.details[0].message));

  try {
    const item = await InventoryItem.create({ ...value, addedBy: req.user.userId });
    await AuditLog.log('added', item.name, `Added ${value.quantity} ${value.unit} to ${value.storageLocation || 'shelf'}`, req.user.username, 'admin', item._id);
    res.redirect('/admin/inventory');
  } catch (err) {
    console.error('Inventory add error:', err.message);
    res.redirect('/admin/inventory?err=' + encodeURIComponent('Could not add item'));
  }
});

// POST /admin/inventory/:id  (with _method=PATCH or _method=DELETE)
app.post("/admin/inventory/:id", adminSessionValidation, async (req, res) => {
  if (req.body._method === 'PATCH') {
    const schema = Joi.object({
      name: Joi.string().min(3).max(100).optional(),
      category: Joi.string().valid('canned','fresh','dry','frozen','beverages','baby','other').optional(),
      quantity: Joi.number().min(0).optional(),
      unit: Joi.string().valid('cans','bags','boxes','units','kg','lbs','liters').optional(),
      expiryDate: Joi.date().optional().allow(''),
      storageLocation: Joi.string().valid('shelf','fridge','freezer','pantry').optional(),
      notes: Joi.string().max(500).allow('').optional(),
      _method: Joi.string().optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return res.redirect('/admin/inventory');

    try {
      const oldItem = await InventoryItem.findById(req.params.id);
      delete value._method;
      Object.assign(oldItem, value);
      await oldItem.save();
      await AuditLog.log('updated', oldItem.name, `Qty updated to ${oldItem.quantity} ${oldItem.unit}`, req.user.username, 'admin', oldItem._id);
      res.redirect('/admin/inventory');
    } catch (err) {
      console.error('Inventory edit error:', err.message);
      res.redirect('/admin/inventory');
    }

  } else if (req.body._method === 'DELETE') {
    try {
      const deleted = await InventoryItem.findByIdAndDelete(req.params.id);
      if (deleted) await AuditLog.log('deleted', deleted.name, 'Item removed from inventory', req.user.username, 'admin', deleted._id);
      res.redirect('/admin/inventory');
    } catch (err) {
      console.error('Inventory delete error:', err.message);
      res.redirect('/admin/inventory');
    }
  } else {
    res.redirect('/admin/inventory');
  }
});

/* ===================================================================
   LOW STOCK ALERTS PAGE  —  GET /admin/low-stock-alerts
   =================================================================== */

app.get("/admin/low-stock-alerts", adminSessionValidation, async (req, res) => {
  try {
    const filterParam = req.query.filter || 'all';

    let query = { type: 'low-stock' };
    if (filterParam === 'unread')    query.read = false;
    if (filterParam === 'read')      query.read = true;
    if (filterParam === 'critical')  { query.read = false; query.message = { $regex: 'out of stock', $options: 'i' }; }
    if (filterParam === 'low-stock') { query.read = false; query.message = { $not: /out of stock/i }; }

    const [alerts, total, unread] = await Promise.all([
      Notification.find(query).populate('relatedId').sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ type: 'low-stock' }),
      Notification.countDocuments({ type: 'low-stock', read: false }),
    ]);

    const critical = await Notification.countDocuments({ type: 'low-stock', read: false, message: { $regex: 'out of stock', $options: 'i' } });
    const lowStockCount = await Notification.countDocuments({ type: 'low-stock', read: false, message: { $not: /out of stock/i } });

    res.render('low-stock-alerts', {
      username: req.employee.employeeId,
      alerts,
      filter: filterParam,
      stats: { total, unread, critical, lowStock: lowStockCount },
    });
  } catch (err) {
    console.error('Low stock alerts page error:', err.message);
    res.status(500).render('errorMessage', { error: 'Could not load alerts' });
  }
});

app.post("/admin/low-stock-alerts/:id/read", adminSessionValidation, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    res.redirect('/admin/low-stock-alerts');
  } catch (err) {
    res.redirect('/admin/low-stock-alerts');
  }
});

app.post("/admin/low-stock-alerts/:id/dismiss", adminSessionValidation, async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.redirect('/admin/low-stock-alerts');
  } catch (err) {
    res.redirect('/admin/low-stock-alerts');
  }
});

app.post("/admin/low-stock-alerts/mark-all-read", adminSessionValidation, async (req, res) => {
  try {
    await Notification.updateMany({ type: 'low-stock', read: false }, { $set: { read: true } });
    res.redirect('/admin/low-stock-alerts');
  } catch (err) {
    res.redirect('/admin/low-stock-alerts');
  }
});

app.post("/admin/low-stock-alerts/dismiss-read", adminSessionValidation, async (req, res) => {
  try {
    await Notification.deleteMany({ type: 'low-stock', read: true });
    res.redirect('/admin/low-stock-alerts');
  } catch (err) {
    res.redirect('/admin/low-stock-alerts');
  }
});

app.post("/admin/low-stock-alerts/:id/restock", adminSessionValidation, async (req, res) => {
  const qty = parseInt(req.body.quantity, 10);
  if (!qty || qty < 1) return res.redirect('/admin/low-stock-alerts');

  try {
    const alert = await Notification.findById(req.params.id);
    if (!alert) return res.redirect('/admin/low-stock-alerts');

    const item = await InventoryItem.findById(alert.relatedId);
    if (item) {
      const oldQty = item.quantity;
      item.quantity = qty;
      await item.save();
      await AuditLog.log('updated', item.name, `Restocked from ${oldQty} → ${qty} ${item.unit}`, req.user.username, 'admin', item._id);
    }

    alert.read = true;
    await alert.save();

    res.redirect('/admin/low-stock-alerts');
  } catch (err) {
    console.error('Restock error:', err.message);
    res.redirect('/admin/low-stock-alerts');
  }
});

/* ===================================================================
   AUDIT LOG PAGE  —  GET /admin/audit-log
   =================================================================== */

app.get("/admin/audit-log", adminSessionValidation, async (req, res) => {
  const PER_PAGE = 20;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const { search, action, dateFrom, dateTo } = req.query;

  try {
    const filter = {};
    if (action) filter.action = action;
    if (search) filter.$or = [
      { item: { $regex: search, $options: 'i' } },
      { user: { $regex: search, $options: 'i' } },
    ];
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo)   filter.createdAt.$lte = new Date(new Date(dateTo).setHours(23,59,59,999));
    }

    const [rawLogs, totalCount] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PER_PAGE).limit(PER_PAGE).lean(),
      AuditLog.countDocuments(filter),
    ]);

    const events = rawLogs.map(l => ({
      ts:      l.createdAt,
      action:  l.action,
      item:    l.item,
      details: l.details || '—',
      user:    l.user,
      role:    l.role,
    }));

    const now = new Date();
    const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const som = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayCount, addedMonth, requestsMonth] = await Promise.all([
      AuditLog.countDocuments({ createdAt: { $gte: sod } }),
      AuditLog.countDocuments({ action: 'added', createdAt: { $gte: som } }),
      AuditLog.countDocuments({ action: { $in: ['approved'] }, createdAt: { $gte: som } }),
    ]);

    const qsParts = [];
    if (search)   qsParts.push('search='   + encodeURIComponent(search));
    if (action)   qsParts.push('action='   + encodeURIComponent(action));
    if (dateFrom) qsParts.push('dateFrom=' + encodeURIComponent(dateFrom));
    if (dateTo)   qsParts.push('dateTo='   + encodeURIComponent(dateTo));

    res.render('audit-log-admin', {
      username: req.employee.employeeId,
      events,
      stats: { total: totalCount, today: todayCount, added: addedMonth, requests: requestsMonth },
      filters: { search, action, dateFrom, dateTo },
      page,
      totalPages: Math.ceil(totalCount / PER_PAGE),
      queryString: qsParts.join('&'),
    });
  } catch (err) {
    console.error('Audit log page error:', err.message);
    res.status(500).render('errorMessage', { error: 'Could not load audit log' });
  }
});

/* === Static + 404 === */

app.use((req, res) => {
  res.status(404);
  res.render("404");
});

/* === Start === */

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to start server:", err.message);
    process.exit(1);
  });