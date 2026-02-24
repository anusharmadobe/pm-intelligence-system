/**
 * Form Validation Utilities
 *
 * Client-side validation helpers for forms
 */

export interface ValidationRule {
  validate: (value: any) => boolean;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Common validation rules
 */
export const validationRules = {
  required: (message = 'This field is required'): ValidationRule => ({
    validate: (value) => {
      if (typeof value === 'string') return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return value != null && value !== '';
    },
    message
  }),

  email: (message = 'Please enter a valid email address'): ValidationRule => ({
    validate: (value) => {
      if (!value) return true; // Empty is valid (use required separately)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(value);
    },
    message
  }),

  minLength: (min: number, message?: string): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return value.length >= min;
    },
    message: message || `Must be at least ${min} characters`
  }),

  maxLength: (max: number, message?: string): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return value.length <= max;
    },
    message: message || `Must be at most ${max} characters`
  }),

  pattern: (regex: RegExp, message: string): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return regex.test(value);
    },
    message
  }),

  number: (message = 'Please enter a valid number'): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return !isNaN(Number(value));
    },
    message
  }),

  min: (min: number, message?: string): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return Number(value) >= min;
    },
    message: message || `Must be at least ${min}`
  }),

  max: (max: number, message?: string): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return Number(value) <= max;
    },
    message: message || `Must be at most ${max}`
  }),

  url: (message = 'Please enter a valid URL'): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    message
  }),

  apiKey: (message = 'API key must start with pk_'): ValidationRule => ({
    validate: (value) => {
      if (!value) return true;
      return typeof value === 'string' && value.startsWith('pk_') && value.length > 10;
    },
    message
  })
};

/**
 * Validate a value against multiple rules
 */
export function validateField(value: any, rules: ValidationRule[]): ValidationResult {
  const errors: string[] = [];

  for (const rule of rules) {
    if (!rule.validate(value)) {
      errors.push(rule.message);
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validate multiple fields at once
 */
export function validateForm(
  values: Record<string, any>,
  rules: Record<string, ValidationRule[]>
): Record<string, ValidationResult> {
  const results: Record<string, ValidationResult> = {};

  for (const [field, fieldRules] of Object.entries(rules)) {
    results[field] = validateField(values[field], fieldRules);
  }

  return results;
}

/**
 * Check if entire form is valid
 */
export function isFormValid(results: Record<string, ValidationResult>): boolean {
  return Object.values(results).every((result) => result.isValid);
}

/**
 * Get all errors from form validation
 */
export function getFormErrors(results: Record<string, ValidationResult>): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const [field, result] of Object.entries(results)) {
    if (!result.isValid) {
      errors[field] = result.errors;
    }
  }

  return errors;
}
