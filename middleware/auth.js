/**
 * Auth middleware — Verifies the user JWT from the token cookie,
 * fetches the full User document, and attaches it to req.user.
 * Used by profile routes that need the complete user object (not just decoded JWT).
 *
 * @author Shirin Sajeeb
 * @author Brian Lau
 */

const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Express middleware that protects routes by verifying the JWT cookie.
 * Returns 401 if the token is missing, invalid, or the user no longer exists.
 */
const protect = async (req, res, next) => {
  try {

    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({
        message: "Not authorized"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        message: "User not found"
      });
    }

    req.user = user;

    next();

  } catch (err) {

    console.error(err);

    return res.status(401).json({
      message: "Invalid token"
    });
  }
};

module.exports = protect;
