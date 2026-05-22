/**
 * Global utility helpers — Sets up base_dir, abs_path, and include
 * as globals for convenient module resolution across the project.
 *
 * @author Brian Lau
 */

global.base_dir = __dirname;

/**
 * Resolves an absolute path relative to the project root.
 * @param {string} path - Relative path (e.g. "/models/User")
 * @returns {string} Absolute path
 */
global.abs_path = function(path) {
  return base_dir + path;
};

/**
 * Requires a module by name relative to the project root.
 * @param {string} file - Module name without .js extension (e.g. "models/User")
 * @returns {*} The required module
 */
global.include = function(file) {
  return require(abs_path('/' + file + '.js'));
};