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
const methodOverride = require("method-override");

const { GoogleGenerativeAI } = require("@google/generative-ai");

const { connectDB } = require("./databaseConnection");
const User = require("./models/User");
const Employee = require("./models/Employee");
const FoodRequest = require("./models/FoodRequest");
const InventoryItem = require("./models/InventoryItem");
const Notification = require("./models/Notification");
const ShiftLog = require("./models/Shift");
const AuditLog = require("./models/AuditLog");

const protect = require("./middleware/auth");

const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY);

const app = express();

const PORT = process.env.PORT || 3001;
const saltRounds = 12;
const jwtExpireTime = "24h";
const jwt_secret = process.env.JWT_SECRET;
const admin_jwt_secret = process.env.ADMIN_JWT_SECRET || jwt_secret + '_admin';

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// CSP is disabled because the demo uses Tailwind CDN and inline scripts in EJS templates.
// For production, define an explicit CSP policy that whitelists only required sources.
app.use(helmet({ contentSecurityPolicy: false }));

app.use(mongoSanitizer({ replaceWith: "_" }));
app.use(express.static(__dirname + "/public"));
app.use("/images", express.static(__dirname + "/images"));
app.use(methodOverride("_method"));

/* === Rate limiting === */

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
    // Rate limit by authenticated user if logged in, fall back to IP
    return req.user?.userId || req.ip;
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

function verifyAdminToken(req) {
  const token = req.cookies && req.cookies.admin_token;
  if (!token) return null;
  try {
    return jwt.verify(token, admin_jwt_secret);
  } catch (err) {
    return null;
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
  return req.employee && req.employee.type === "employee";
}

function adminAuthorization(req, res, next) {
  if (!isAdmin(req)) {
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
      `Translate the following text to ${targetLanguage}. Return ONLY the translated text, no explanation:\n\n${text}`,
    );
    return result.response.text().trim();
  } catch (err) {
    console.error("Translation failed, returning original:", err.message);
    return text;
  }
}

/* === Global view locals middleware ===
 * Injects the decoded JWT user (if any) into res.locals so every EJS view
 * can reference `locals.user` — the navbar partial depends on this.
 */
app.use((req, res, next) => {
  const decoded = verifyToken(req);
  if (decoded) {
    res.locals.user = decoded;
  }
  res.locals.currentPath = req.path;
  next();
});

/* === Public routes === */

app.get("/", (req, res) => {
  res.render("index");
});

// food request ejs page
app.get("/request", (req, res) => {
  res.render("request");
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
      res.status(500).render("errorMessage", { error: "Server error during signup" });
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

    if (user.roles.includes("volunteer")) {
      res.redirect("/volunteer/dashboard");
    } else {
      res.redirect("/client/dashboard");
    }
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).render("errorMessage", { error: "Server error during login" });
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

    const dashboardRole = user.roles.includes("volunteer") ? "volunteer" : "client";

    if (
      user.firstTimeMode === false ||
      user.hintsSeen.includes("onboarding-complete")
    ) {
      return res.redirect(`/${dashboardRole}/dashboard`);
    }

    res.render("onboarding", { username: user.username, dashboardRole });
  } catch (err) {
    console.error("Onboarding load error:", err.message);
    res.status(500).render("errorMessage", { error: "Could not load onboarding" });
  }
});

// This looks at the food request form submission
app.post("/submit-request", (req, res) => {
  // 1. Capture the data (optional)
  const formData = req.body;

  // 2. Create your reference ID
  const ref = "FB-" + Math.floor(Math.random() * 100000);

  // 3. THE TRIGGER: Send the confirmation page back to the browser
  res.render("confirmation", { referenceId: ref });
});

/* === Protected routes === */

app.use("/client", sessionValidation);
app.get("/client/dashboard", (req, res) => {
  res.render("client-dashboard", {
    username: req.user.username,
    user: req.user,
    currentPath: "/client/dashboard",
  });
});
app.get("/client/ai-request", (req, res) => {
  res.render("ai-request");
});

/* === Volunteer routes === */

app.use("/volunteer", sessionValidation, volunteerOrAdminAuthorization);
app.get("/volunteer/dashboard", (req, res) => {
  res.render("volunteer-dashboard", {
    username: req.user.username,
    user: req.user,
    currentPath: "/volunteer/dashboard",
    totalHours: 0,
    weeklyHours: 0,
    upcomingShifts: 0,
    recentActivity: [],
  });
});

