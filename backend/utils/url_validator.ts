import { lookup } from 'dns/promises';
import { logger } from './logger';

/**
 * URL Security Validator
 * Prevents SSRF (Server-Side Request Forgery) attacks by validating URLs before fetching
 */

// Private IP ranges that should be blocked
const BLOCKED_IP_RANGES = [
  // IPv4 Private Ranges
  { start: '10.0.0.0', end: '10.255.255.255', name: 'Private Class A' },
  { start: '172.16.0.0', end: '172.31.255.255', name: 'Private Class B' },
  { start: '192.168.0.0', end: '192.168.255.255', name: 'Private Class C' },
  { start: '127.0.0.0', end: '127.255.255.255', name: 'Loopback' },
  { start: '169.254.0.0', end: '169.254.255.255', name: 'Link-local' },
  { start: '224.0.0.0', end: '239.255.255.255', name: 'Multicast' },
  { start: '240.0.0.0', end: '255.255.255.255', name: 'Reserved' },
  { start: '0.0.0.0', end: '0.255.255.255', name: 'Current network' },
  { start: '100.64.0.0', end: '100.127.255.255', name: 'Shared Address Space' }
];

// IPv6 private ranges (simplified patterns)
const BLOCKED_IPV6_PATTERNS = [
  /^::1$/, // Loopback
  /^fe80:/i, // Link-local
  /^fc00:/i, // Unique local
  /^fd00:/i, // Unique local
  /^ff00:/i, // Multicast
  /^::/  // Unspecified
];

// Cloud metadata endpoints
const BLOCKED_HOSTNAMES = [
  'metadata.google.internal',
  '169.254.169.254', // AWS, Azure, GCP metadata
  'metadata', // Kubernetes
  'consul', // Consul
  'vault' // Vault
];

export interface UrlValidationResult {
  safe: boolean;
  reason?: string;
  details?: {
    resolvedIps?: string[];
    blockedIp?: string;
    blockedHostname?: string;
  };
}

/**
 * Convert IP address string to number for comparison
 */
function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Check if IP address is in a blocked range
 */
function isIpInRange(ip: string, start: string, end: string): boolean {
  const ipNum = ipToNumber(ip);
  const startNum = ipToNumber(start);
  const endNum = ipToNumber(end);
  return ipNum >= startNum && ipNum <= endNum;
}

/**
 * Check if IP address is blocked
 */
function isBlockedIp(ip: string): { blocked: boolean; rangeName?: string } {
  // Check IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(ip)) {
    for (const range of BLOCKED_IP_RANGES) {
      if (isIpInRange(ip, range.start, range.end)) {
        return { blocked: true, rangeName: range.name };
      }
    }
  }

  // Check IPv6
  if (ip.includes(':')) {
    for (const pattern of BLOCKED_IPV6_PATTERNS) {
      if (pattern.test(ip)) {
        return { blocked: true, rangeName: 'IPv6 Private/Reserved' };
      }
    }
  }

  return { blocked: false };
}

/**
 * Check if hostname is blocked
 */
function isBlockedHostname(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();

  // Exact match
  if (BLOCKED_HOSTNAMES.includes(lowerHostname)) {
    return true;
  }

  // Pattern match
  if (lowerHostname.includes('metadata')) {
    return true;
  }

  // Check for localhost variations
  if (lowerHostname === 'localhost' || lowerHostname.endsWith('.localhost')) {
    return true;
  }

  return false;
}

/**
 * Check if domain is in whitelist
 */
