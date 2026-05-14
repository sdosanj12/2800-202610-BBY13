require("./utils.js");
require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const Joi = require("joi");
const mongoSanitizer = require("mongo-sanitizer").default;
const cookieParser = require("cookie-parser");

const { GoogleGenerativeAI } = require("@google/generative-ai");

const { connectDB } = require("./databaseConnection");
const User = require("./models/User");
const FoodRequest = require("./models/FoodRequest");
const InventoryItem = require("./models/InventoryItem");
const Notification = require("./models/Notification");

const genAI = new GoogleGenerativeAI(process.env.AI_API_KEY);

const app = express();

const PORT = process.env.PORT || 3000;
const saltRounds = 12;
const jwtExpireTime = "24h";
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

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());
app.use(mongoSanitizer({ replaceWith: "_" }));
app.use(express.static(__dirname + "/public"));

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

/* === Public routes === */

app.get("/", (req, res) => {
  res.render("index");
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

/* === Protected routes === */

app.use("/client", sessionValidation);
app.get("/client/dashboard", (req, res) => {
  res.render("client-dashboard", { username: req.user.username });
});
app.get("/client/ai-request", (req, res) => {
  res.render("ai-request");
});

app.use("/admin", sessionValidation, adminAuthorization);
app.get("/admin/dashboard", (req, res) => {
  res.render("admin-dashboard", { username: req.user.username });
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

// GET /api/requests/pending — adminviews all pending requests (FIFO)
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

// PATCH /api/requests/:id/approve — adminapproves a request
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

      return res
        .status(200)
        .json({ message: "Request approved", request: updated });
    } catch (err) {
      console.error("Approve error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

// PATCH /api/requests/:id/deny — admindenies a request
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

      return res
        .status(200)
        .json({ message: "Request denied", request: updated });
    } catch (err) {
      console.error("Deny error:", err.message);
      return res.status(500).json({ error: "Server error" });
    }
  },
);

/* === Inventory API === */

// POST /api/inventory — adminadds an item
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

    return res.status(200).json({ count: items.length, items });
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

// PATCH /api/inventory/:id — adminupdates an item (status auto-recomputes via pre-hook)
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

// DELETE /api/inventory/:id — adminremoves an item
app.delete(
  "/api/inventory/:id",
  sessionValidation,
  adminAuthorization,
  async (req, res) => {
    try {
      const deleted = await InventoryItem.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Item not found" });
      return res
        .status(200)
        .json({ message: "Item deleted", deletedId: deleted._id });
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
      return res
        .status(502)
        .json({
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
      return res
        .status(502)
        .json({
          error:
            "AI returned unexpected response, please try rephrasing your description.",
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
    return res
      .status(500)
      .json({
        error:
          "Something went wrong with the AI assistant. Please try again later.",
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