app.get("/clockin", sessionValidation, volunteerOrAdminAuthorization, (req, res) => {
  res.render("clock-in", {
    username: req.user.username,
    user: req.user,
    currentPath: "/clockin",
    isClockedIn: false,
    staffName: req.user.username,
    clockInTime: null,
    shiftDate: null,
    stats: { weekHours: "0h 0m", monthHours: "0h 0m" },
  });
});

/* === Admin routes ===
 * Public: /admin/login, /admin/logout (no adminSessionValidation)
 * Protected: all others use adminSessionValidation inline
 * [CHANGED] Removed app.use("/admin", adminSessionValidation) — caused route
 * conflicts by stripping the /admin prefix. Middleware now applied per-route.
 */

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

// [CHANGED] Dashboard — active sidebar item is "Dashboard"
app.get("/admin/dashboard", adminSessionValidation, async (req, res) => {
  try {
    const employee = await Employee.findOne({ employeeId: req.employee.employeeId });
    if (!employee) return res.redirect("/admin/login");

    const [
      totalInventory,
      lowStockCount,
      outOfStockCount,
      pendingRequests,
      totalClients,
      totalEmployees,
      recentInventory,
      recentEmployees,
    ] = await Promise.all([
      InventoryItem.countDocuments(),
      InventoryItem.countDocuments({ status: "low-stock" }),
      InventoryItem.countDocuments({ status: "out-of-stock" }),
      FoodRequest.countDocuments({ status: "pending" }),
      User.countDocuments({ roles: "client" }),
      Employee.countDocuments({ isActive: true }),
      InventoryItem.find().sort({ updatedAt: -1 }).limit(5).lean(),
      Employee.find({ isActive: true }).sort({ createdAt: -1 }).limit(5).lean(),
    ]);

    res.render("admin-dashboard", {
      employee,
      stats: {
        totalInventory,
        lowStockCount,
        outOfStockCount,
        pendingRequests,
        totalClients,
        totalEmployees,
      },
      recentInventory,
      recentEmployees,
    });
  } catch (err) {
    console.error("Dashboard error:", err.message);
    res.status(500).render("errorMessage", { error: "Could not load dashboard" });
  }
});

// [ADDED] GET /admin/employees — All Employees page
app.get("/admin/employees", adminSessionValidation, async (req, res) => {
  try {
    const employees = await Employee.find().sort({ createdAt: -1 });
    res.render("admin-employees", { employee: req.employee, employees });
  } catch (err) {
    console.error("Employees list error:", err.message);
    res.status(500).render("errorMessage", { error: "Failed to load employees" });
  }
});

// [ADDED] GET /admin/employees/codes — Add Employee form
app.get("/admin/employees/codes", adminSessionValidation, (req, res) => {
  res.render("admin-generate-codes", { employee: req.employee });
});

// [CHANGED] POST /admin/employees/generate-code — creates a full employee record
// Previously generated a nameless "Pending" employee with a random PIN.
// Now accepts name, email, role, department, and PIN from the form.
app.post("/admin/employees/generate-code", adminSessionValidation, async (req, res) => {
  try {
    const { name, email, role, department, pin } = req.body;

    if (!name || !email || !pin) {
      return res.status(400).json({ error: "Name, email and PIN are required." });
    }

    if (!/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ error: "PIN must be 4–8 digits." });
    }

    const newEmployee = new Employee({
      name,
      email,
      role: role || "staff",
      department: department || "General",
      pin,
      isActive: true,
    });

    await newEmployee.save();

    res.json({
      employeeId:  newEmployee.employeeId,
      name:        newEmployee.name,
      email:       newEmployee.email,
      role:        newEmployee.role,
      department:  newEmployee.department,
      pin, // plain PIN returned once before hashing takes effect
    });
  } catch (err) {
    console.error("Generate employee error:", err.message);
    if (err.code === 11000) {
      return res.status(400).json({ error: "An employee with that email already exists." });
    }
    res.status(500).json({ error: "Failed to create employee." });
  }
});

