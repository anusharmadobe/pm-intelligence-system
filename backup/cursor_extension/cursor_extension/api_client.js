"use strict";
/**
 * API Client for PM Intelligence System
 * Makes HTTP calls to backend API instead of direct imports
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiClient = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const url = __importStar(require("url"));
// Lazy evaluation to avoid top-level process.env access
function getApiBase() {
    try {
        return process?.env?.API_BASE || 'http://localhost:3000';
    }
    catch {
        return 'http://localhost:3000';
    }
}
// HTTP client using Node's built-in http module (no fetch dependency)
function httpRequest(fullUrl, options) {
    return new Promise((resolve, reject) => {
        try {
            const parsedUrl = url.parse(fullUrl);
            const isHttps = parsedUrl.protocol === 'https:';
            const requestOptions = {
                hostname: parsedUrl.hostname || 'localhost',
                port: parsedUrl.port || (isHttps ? 443 : 80),
                path: parsedUrl.path || '/',
                method: options.method || 'GET',
                headers: options.headers || {},
            };
            const client = isHttps ? https : http;
            const req = client.request(requestOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (!data) {
                        resolve({});
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
                        }
                        else {
                            resolve(parsed);
                        }
                    }
                    catch (e) {
                        reject(new Error(`Invalid JSON response: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            if (options.body) {
                req.write(options.body);
            }
            req.end();
        }
        catch (e) {
            reject(e);
        }
    });
}
async function apiCall(method, endpoint, body) {
    const url = `${getApiBase()}${endpoint}`;
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const headers = {
        'Content-Type': 'application/json',
    };
    if (bodyStr) {
        headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    }
    const options = {
        method,
        headers,
        body: bodyStr,
    };
    const data = await httpRequest(url, options);
    return data;
}
exports.apiClient = {
    // Signals
    async ingestSignal(signal) {
        return apiCall('POST', '/api/signals', signal);
    },
    async getSignals(options) {
        const params = [];
        if (options) {
            Object.entries(options).forEach(([key, value]) => {
                if (value !== undefined) {
                    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
                }
            });
        }
        const query = params.length > 0 ? '?' + params.join('&') : '';
        return apiCall('GET', `/api/signals${query}`);
    },
    // Opportunities
    async detectOpportunities(incremental = true) {
        const endpoint = incremental
            ? '/api/opportunities/detect/incremental'
            : '/api/opportunities/detect';
        return apiCall('POST', endpoint);
    },
    async getOpportunities(options) {
        const params = [];
        if (options) {
            Object.entries(options).forEach(([key, value]) => {
                if (value !== undefined) {
                    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
                }
            });
        }
        const query = params.length > 0 ? '?' + params.join('&') : '';
        const response = await apiCall('GET', `/api/opportunities${query}`);
        return (response.opportunities || response);
    },
    async getOpportunitySignals(opportunityId) {
        return apiCall('GET', `/api/opportunities/${opportunityId}/signals`);
    },
    // Judgments
    async createJudgment(judgment) {
        return apiCall('POST', '/api/judgments', judgment);
    },
    async getJudgments(opportunityId) {
        return apiCall('GET', `/api/judgments/${opportunityId}`);
    },
    // Artifacts
    async createArtifact(artifact) {
        return apiCall('POST', '/api/artifacts', artifact);
    },
    async getArtifacts(judgmentId) {
        return apiCall('GET', `/api/artifacts/${judgmentId}`);
    },
    // Metrics
    async getMetrics() {
        return apiCall('GET', '/api/metrics');
    },
};
