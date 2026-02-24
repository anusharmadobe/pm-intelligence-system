/**
 * Enhanced Input Validation
 *
 * Comprehensive validation utilities covering edge cases,
 * SQL injection prevention, XSS prevention, and data sanitization
 */

import validator from 'validator';

export interface ValidationError {
  field: string;
  message: string;
  value?: any;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  sanitized?: any;
}

/**
 * Validate and sanitize string input
 */
export function validateString(
  field: string,
  value: any,
  options: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    trim?: boolean;
    allowEmpty?: boolean;
  } = {}
): ValidationResult {
  const errors: ValidationError[] = [];

  // Type check
  if (value !== null && value !== undefined && typeof value !== 'string') {
    errors.push({
      field,
      message: 'Must be a string',
      value
    });
    return { isValid: false, errors };
  }

  // Handle null/undefined
  if (value === null || value === undefined || value === '') {
    if (options.required && !options.allowEmpty) {
      errors.push({
        field,
        message: 'This field is required'
      });
    }
    return { isValid: errors.length === 0, errors, sanitized: value };
  }

  // Trim if requested
  let sanitized = options.trim !== false ? value.trim() : value;

  // Check empty after trim
  if (sanitized === '' && options.required && !options.allowEmpty) {
    errors.push({
      field,
      message: 'This field cannot be empty'
    });
    return { isValid: false, errors };
  }

  // Length validation
  if (options.minLength !== undefined && sanitized.length < options.minLength) {
    errors.push({
      field,
      message: `Must be at least ${options.minLength} characters`,
      value: sanitized.length
    });
  }

  if (options.maxLength !== undefined && sanitized.length > options.maxLength) {
    errors.push({
      field,
      message: `Must be at most ${options.maxLength} characters`,
      value: sanitized.length
    });
  }

  // Pattern validation
  if (options.pattern && !options.pattern.test(sanitized)) {
    errors.push({
      field,
      message: 'Invalid format'
    });
  }

  // XSS prevention - escape HTML
  sanitized = validator.escape(sanitized);

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

/**
 * Validate and sanitize email
 */
export function validateEmail(field: string, value: any, required: boolean = false): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    if (required) {
      errors.push({ field, message: 'Email is required' });
    }
    return { isValid: errors.length === 0, errors };
  }

  if (typeof value !== 'string') {
    errors.push({ field, message: 'Email must be a string', value });
    return { isValid: false, errors };
  }

  const sanitized = value.trim().toLowerCase();

  if (!validator.isEmail(sanitized)) {
    errors.push({ field, message: 'Invalid email address' });
    return { isValid: false, errors };
  }

  // Additional checks
  if (sanitized.length > 254) {
    errors.push({ field, message: 'Email address too long' });
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

/**
 * Validate and sanitize number
 */
export function validateNumber(
  field: string,
  value: any,
  options: {
    required?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
    positive?: boolean;
  } = {}
): ValidationResult {
  const errors: ValidationError[] = [];

  if (value === null || value === undefined || value === '') {
    if (options.required) {
      errors.push({ field, message: 'This field is required' });
    }
    return { isValid: errors.length === 0, errors };
  }

  const num = Number(value);

  if (isNaN(num)) {
    errors.push({ field, message: 'Must be a valid number', value });
    return { isValid: false, errors };
  }

  if (!isFinite(num)) {
    errors.push({ field, message: 'Must be a finite number', value });
    return { isValid: false, errors };
  }

  if (options.integer && !Number.isInteger(num)) {
    errors.push({ field, message: 'Must be an integer', value: num });
  }

  if (options.positive && num <= 0) {
    errors.push({ field, message: 'Must be positive', value: num });
  }

  if (options.min !== undefined && num < options.min) {
    errors.push({ field, message: `Must be at least ${options.min}`, value: num });
  }

  if (options.max !== undefined && num > options.max) {
    errors.push({ field, message: `Must be at most ${options.max}`, value: num });
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: num
  };
}

/**
 * Validate URL
 */
export function validateUrl(field: string, value: any, required: boolean = false): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    if (required) {
      errors.push({ field, message: 'URL is required' });
    }
    return { isValid: errors.length === 0, errors };
  }

  if (typeof value !== 'string') {
    errors.push({ field, message: 'URL must be a string', value });
    return { isValid: false, errors };
  }

  const sanitized = value.trim();

  if (!validator.isURL(sanitized, {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true
  })) {
    errors.push({ field, message: 'Invalid URL format' });
    return { isValid: false, errors };
  }

  // Additional security checks
  try {
    const url = new URL(sanitized);

    // Prevent SSRF attacks
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.')
    ) {
      errors.push({ field, message: 'Private/local URLs not allowed' });
    }
  } catch (error) {
    errors.push({ field, message: 'Invalid URL' });
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
}

/**
 * Validate UUID
 */
export function validateUuid(field: string, value: any, required: boolean = false): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    if (required) {
      errors.push({ field, message: 'UUID is required' });
    }
    return { isValid: errors.length === 0, errors };
  }

  if (typeof value !== 'string') {
    errors.push({ field, message: 'UUID must be a string', value });
    return { isValid: false, errors };
  }

  if (!validator.isUUID(value)) {
    errors.push({ field, message: 'Invalid UUID format' });
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: [],
    sanitized: value.toLowerCase()
  };
}

/**
 * Validate date
 */
