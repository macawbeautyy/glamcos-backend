const ApiError = require('../utils/ApiError');
const validator = require('validator');

/**
 * Validate request body fields.
 * Pass an array of field configs:
 * [
 *   { field: 'email', type: 'email', required: true },
 *   { field: 'name', type: 'string', required: true, min: 2, max: 50 },
 *   { field: 'phone', type: 'phone', required: false },
 *   { field: 'password', type: 'password', required: true },
 * ]
 */
const validate = (fields) => {
  return (req, _res, next) => {
    const errors = [];

    for (const config of fields) {
      const value = req.body[config.field];
      const label = config.label || config.field;

      // Required check
      if (config.required && (value === undefined || value === null || value === '')) {
        errors.push(`${label} is required`);
        continue;
      }

      // Skip validation if field is not present and not required
      if (value === undefined || value === null || value === '') continue;

      const strValue = String(value).trim();

      switch (config.type) {
        case 'email':
          if (!validator.isEmail(strValue)) {
            errors.push(`${label} must be a valid email address`);
          }
          break;

        case 'phone':
          if (!validator.isMobilePhone(strValue, 'any', { strictMode: false })) {
            errors.push(`${label} must be a valid phone number`);
          }
          break;

        case 'password':
          if (strValue.length < 8) {
            errors.push(`${label} must be at least 8 characters`);
          }
          if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(strValue)) {
            errors.push(`${label} must contain uppercase, lowercase, and a number`);
          }
          break;

        case 'string':
          if (config.min && strValue.length < config.min) {
            errors.push(`${label} must be at least ${config.min} characters`);
          }
          if (config.max && strValue.length > config.max) {
            errors.push(`${label} must be at most ${config.max} characters`);
          }
          break;

        case 'number':
          if (isNaN(Number(value))) {
            errors.push(`${label} must be a valid number`);
          } else {
            if (config.min !== undefined && Number(value) < config.min) {
              errors.push(`${label} must be at least ${config.min}`);
            }
            if (config.max !== undefined && Number(value) > config.max) {
              errors.push(`${label} must be at most ${config.max}`);
            }
          }
          break;

        case 'enum':
          if (config.values && !config.values.includes(strValue)) {
            errors.push(`${label} must be one of: ${config.values.join(', ')}`);
          }
          break;

        case 'mongoId':
          if (!validator.isMongoId(strValue)) {
            errors.push(`${label} must be a valid ID`);
          }
          break;

        case 'url':
          if (!validator.isURL(strValue)) {
            errors.push(`${label} must be a valid URL`);
          }
          break;

        case 'boolean':
          if (typeof value !== 'boolean' && !['true', 'false'].includes(strValue)) {
            errors.push(`${label} must be true or false`);
          }
          break;

        default:
          break;
      }
    }

    if (errors.length > 0) {
      throw ApiError.badRequest(errors.join('. '));
    }

    next();
  };
};

module.exports = { validate };