// [ADDED] DELETE /admin/employees/:id — delete an employee record
app.delete("/admin/employees/:id", adminSessionValidation, async (req, res) => {
  try {
    const deleted = await Employee.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: "Employee not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("Employee delete error:", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

/* === Food Request API === */

// POST /api/requests — client submits a food request
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
    const requests = await FoodRequest.find({ clientId: req.user.userId }).sort({ createdAt: -1 });
    return res.status(200).json({ count: requests.length, requests });
  } catch (err) {
    console.error("Fetch my requests error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET route to fetch all food requests
app.get("/api/requests", async (req, res) => {
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
      pickupTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

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
        console.error(
          "Failed to create approval notification:",
          notifErr.message,
        );
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
    if (error) return res.status(400).json({ error: error.details[0].message });

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

      try {
        const reason = value.denialReason
          ? ` Reason: ${value.denialReason}`
          : "";
        await Notification.create({
          userId: updated.clientId,
          type: "request-denied",
          message: `Your food request was not approved.${reason}`,
          relatedId: updated._id,
          relatedType: "FoodRequest",
        });
      } catch (notifErr) {
        console.error(
          "Failed to create denial notification:",
          notifErr.message,
        );
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
          }),
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

      for (const item of value.items) {
        const inventoryItem = await InventoryItem.findById(item.itemId);
        if (!inventoryItem) {
          return res
            .status(404)
            .json({ error: `Inventory item '${item.itemId}' not found` });
        }
        if (inventoryItem.quantity < item.quantity) {
          return res.status(400).json({
            error: `Insufficient quantity for '${inventoryItem.name}'. Available: ${inventoryItem.quantity}, requested: ${item.quantity}`,
          });
        }
      }

      request.itemsAllocated = value.items.map((i) => ({
        itemId: i.itemId,
        quantity: i.quantity,
      }));
      await request.save();

      const updated = await FoodRequest.findById(request._id).populate(
        "itemsAllocated.itemId",
        "name category quantity unit",
      );

      return res
        .status(200)
        .json({ message: "Items allocated", request: updated });
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

      for (const allocation of request.itemsAllocated) {
        const item = await InventoryItem.findById(allocation.itemId);
        if (!item) {
          console.error(
            `Pickup: inventory item ${allocation.itemId} not found, skipping`,
          );
          continue;
        }

        if (item.quantity < allocation.quantity) {
          return res.status(409).json({
            error: `Conflict: '${item.name}' now has ${item.quantity} ${item.unit} but ${allocation.quantity} were allocated. Inventory may have changed since allocation.`,
          });
        }

        const oldStatus = item.status;
        item.quantity -= allocation.quantity;
        await item.save();

        // Notify admin users on transition into low-stock or out-of-stock
        try {
          const isNowLowOrOut = ["low-stock", "out-of-stock"].includes(
            item.status,
          );
          const wasLowOrOut = ["low-stock", "out-of-stock"].includes(oldStatus);
          if (isNowLowOrOut && !wasLowOrOut) {
            const adminUsers = await User.find({ roles: "admin" })
              .select("_id")
              .lean();
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
          console.error(
            "Failed to create low-stock notification during pickup:",
            notifErr.message,
          );
        }
      }

      request.status = "picked-up";
      await request.save();

      // Create pickup-confirmed notification for the client (translated if non-English)
      try {
        const englishMessage =
          "Your food request pickup has been confirmed. Thank you!";
        const client = await User.findById(request.clientId)
          .select("preferredLanguage")
          .lean();
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
        console.error(
          "Failed to create pickup-confirmed notification:",
          notifErr.message,
        );
      }

      const updated = await FoodRequest.findById(request._id).populate(
        "itemsAllocated.itemId",
        "name category quantity unit",
      );

      return res
        .status(200)
        .json({ message: "Pickup confirmed", request: updated });
    } catch (err) {
      console.error("Pickup error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /api/requests/:id/cancel — client cancels their own pending request
app.patch("/api/requests/:id/cancel", sessionValidation, async (req, res) => {
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
      return res
        .status(403)
        .json({ error: "You can only cancel your own requests" });
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
});

/* === Inventory API === */

// POST /api/inventory — admin adds an inventory item
app.post("/api/inventory", adminSessionValidation, async (req, res) => {
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
      addedBy: req.employee.employeeDbId,
    });
    AuditLog.create({
      action:        "added",
      itemName:      item.name,
      itemId:        item._id,
      details:       `Category: ${item.category}, Qty: ${item.quantity} ${item.unit}`,
      performedBy:   req.employee.name,
      performedById: req.employee._id || null,
      role:          req.employee.role || "Admin",
    }).catch(e => console.error("AuditLog write error:", e.message));
    return res.status(201).json({ message: "Item added", item });
  } catch (err) {
    console.error("Inventory create error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/inventory — any authed user
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
app.get("/api/inventory/low-stock", adminSessionValidation, async (req, res) => {
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
});

// PATCH /api/inventory/:id — admin updates an inventory item
app.patch("/api/inventory/:id", adminSessionValidation, async (req, res) => {
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

    try {
      const isNowLowOrOut = ["low-stock", "out-of-stock"].includes(item.status);
      const wasLowOrOut = ["low-stock", "out-of-stock"].includes(oldStatus);
      if (isNowLowOrOut && !wasLowOrOut) {
        const adminUsers = await Employee.find({ isActive: true }).select("_id").lean();
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

    AuditLog.create({
      action:        "updated",
      itemName:      item.name,
      itemId:        item._id,
      details:       `Status: ${item.status}, Qty: ${item.quantity} ${item.unit}`,
      performedBy:   req.employee.name,
      performedById: req.employee._id || null,
      role:          req.employee.role || "Admin",
    }).catch(e => console.error("AuditLog write error:", e.message));
    return res.status(200).json({ message: "Item updated", item });
  } catch (err) {
    console.error("Inventory update error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/inventory/:id — admin deletes an inventory item
app.delete("/api/inventory/:id", adminSessionValidation, async (req, res) => {
  try {
    const deleted = await InventoryItem.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Item not found" });
    AuditLog.create({
      action:        "deleted",
      itemName:      deleted.name,
      itemId:        null,
      details:       `Qty at deletion: ${deleted.quantity} ${deleted.unit}`,
      performedBy:   req.employee.name,
      performedById: req.employee._id || null,
      role:          req.employee.role || "Admin",
    }).catch(e => console.error("AuditLog write error:", e.message));
    return res.status(200).json({ message: "Item deleted", deletedId: deleted._id });
  } catch (err) {
    console.error("Inventory delete error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

/* === Inventory Pages (Admin UI) === */

// GET /inventory — render inventory management page
app.get("/inventory", sessionValidation, volunteerOrAdminAuthorization, async (req, res) => {
  try {
    const search = req.query.search || "";
    const filter = search ? { name: { $regex: search, $options: "i" } } : {};
    const items = await InventoryItem.find(filter).lean();
    const lowStockItems = items.filter((i) => i.status === "low-stock");
    const outOfStockItems = items.filter((i) => i.status === "out-of-stock");

    res.render("inventory", {
      username: req.user.username,
      user: req.user,
      currentPath: "/inventory",
      items,
      lowStockItems,
      outOfStockItems,
    });
  } catch (err) {
    console.error("Failed to render inventory page:", err.message);
    res.status(500).render("errorMessage", { error: "Could not load inventory page" });
  }
});

// GET /inventory/:id/edit — render edit form
app.get("/inventory/:id/edit", sessionValidation, volunteerOrAdminAuthorization, async (req, res) => {
  try {
    const item = await InventoryItem.findById(req.params.id).lean();
    if (!item) return res.status(404).render("errorMessage", { error: "Item not found" });
    res.render("editInventory", { item, user: req.user, currentPath: "/inventory" });
  } catch (err) {
    console.error("Edit inventory load error:", err.message);
    res.status(500).render("errorMessage", { error: "Failed to load edit page" });
  }
});

// PATCH /inventory/:id — form-based update (method-override)
app.patch("/inventory/:id", sessionValidation, volunteerOrAdminAuthorization, async (req, res) => {
  try {
    await InventoryItem.findByIdAndUpdate(req.params.id, req.body, { runValidators: true });
    res.redirect("/inventory");
  } catch (err) {
    console.error("Update error:", err.message);
    res.status(500).render("errorMessage", { error: "Failed to update item" });
  }
});

/* === User Preferences API === */

// GET /api/user/preferences
app.get("/api/user/preferences", sessionValidation, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("firstTimeMode hintsSeen");
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

// PATCH /api/user/preferences
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

// POST /api/ai/parse-request
app.post("/api/ai/parse-request", sessionValidation, async (req, res) => {
  const inputSchema = Joi.object({
    description: Joi.string().min(10).max(2000).required(),
  });

  const { error, value } = inputSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const previousRequests = await FoodRequest.find({ clientId: req.user.userId })
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
    rawText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      console.error("AI returned invalid JSON:", rawText);
      return res.status(502).json({
        error:
          "AI returned unexpected response, please try rephrasing your description.",
      });
    }

    const { error: validationError, value: validatedOutput } =
      aiOutputSchema.validate(parsed, { stripUnknown: true });
    if (validationError) {
      console.error(
        "AI output failed validation:",
        validationError.details,
        "Raw:",
        parsed,
      );
      return res.status(502).json({
        error:
          "AI returned unexpected response, please try rephrasing your description.",
      });
    }

    return res.status(200).json({
      parsed: validatedOutput,
      meta: { model: "gemini-2.5-flash", usedPreviousRequests },
    });
  } catch (err) {
    console.error("AI parse-request error:", err.message);
    return res.status(500).json({
      error:
        "Something went wrong with the AI assistant. Please try again later.",
    });
  }
});

/* === Notifications API === */

// GET /api/notifications — current user's notifications
app.get("/api/notifications", sessionValidation, async (req, res) => {
  try {
    const filter = { userId: req.user.userId };
    if (req.query.unreadOnly === "true") {
      filter.read = false;
    }

    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const unreadCount = await Notification.countDocuments({
      userId: req.user.userId,
      read: false,
    });

    return res.status(200).json({ notifications, unreadCount });
  } catch (err) {
    console.error("Fetch notifications error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/notifications/unread-count — lightweight badge count
app.get(
  "/api/notifications/unread-count",
  sessionValidation,
  async (req, res) => {
    try {
      const count = await Notification.countDocuments({
        userId: req.user.userId,
        read: false,
      });
      return res.status(200).json({ count });
    } catch (err) {
      console.error("Unread count error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /api/notifications/read-all — mark all unread as read
app.patch(
  "/api/notifications/read-all",
  sessionValidation,
  async (req, res) => {
    try {
      const result = await Notification.updateMany(
        { userId: req.user.userId, read: false },
        { $set: { read: true } },
      );
      return res.status(200).json({ updated: result.modifiedCount });
    } catch (err) {
      console.error("Read-all error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /api/notifications/:id/read — mark single notification as read
app.patch(
  "/api/notifications/:id/read",
  sessionValidation,
  async (req, res) => {
    try {
      const notification = await Notification.findById(req.params.id);
      if (!notification)
        return res.status(404).json({ error: "Notification not found" });
      if (notification.userId.toString() !== req.user.userId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      notification.read = true;
      await notification.save();
      return res.status(200).json({ notification });
    } catch (err) {
      console.error("Mark read error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// DELETE /api/notifications/:id — dismiss a notification
app.delete("/api/notifications/:id", sessionValidation, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification)
      return res.status(404).json({ error: "Notification not found" });
    if (notification.userId.toString() !== req.user.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await notification.deleteOne();
    return res.sendStatus(204);
  } catch (err) {
    console.error("Delete notification error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

/* === Clock-in routes (from yenyi_clock_in_page) === */

app.get("/clock", (req, res) => {
  res.render("clock-in");
});

app.get("/clocked-in", (req, res) => {
  res.render("clocked-in");
});

app.post("/api/clock/in", async (req, res) => {
  try {
    const { staffName } = req.body;
    if (!staffName)
      return res.status(400).json({ error: "Staff name is required." });

    const newShift = new ShiftLog({
      staffName,
      clockInTime: new Date(),
    });
    await newShift.save();

    res.json({ success: true, shift: newShift });
  } catch (err) {
    console.error("Clock-in DB error:", err);
    res.status(500).json({ error: "Database error during clock-in." });
  }
});

app.post("/api/clock/break", async (req, res) => {
  try {
    const { shiftId, action } = req.body;
    const shift = await ShiftLog.findById(shiftId);
    if (!shift)
      return res.status(404).json({ error: "Active shift not found." });

    const now = new Date();
    if (action === "start") {
      shift.breakStartTime = now;
    } else if (action === "end" && shift.breakStartTime) {
      const elapsedBreak = now - new Date(shift.breakStartTime);
      shift.breakDuration += elapsedBreak;
      shift.breakStartTime = null;
    }

    await shift.save();
    res.json({ success: true, shift });
  } catch (err) {
    console.error("Break database error:", err);
    res.status(500).json({ error: "Database error tracking shift break." });
  }
});

app.post("/api/clock/out", async (req, res) => {
  try {
    const { shiftId } = req.body;
    const shift = await ShiftLog.findById(shiftId);
    if (!shift)
      return res.status(404).json({ error: "Shift document not found." });

    const now = new Date();
    if (shift.breakStartTime) {
      shift.breakDuration += now - new Date(shift.breakStartTime);
      shift.breakStartTime = null;
    }

    shift.clockOutTime = now;
    await shift.save();

    res.json({ success: true, shift });
  } catch (err) {
    console.error("Clock-out tracking error:", err);
    res.status(500).json({ error: "Database exception checking out shift." });
  }
});

app.get("/api/clock/history", async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const logs = await ShiftLog.find({
      clockInTime: { $gte: todayStart },
      clockOutTime: { $ne: null },
    }).sort({ clockInTime: -1 });

    res.json(logs);
  } catch (err) {
    console.error("Fetch history error:", err);
    res
      .status(500)
      .json({ error: "Database error compiling timeline log history." });
  }
});

/* === Profile routes (from dev) === */

// SAVE SETTINGS TO USER PROFILE
app.post("/api/profile", protect, async (req, res) => {
  try {
    const { householdSize, allergies, dietaryRestrictions } = req.body;

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        householdSize,
        allergies,
        dietaryRestrictions,
      },
      {
        new: true,
      },
    );

    res.json({
      success: true,
      user: updatedUser,
    });
  } catch (err) {
    console.error("Profile update error:", err);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// PROFILE PAGE
app.get("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    res.render("profile", {
      user,
    });
  } catch (err) {
    console.error(err);

    res.render("profile", {
      user: {},
      error: "Failed to load profile",
    });
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

    res.render("profile", {
      user: updatedUser,

      success: "Profile updated successfully",
    });
  } catch (err) {
    console.error(err);

    res.render("profile", {
      user: req.user,

      error: "Failed to update profile",
    });
  }
});

/* === Admin Inventory page routes === */

// GET /admin/inventory — view and filter all inventory items
app.get("/admin/inventory", adminSessionValidation, async (req, res) => {
  try {
    const { search, category, status, location } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (status)   filter.status   = status;
    if (location) filter.storageLocation = location;
    if (search)   filter.name = { $regex: search, $options: "i" };

    const items = await InventoryItem.find(filter)
      .populate("addedBy", "username")
      .sort({ name: 1 });

    const all = await InventoryItem.find();
    const stats = {
      total:      all.length,
      inStock:    all.filter(i => i.status === "in-stock").length,
      lowStock:   all.filter(i => i.status === "low-stock").length,
      outOfStock: all.filter(i => i.status === "out-of-stock").length,
    };

    const flash = req.query._flash || "";
    res.render("manage-inventory-admin", {
      username: req.employee.name,
      items,
      stats,
      filters: { search: search || "", category: category || "", status: status || "", location: location || "" },
      success: flash === "added" ? ["Item added successfully."] : flash === "updated" ? ["Item updated."] : flash === "deleted" ? ["Item deleted."] : [],
      error: [],
    });
  } catch (err) {
    console.error("Inventory page error:", err.message);
    res.status(500).render("errorMessage", { error: "Could not load inventory" });
  }
});

// POST /admin/inventory — add a new item (form submission from modal)
app.post("/admin/inventory", adminSessionValidation, async (req, res) => {
  const schema = Joi.object({
    name:            Joi.string().min(3).max(100).required(),
    category:        Joi.string().valid("canned","fresh","dry","frozen","beverages","baby","other").required(),
    quantity:        Joi.number().min(0).required(),
    unit:            Joi.string().valid("cans","bags","boxes","units","kg","lbs","liters").required(),
    expiryDate:      Joi.date().optional().allow(""),
    storageLocation: Joi.string().valid("shelf","fridge","freezer","pantry").optional(),
    notes:           Joi.string().max(500).allow("").optional(),
  });

  const { error, value } = schema.validate(req.body, { stripUnknown: true });
  if (error) {
    // Re-render with error
    const items = await InventoryItem.find().populate("addedBy","username").sort({ name: 1 });
    const all   = await InventoryItem.find();
    return res.render("manage-inventory-admin", {
      username: req.employee.name,
      items,
      stats: {
        total: all.length,
        inStock: all.filter(i => i.status === "in-stock").length,
        lowStock: all.filter(i => i.status === "low-stock").length,
        outOfStock: all.filter(i => i.status === "out-of-stock").length,
      },
      filters: { search:"", category:"", status:"", location:"" },
      success: [],
      error: [error.details[0].message],
    });
  }

  try {
    const newItem = await InventoryItem.create({ ...value, addedBy: req.employee.employeeDbId });
    AuditLog.create({
      action:        "added",
      itemName:      newItem.name,
      itemId:        newItem._id,
      details:       `Category: ${newItem.category}, Qty: ${newItem.quantity} ${newItem.unit}`,
      performedBy:   req.employee.name,
      performedById: req.employee._id || null,
      role:          req.employee.role || "Admin",
    }).catch(e => console.error("AuditLog write error:", e.message));
    res.redirect("/admin/inventory?_flash=added");
  } catch (err) {
    console.error("Inventory add error:", err.message);
    res.status(500).render("errorMessage", { error: "Failed to add item" });
  }
});

// POST /admin/inventory/:id — edit or delete (method override via hidden _method field)
app.post("/admin/inventory/:id", adminSessionValidation, async (req, res) => {
  const method = (req.body._method || "").toUpperCase();

  if (method === "DELETE") {
    try {
      const toDelete = await InventoryItem.findByIdAndDelete(req.params.id);
      if (toDelete) {
        AuditLog.create({
          action:        "deleted",
          itemName:      toDelete.name,
          itemId:        null,
          details:       `Qty at deletion: ${toDelete.quantity} ${toDelete.unit}`,
          performedBy:   req.employee.name,
          performedById: req.employee._id || null,
          role:          req.employee.role || "Admin",
        }).catch(e => console.error("AuditLog write error:", e.message));
      }
      return res.redirect("/admin/inventory?_flash=deleted");
    } catch (err) {
      console.error("Inventory delete error:", err.message);
      return res.status(500).render("errorMessage", { error: "Failed to delete item" });
    }
  }

  // Default: treat as PATCH (edit)
  const schema = Joi.object({
    name:            Joi.string().min(3).max(100).optional(),
    category:        Joi.string().valid("canned","fresh","dry","frozen","beverages","baby","other").optional(),
    quantity:        Joi.number().min(0).optional(),
    unit:            Joi.string().valid("cans","bags","boxes","units","kg","lbs","liters").optional(),
    expiryDate:      Joi.date().optional().allow(""),
    storageLocation: Joi.string().valid("shelf","fridge","freezer","pantry").optional(),
    notes:           Joi.string().max(500).allow("").optional(),
  }).min(1);

  const { error, value } = schema.validate(req.body, { stripUnknown: true });
  if (error) return res.redirect("/admin/inventory?_flash=error");

  try {
    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).render("errorMessage", { error: "Item not found" });

    const oldStatus = item.status;
    Object.assign(item, value);
    await item.save();

    // Trigger low-stock notifications if status worsened
    try {
      const isNowLowOrOut = ["low-stock","out-of-stock"].includes(item.status);
      const wasLowOrOut   = ["low-stock","out-of-stock"].includes(oldStatus);
      if (isNowLowOrOut && !wasLowOrOut) {
        const adminEmps = await Employee.find({ isActive: true }).select("_id").lean();
        const notifs = adminEmps.map(u => ({
          userId: u._id,
          type: "low-stock",
          message: `${item.name} is ${item.status === "out-of-stock" ? "out of stock" : "running low"} (${item.quantity} ${item.unit} remaining).`,
          relatedId: item._id,
          relatedType: "InventoryItem",
        }));
        if (notifs.length) await Notification.insertMany(notifs);
      }
    } catch (notifErr) {
      console.error("Low-stock notif error:", notifErr.message);
    }

    AuditLog.create({
      action:        "updated",
      itemName:      item.name,
      itemId:        item._id,
      details:       `Status: ${item.status}, Qty: ${item.quantity} ${item.unit}`,
      performedBy:   req.employee.name,
      performedById: req.employee._id || null,
      role:          req.employee.role || "Admin",
    }).catch(e => console.error("AuditLog write error:", e.message));
    res.redirect("/admin/inventory?_flash=updated");
  } catch (err) {
    console.error("Inventory update error:", err.message);
    res.status(500).render("errorMessage", { error: "Failed to update item" });
  }
});

/* === Admin Audit Log page === */

// GET /admin/audit-log
app.get("/admin/audit-log", adminSessionValidation, async (req, res) => {
  try {
    const { search, action, dateFrom, dateTo } = req.query;
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 20;

    // Build MongoDB filter
    const filter = {};
    if (action) filter.action = action;
    if (search) filter.$or = [
      { itemName:    { $regex: search, $options: "i" } },
      { performedBy: { $regex: search, $options: "i" } },
    ];
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = to;
      }
    }

    const totalCount = await AuditLog.countDocuments(filter);
    const logs       = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    // Map to the shape the EJS template expects
    const events = logs.map(l => ({
      ts:      l.createdAt,
      action:  l.action,
      item:    l.itemName,
      details: l.details,
      user:    l.performedBy,
      role:    l.role,
    }));

    // Stats always from the full unfiltered collection
    const now        = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [totalAll, todayCount, addedMonth, requestsMonth] = await Promise.all([
      AuditLog.countDocuments(),
      AuditLog.countDocuments({ createdAt: { $gte: todayStart } }),
      AuditLog.countDocuments({ action: "added",    createdAt: { $gte: monthStart } }),
      AuditLog.countDocuments({ action: "approved", createdAt: { $gte: monthStart } }),
    ]);
    const stats = { total: totalAll, today: todayCount, added: addedMonth, requests: requestsMonth };

    // Pagination query string (without page=)
    const qParts = [];
    if (search)   qParts.push(`search=${encodeURIComponent(search)}`);
    if (action)   qParts.push(`action=${encodeURIComponent(action)}`);
    if (dateFrom) qParts.push(`dateFrom=${encodeURIComponent(dateFrom)}`);
    if (dateTo)   qParts.push(`dateTo=${encodeURIComponent(dateTo)}`);
    const queryString = qParts.join("&");

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    res.render("audit-log-admin", {
      username: req.employee.name,
      events,
      stats,
      filters:  { search: search || "", action: action || "", dateFrom: dateFrom || "", dateTo: dateTo || "" },
      page,
      totalPages,
      queryString,
    });
  } catch (err) {
    console.error("Audit log error:", err.message);
    res.status(500).render("errorMessage", { error: "Could not load audit log" });
  }
});


/* === Admin Low Stock Alerts page === */

// GET /admin/low-stock-alerts
app.get("/admin/low-stock-alerts", adminSessionValidation, async (req, res) => {
  try {
    const filter = req.query.filter || "all";

    // Query inventory items directly instead of relying on Notification documents
    const itemQuery = { status: { $in: ["low-stock", "out-of-stock"] } };
    if (filter === "critical")   itemQuery.status = "out-of-stock";
    if (filter === "low-stock")  itemQuery.status = "low-stock";

    let items = await InventoryItem.find(itemQuery)
      .populate("addedBy", "username")
      .sort({ status: 1, name: 1 })
      .lean();

    // Shape items to look like the Notification objects the EJS expects
    const alerts = items.map(item => ({
      _id:         item._id,
      message:     `${item.name} is ${item.status === "out-of-stock" ? "out of stock" : "running low"} (${item.quantity} ${item.unit} remaining).`,
      read:        false,
      createdAt:   item.updatedAt,
      relatedId:   item,
      relatedType: "InventoryItem",
    }));

    // "unread" and "read" tabs don't apply anymore — just show all for those
    const filteredAlerts = (filter === "read") ? [] : alerts;

    // Stats from inventory directly
    const all = await InventoryItem.find({ status: { $in: ["low-stock", "out-of-stock"] } }).lean();
    const stats = {
      total:    all.length,
      unread:   all.length,
      critical: all.filter(i => i.status === "out-of-stock").length,
      lowStock: all.filter(i => i.status === "low-stock").length,
    };

    res.render("low-stock-alerts-admin", {
      username: req.employee.name,
      alerts: filteredAlerts,
      stats,
      filter,
    });
  } catch (err) {
    console.error("Low stock alerts error:", err.message);
    res.status(500).render("errorMessage", { error: "Could not load alerts" });
  }
});

// POST /admin/low-stock-alerts/mark-all-read
app.post("/admin/low-stock-alerts/mark-all-read", adminSessionValidation, async (req, res) => {
  try {
    await Notification.updateMany({ type: "low-stock", read: false }, { $set: { read: true } });
    res.redirect("/admin/low-stock-alerts");
  } catch (err) {
    console.error("Mark all read error:", err.message);
    res.status(500).render("errorMessage", { error: "Server error" });
  }
});

// POST /admin/low-stock-alerts/dismiss-read
app.post("/admin/low-stock-alerts/dismiss-read", adminSessionValidation, async (req, res) => {
  try {
    await Notification.deleteMany({ type: "low-stock", read: true });
    res.redirect("/admin/low-stock-alerts");
  } catch (err) {
    console.error("Dismiss read error:", err.message);
    res.status(500).render("errorMessage", { error: "Server error" });
  }
});

// POST /admin/low-stock-alerts/:id/read
app.post("/admin/low-stock-alerts/:id/read", adminSessionValidation, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    res.redirect("/admin/low-stock-alerts");
  } catch (err) {
    console.error("Mark read error:", err.message);
    res.status(500).render("errorMessage", { error: "Server error" });
  }
});

// POST /admin/low-stock-alerts/:id/dismiss
app.post("/admin/low-stock-alerts/:id/dismiss", adminSessionValidation, async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.redirect("/admin/low-stock-alerts");
  } catch (err) {
    console.error("Dismiss error:", err.message);
    res.status(500).render("errorMessage", { error: "Server error" });
  }
});

// POST /admin/low-stock-alerts/:id/restock — update inventory quantity from alert
app.post("/admin/low-stock-alerts/:id/restock", adminSessionValidation, async (req, res) => {
  try {
    const quantity = parseInt(req.body.quantity, 10);
    if (isNaN(quantity) || quantity < 1) return res.redirect("/admin/low-stock-alerts");

    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).render("errorMessage", { error: "Item not found" });

    item.quantity = quantity;
    await item.save(); // triggers status recompute via pre-save hook

    res.redirect("/admin/low-stock-alerts");
  } catch (err) {
    console.error("Restock error:", err.message);
    res.status(500).render("errorMessage", { error: "Failed to restock item" });
  }
})


/* === 404 catch-all === */

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

process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err.message);
  console.error(err.stack);
});