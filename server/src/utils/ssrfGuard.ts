import dns from 'dns/promises';
import { PlatformType } from '../types/index.js';

// Strict whitelist of supported platform domains (Facebook only)
const SUPPORTED_DOMAINS: Record<string, PlatformType> = {
  // Facebook
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'm.facebook.com': 'facebook',
  'web.facebook.com': 'facebook',
  'fb.watch': 'facebook',
  'fb.gg': 'facebook',
};

// Allowed media CDN host suffixes for download verification (Facebook CDNs only)
const ALLOWED_MEDIA_HOSTS = [
  'fbcdn.net',
  'facebook.com',
  'akamaihd.net',
];

/**
 * Checks if an IPv4 or IPv6 address belongs to private, loopback, link-local,
 * or cloud metadata IP ranges (e.g., AWS/GCP 169.254.169.254).
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  const cleanIp = ip.replace(/^::ffff:/, ''); // IPv4-mapped IPv6

  // IPv4 checks
  const ipv4Parts = cleanIp.split('.').map((p) => parseInt(p, 10));
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    const [a, b] = ipv4Parts;

    // 0.0.0.0/8 (Current network)
    if (a === 0) return true;
    // 10.0.0.0/8 (Private)
    if (a === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local & cloud metadata)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (Private)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (a === 192 && b === 168) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (a >= 224) return true;

    return false;
  }

  // IPv6 checks
  const lowerIp = cleanIp.toLowerCase();
  if (
    lowerIp === '::1' ||
    lowerIp === '::' ||
    lowerIp.startsWith('fc') ||
    lowerIp.startsWith('fd') || // Unique local
    lowerIp.startsWith('fe80') // Link-local
  ) {
    return true;
  }

  return false;
}

/**
 * Validates whether a user-submitted URL is safe and belongs to a supported social media platform.
 * Defends strictly against SSRF, lookalike domains, non-HTTP protocols, and localhost.
 */
export async function validateAndClassifyUrl(
  rawUrl: string
): Promise<{ safe: boolean; platform: PlatformType; parsedUrl: URL; error?: string }> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { safe: false, platform: 'unknown', parsedUrl: new URL('http://invalid'), error: 'URL is required' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { safe: false, platform: 'unknown', parsedUrl: new URL('http://invalid'), error: 'Invalid URL format' };
  }

  // Only allow http and https protocols, require https
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      safe: false,
      platform: 'unknown',
      parsedUrl: parsed,
      error: 'Only HTTP and HTTPS protocols are allowed',
    };
  }

  // Block embedded credentials (e.g. https://user:pass@evil.com)
  if (parsed.username || parsed.password) {
    return {
      safe: false,
      platform: 'unknown',
      parsedUrl: parsed,
      error: 'URLs containing user credentials are not permitted',
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Explicitly block localhost, loopback names, and private hostnames
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return {
      safe: false,
      platform: 'unknown',
      parsedUrl: parsed,
      error: 'Access to internal hostnames is prohibited',
    };
  }

  // Check supported domains (strict exact match)
  const platform = SUPPORTED_DOMAINS[hostname];
  if (!platform) {
    // Check if user passed a lookalike domain (e.g. facebook.com.attacker.com or evil-facebook.com)
    const isLookalike = ['facebook.com', 'fb.watch', 'fb.gg'].some((domain) => {
      if (hostname.endsWith('.' + domain)) return true;
      const parts = hostname.split('.');
      return parts.some((p) => p === 'facebook' || p.startsWith('facebook-') || p.endsWith('-facebook'));
    });

    if (isLookalike) {
      return {
        safe: false,
        platform: 'unknown',
        parsedUrl: parsed,
        error: 'Lookalike or suspicious domain rejected for security',
      };
    }

    return {
      safe: false,
      platform: 'unknown',
      parsedUrl: parsed,
      error: 'Unsupported platform. ClipFetch currently only supports Facebook videos, reels, and watch posts.',
    };
  }

  // Resolve DNS to verify the target IP is not private/reserved (SSRF prevention)
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const record of addresses) {
      if (isPrivateOrReservedIp(record.address)) {
        return {
          safe: false,
          platform: 'unknown',
          parsedUrl: parsed,
          error: 'URL resolved to a private or restricted network address',
        };
      }
    }
  } catch (err) {
    return {
      safe: false,
      platform: 'unknown',
      parsedUrl: parsed,
      error: 'Failed to resolve hostname DNS',
    };
  }

  return { safe: true, platform, parsedUrl: parsed };
}

/**
 * Validates a media download URL against allowed platform CDN hosts and SSRF protection.
 */
export async function validateMediaDownloadUrl(rawUrl: string): Promise<{ safe: boolean; error?: string }> {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { safe: false, error: 'Only HTTPS and HTTP download URLs are allowed' };
    }

    const hostname = parsed.hostname.toLowerCase();
    const isAllowedHost = ALLOWED_MEDIA_HOSTS.some(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );

    if (!isAllowedHost) {
      return { safe: false, error: 'Download URL is not from an authorized media content distribution network' };
    }

    // SSRF DNS check
    const addresses = await dns.lookup(hostname, { all: true });
    for (const record of addresses) {
      if (isPrivateOrReservedIp(record.address)) {
        return { safe: false, error: 'Media URL resolved to a private or restricted network address' };
      }
    }

    return { safe: true };
  } catch {
    return { safe: false, error: 'Invalid media download URL' };
  }
}