function isDomainWhitelisted(hostname: string, whitelist?: string[]): boolean {
  if (!whitelist || whitelist.length === 0) {
    // No whitelist means all domains are allowed (except blocked ones)
    return true;
  }

  const lowerHostname = hostname.toLowerCase();

  for (const allowedDomain of whitelist) {
    const lowerAllowed = allowedDomain.toLowerCase();

    // Exact match
    if (lowerHostname === lowerAllowed) {
      return true;
    }

    // Subdomain match (e.g., "example.com" allows "www.example.com")
    if (lowerHostname.endsWith(`.${lowerAllowed}`)) {
      return true;
    }

    // Wildcard match (e.g., "*.example.com")
    if (lowerAllowed.startsWith('*.')) {
      const baseDomain = lowerAllowed.substring(2);
      if (lowerHostname.endsWith(`.${baseDomain}`) || lowerHostname === baseDomain) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate URL safety for SSRF protection
 *
 * @param url - URL to validate
 * @param options - Validation options
 * @returns Validation result with details
 */
export async function validateUrlSafety(
  url: string,
  options: {
    allowedDomains?: string[];
    skipDnsCheck?: boolean;
  } = {}
): Promise<UrlValidationResult> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (error) {
    return {
      safe: false,
      reason: 'Invalid URL format'
    };
  }

  // 1. Check protocol whitelist
  const allowedProtocols = ['http:', 'https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return {
      safe: false,
      reason: `Protocol '${parsed.protocol}' not allowed. Only HTTP/HTTPS are permitted.`
    };
  }

  const hostname = parsed.hostname;

  // 2. Check for blocked hostnames
  if (isBlockedHostname(hostname)) {
    return {
      safe: false,
      reason: `Hostname '${hostname}' is blocked`,
      details: {
        blockedHostname: hostname
      }
    };
  }

  // 3. Check if hostname is an IP address
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

  if (ipv4Regex.test(hostname) || ipv6Regex.test(hostname)) {
    const ipCheck = isBlockedIp(hostname);
    if (ipCheck.blocked) {
      return {
        safe: false,
        reason: `Direct IP address access to private range blocked: ${ipCheck.rangeName}`,
        details: {
          blockedIp: hostname
        }
      };
    }
  }

  // 4. Resolve DNS to check for IP bypasses (e.g., domain pointing to 127.0.0.1)
  if (!options.skipDnsCheck) {
    try {
      const resolved = await lookup(hostname, { all: true });
      const resolvedIps = resolved.map(r => r.address);

      logger.debug('DNS resolution for URL validation', {
        hostname,
        resolvedIps
      });

      for (const record of resolved) {
        const ipCheck = isBlockedIp(record.address);
        if (ipCheck.blocked) {
          return {
            safe: false,
            reason: `Domain resolves to private IP: ${record.address} (${ipCheck.rangeName})`,
            details: {
              resolvedIps,
              blockedIp: record.address
            }
          };
        }
      }
    } catch (error: any) {
      // DNS resolution failure
      logger.warn('DNS resolution failed for URL validation', {
        hostname,
        error: error.message
      });
      return {
        safe: false,
        reason: `DNS resolution failed: ${error.message}`
      };
    }
  }

  // 5. Check domain whitelist (if configured)
  if (options.allowedDomains && options.allowedDomains.length > 0) {
    if (!isDomainWhitelisted(hostname, options.allowedDomains)) {
      return {
        safe: false,
        reason: `Domain '${hostname}' not in whitelist`,
        details: {
          blockedHostname: hostname
        }
      };
    }
  }

  // All checks passed
  return {
    safe: true
  };
}

/**
 * Validate URL safety (synchronous, without DNS check)
 * Use this for quick validation without async DNS lookup
 */
export function validateUrlSafetySync(
  url: string,
  options: {
    allowedDomains?: string[];
  } = {}
): UrlValidationResult {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch (error) {
    return {
      safe: false,
      reason: 'Invalid URL format'
    };
  }

  // Check protocol
  const allowedProtocols = ['http:', 'https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return {
      safe: false,
      reason: `Protocol '${parsed.protocol}' not allowed`
    };
  }

  const hostname = parsed.hostname;

  // Check blocked hostnames
  if (isBlockedHostname(hostname)) {
    return {
      safe: false,
      reason: `Hostname '${hostname}' is blocked`
    };
  }

  // Check if IP address
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

  if (ipv4Regex.test(hostname) || ipv6Regex.test(hostname)) {
    const ipCheck = isBlockedIp(hostname);
    if (ipCheck.blocked) {
      return {
        safe: false,
        reason: `Direct IP address access to private range blocked: ${ipCheck.rangeName}`
      };
    }
  }

  // Check whitelist
  if (options.allowedDomains && options.allowedDomains.length > 0) {
    if (!isDomainWhitelisted(hostname, options.allowedDomains)) {
      return {
        safe: false,
        reason: `Domain '${hostname}' not in whitelist`
      };
    }
  }

  return {
    safe: true
  };
}

/**
 * Get allowed domains from environment variable
 */
export function getAllowedDomainsFromEnv(): string[] | undefined {
  const envDomains = process.env.CRAWLER_ALLOWED_DOMAINS;
  if (!envDomains) {
    return undefined;
  }

  return envDomains
    .split(',')
    .map(d => d.trim())
    .filter(d => d.length > 0);
}