export function validateDate(
  field: string,
  value: any,
  options: {
    required?: boolean;
    minDate?: Date;
    maxDate?: Date;
    format?: string;
  } = {}
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    if (options.required) {
      errors.push({ field, message: 'Date is required' });
    }
    return { isValid: errors.length === 0, errors };
  }

  let date: Date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value);
  } else {
    errors.push({ field, message: 'Invalid date type', value });
    return { isValid: false, errors };
  }

  if (isNaN(date.getTime())) {
    errors.push({ field, message: 'Invalid date' });
    return { isValid: false, errors };
  }

  if (options.minDate && date < options.minDate) {
    errors.push({
      field,
      message: `Date must be after ${options.minDate.toISOString()}`,
      value: date.toISOString()
    });
  }

  if (options.maxDate && date > options.maxDate) {
    errors.push({
      field,
      message: `Date must be before ${options.maxDate.toISOString()}`,
      value: date.toISOString()
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: date
  };
}

/**
 * Validate array
 */
export function validateArray(
  field: string,
  value: any,
  options: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    itemValidator?: (item: any, index: number) => ValidationResult;
  } = {}
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    if (options.required) {
      errors.push({ field, message: 'This field is required' });
    }
    return { isValid: errors.length === 0, errors };
  }

  if (!Array.isArray(value)) {
    errors.push({ field, message: 'Must be an array', value });
    return { isValid: false, errors };
  }

  if (options.minLength !== undefined && value.length < options.minLength) {
    errors.push({
      field,
      message: `Must have at least ${options.minLength} items`,
      value: value.length
    });
  }

  if (options.maxLength !== undefined && value.length > options.maxLength) {
    errors.push({
      field,
      message: `Must have at most ${options.maxLength} items`,
      value: value.length
    });
  }

  // Validate each item
  const sanitizedItems: any[] = [];
  if (options.itemValidator) {
    value.forEach((item, index) => {
      const itemResult = options.itemValidator!(item, index);
      if (!itemResult.isValid) {
        itemResult.errors.forEach(err => {
          errors.push({
            field: `${field}[${index}].${err.field}`,
            message: err.message,
            value: err.value
          });
        });
      } else {
        sanitizedItems.push(itemResult.sanitized !== undefined ? itemResult.sanitized : item);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: options.itemValidator ? sanitizedItems : value
  };
}

/**
 * Validate enum value
 */
export function validateEnum<T extends string>(
  field: string,
  value: any,
  allowedValues: T[],
  required: boolean = false
): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    if (required) {
      errors.push({ field, message: 'This field is required' });
    }
    return { isValid: errors.length === 0, errors };
  }

  if (!allowedValues.includes(value)) {
    errors.push({
      field,
      message: `Must be one of: ${allowedValues.join(', ')}`,
      value
    });
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: [],
    sanitized: value
  };
}

/**
 * Validate JSON string
 */
export function validateJson(field: string, value: any, required: boolean = false): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    if (required) {
      errors.push({ field, message: 'JSON is required' });
    }
    return { isValid: errors.length === 0, errors };
  }

  if (typeof value !== 'string') {
    errors.push({ field, message: 'JSON must be a string', value });
    return { isValid: false, errors };
  }

  try {
    const parsed = JSON.parse(value);
    return {
      isValid: true,
      errors: [],
      sanitized: parsed
    };
  } catch (error: any) {
    errors.push({ field, message: 'Invalid JSON format' });
    return { isValid: false, errors };
  }
}

/**
 * Sanitize SQL input (prevent SQL injection)
 */
export function sanitizeSqlInput(value: string): string {
  // Remove dangerous characters and patterns
  return value
    .replace(/['";\\]/g, '') // Remove quotes and backslashes
    .replace(/--/g, '') // Remove SQL comments
    .replace(/\/\*/g, '') // Remove multi-line comment start
    .replace(/\*\//g, '') // Remove multi-line comment end
    .replace(/xp_/gi, '') // Remove extended stored procedures
    .replace(/exec(\s|\+)+(s|x)p/gi, '') // Remove exec patterns
    .trim();
}

/**
 * Validate phone number
 */
export function validatePhone(field: string, value: any, required: boolean = false): ValidationResult {
  const errors: ValidationError[] = [];

  if (!value) {
    if (required) {
      errors.push({ field, message: 'Phone number is required' });
    }
    return { isValid: errors.length === 0, errors };
  }

  if (typeof value !== 'string') {
    errors.push({ field, message: 'Phone number must be a string', value });
    return { isValid: false, errors };
  }

  const sanitized = value.trim();

  if (!validator.isMobilePhone(sanitized, 'any', { strictMode: false })) {
    errors.push({ field, message: 'Invalid phone number' });
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: [],
    sanitized
  };
}

/**
 * Batch validation
 */
export function validateBatch(
  data: Record<string, any>,
  validators: Record<string, (field: string, value: any) => ValidationResult>
): { isValid: boolean; errors: ValidationError[]; sanitized: Record<string, any> } {
  const allErrors: ValidationError[] = [];
  const sanitized: Record<string, any> = {};

  for (const [field, validator] of Object.entries(validators)) {
    const result = validator(field, data[field]);
    if (!result.isValid) {
      allErrors.push(...result.errors);
    }
    if (result.sanitized !== undefined) {
      sanitized[field] = result.sanitized;
    }
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    sanitized
  };
}
