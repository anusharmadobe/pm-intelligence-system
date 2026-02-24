/**
 * Safe localStorage wrapper with error handling
 *
 * Handles common localStorage issues:
 * - Quota exceeded (storage full)
 * - Private/incognito mode (localStorage disabled)
 * - Security policies blocking access
 * - Corrupted storage data
 */

type StorageError = 'quota_exceeded' | 'not_available' | 'security_error' | 'unknown';

interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: StorageError;
  errorMessage?: string;
}

/**
 * Safely get item from localStorage
 */
export function safeGetItem(key: string): StorageResult<string | null> {
  try {
    const value = localStorage.getItem(key);
    return { success: true, data: value };
  } catch (error) {
    return handleStorageError(error, 'get');
  }
}

/**
 * Safely set item in localStorage
 */
export function safeSetItem(key: string, value: string): StorageResult<void> {
  try {
    localStorage.setItem(key, value);
    return { success: true };
  } catch (error) {
    return handleStorageError(error, 'set');
  }
}

/**
 * Safely remove item from localStorage
 */
export function safeRemoveItem(key: string): StorageResult<void> {
  try {
    localStorage.removeItem(key);
    return { success: true };
  } catch (error) {
    return handleStorageError(error, 'remove');
  }
}

/**
 * Safely clear all localStorage
 */
export function safeClearStorage(): StorageResult<void> {
  try {
    localStorage.clear();
    return { success: true };
  } catch (error) {
    return handleStorageError(error, 'clear');
  }
}

/**
 * Check if localStorage is available
 */
export function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get item and parse as JSON safely
 */
export function safeGetJSON<T>(key: string, fallback: T): T {
  const result = safeGetItem(key);

  if (!result.success || !result.data) {
    if (result.error && result.error !== 'not_available') {
      console.warn(`[SafeStorage] Failed to get "${key}":`, result.errorMessage);
    }
    return fallback;
  }

  try {
    return JSON.parse(result.data) as T;
  } catch (error) {
    console.warn(`[SafeStorage] Failed to parse JSON for "${key}":`, error);
    return fallback;
  }
}

/**
 * Set item as JSON safely
 */
export function safeSetJSON(key: string, value: unknown): StorageResult<void> {
  try {
    const json = JSON.stringify(value);
    return safeSetItem(key, json);
  } catch (error) {
    console.error(`[SafeStorage] Failed to stringify value for "${key}":`, error);
    return {
      success: false,
      error: 'unknown',
      errorMessage: error instanceof Error ? error.message : 'Serialization failed'
    };
  }
}

/**
 * Handle storage errors and categorize them
 */
function handleStorageError(error: unknown, operation: string): StorageResult<never> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  let errorType: StorageError = 'unknown';

  if (error instanceof Error) {
    const name = error.name.toLowerCase();
    const message = errorMessage.toLowerCase();

    if (name === 'quotaexceedederror' || message.includes('quota')) {
      errorType = 'quota_exceeded';
    } else if (
      message.includes('access is denied') ||
      message.includes('not available') ||
      message.includes('not defined')
    ) {
      errorType = 'not_available';
    } else if (
      name === 'securityerror' ||
      message.includes('security') ||
      message.includes('insecure')
    ) {
      errorType = 'security_error';
    }
  }

  // Log error with appropriate level
  if (errorType === 'quota_exceeded') {
    console.warn(`[SafeStorage] Storage quota exceeded during ${operation}`);
  } else if (errorType === 'not_available') {
    console.info(`[SafeStorage] Storage not available (private browsing?) during ${operation}`);
  } else {
    console.error(`[SafeStorage] Storage error during ${operation}:`, errorMessage);
  }

  return {
    success: false,
    error: errorType,
    errorMessage
  };
}

/**
 * Get user-friendly error message
 */
export function getStorageErrorMessage(error: StorageError): string {
  switch (error) {
    case 'quota_exceeded':
      return 'Storage is full. Please clear some data and try again.';
    case 'not_available':
      return 'Storage is not available. Private browsing mode may be enabled.';
    case 'security_error':
      return 'Storage access blocked by security policy.';
    default:
      return 'Unable to access local storage.';
  }
}
