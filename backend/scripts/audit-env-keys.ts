import { Pool } from 'pg';
import pino from 'pino';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createPoolConfig } from '../src/db/poolConfig.js';

const logger = pino({ name: 'environment-audit' });

interface CheckResult {
  service: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'INFO';
  details: string;
}

const results: CheckResult[] = [];

// Deployment environments inject variables directly; a local file is optional.
// Process values take precedence, including deliberate empty overrides.
const envPath = new URL('../.env', import.meta.url);
const env: NodeJS.ProcessEnv = {
  ...(existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}),
  ...process.env,
};
function request(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected provider error";
}
function safeDetails(details: string): string {
  let result = details;
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 4 && /secret|token|password|key|database_url/i.test(key)) result = result.replaceAll(value, '[REDACTED]');
  }
  return result;
}

async function runChecks() {
  logger.info('======================================================');
  logger.info('       RUNNING BACKEND ENVIRONMENT & SERVICE AUDIT    ');
  logger.info('======================================================\n');

  // 1. Database Connection
  if (env.DATABASE_URL) {
    const pool = new Pool(createPoolConfig(env.DATABASE_URL, { connectionTimeoutMillis: 5000 }));
    try {
      const t0 = Date.now();
      const res = await pool.query('SELECT NOW() as current_time, current_database() as db_name, COUNT(*)::int as count FROM tour_packages');
      results.push({
        service: 'Database (PostgreSQL / Supabase)',
        status: 'PASS',
        details: `Connected in ${Date.now() - t0}ms. Database: "${res.rows[0].db_name}". Found ${res.rows[0].count} tour packages.`
      });
    } catch (e: unknown) {
      results.push({
        service: 'Database (PostgreSQL / Supabase)',
        status: 'FAIL',
        details: `Connection failed: ${errorMessage(e)}`
      });
    } finally {
      await pool.end();
    }
  } else {
    results.push({
      service: 'Database (PostgreSQL / Supabase)',
      status: 'FAIL',
      details: 'DATABASE_URL is missing.'
    });
  }

  // 2. Cloudflare R2 / S3
  const s3Endpoint = env.S3_ENDPOINT;
  const s3Bucket = env.CATALOG_MEDIA_BUCKET || env.S3_BUCKET_NAME;
  const s3Key = env.S3_ACCESS_KEY_ID;
  const s3Secret = env.S3_SECRET_ACCESS_KEY;

  if (s3Endpoint && s3Bucket && s3Key && s3Secret && env.ALLOW_STORAGE_WRITE_PROBE === 'true') {
    try {
      const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({
        region: env.S3_REGION || 'auto',
        endpoint: s3Endpoint,
        credentials: {
          accessKeyId: s3Key,
          secretAccessKey: s3Secret,
        },
      });

      const testKey = `audit-probe-${Date.now()}.txt`;
      const content = 'R2 operational audit probe';
      await client.send(new PutObjectCommand({
        Bucket: s3Bucket,
        Key: testKey,
        Body: Buffer.from(content),
        ContentType: 'text/plain',
      }));

      const getRes = await client.send(new GetObjectCommand({
        Bucket: s3Bucket,
        Key: testKey,
      }));
      const body = await getRes.Body?.transformToString();

      await client.send(new DeleteObjectCommand({
        Bucket: s3Bucket,
        Key: testKey,
      }));

      if (body === content) {
        results.push({
          service: 'Cloudflare R2 Storage (Primary)',
          status: 'PASS',
          details: `Read/Write/Delete verified on primary bucket "${s3Bucket}" via endpoint "${s3Endpoint}".`
        });
      } else {
        results.push({
          service: 'Cloudflare R2 Storage (Primary)',
          status: 'WARN',
          details: `Read content mismatch on bucket "${s3Bucket}".`
        });
      }
    } catch (e: unknown) {
      results.push({
        service: 'Cloudflare R2 Storage (Primary)',
        status: 'FAIL',
        details: `R2 check failed: ${errorMessage(e)}`
      });
    }
  } else if (s3Endpoint && s3Bucket && s3Key && s3Secret) {
    results.push({ service: 'Cloudflare R2 Storage (Primary)', status: 'WARN', details: 'Storage write/read/delete probe not run. It requires ALLOW_STORAGE_WRITE_PROBE=true on an approved test bucket.' });
  } else {
    results.push({
      service: 'Cloudflare R2 Storage (Primary)',
      status: 'WARN',
      details: 'Missing one or more S3 parameters (S3_ENDPOINT, CATALOG_MEDIA_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).'
    });
  }

  // 2b. Supabase Storage (Secondary / Failover)
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseBucket = env.SUPABASE_MEDIA_BUCKET || 'documents';
  if (supabaseUrl && supabaseKey) {
    try {
      const res = await request(`${supabaseUrl}/storage/v1/bucket/${supabaseBucket}`, {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      });
      if (res.ok) {
        const bucketData = await res.json() as { name?: string; public?: boolean };
        results.push({
          service: 'Supabase Storage (Secondary / Failover)',
          status: 'PASS',
          details: `Accessible & verified on secondary bucket "${bucketData.name || supabaseBucket}" (public: ${bucketData.public}).`
        });
      } else {
        results.push({
          service: 'Supabase Storage (Secondary / Failover)',
          status: 'WARN',
          details: `HTTP ${res.status} accessing bucket "${supabaseBucket}".`
        });
      }
    } catch (e: unknown) {
      results.push({
        service: 'Supabase Storage (Secondary / Failover)',
        status: 'FAIL',
        details: `Supabase Storage check failed: ${errorMessage(e)}`
      });
    }
  }

  // 2c. Resilient Dual Storage Status
  if (s3Endpoint && s3Key && s3Secret && supabaseUrl && supabaseKey) {
    results.push({
      service: 'Resilient Multi-Tier Dual Storage',
      status: 'INFO',
      details: 'Both storage backends are configured. Dual-write and automatic failover have NOT been verified by this audit.'
    });
  }

  // 3. Razorpay API
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
    try {
      const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const res = await request('https://api.razorpay.com/v1/payments?count=1', {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (res.ok) {
        const data = await res.json() as { items?: unknown[] };
        results.push({
          service: 'Razorpay Payment Gateway',
          status: 'PASS',
          details: `Credentials valid. API responded HTTP 200 (retrieved ${data.items?.length ?? 0} sample payments).`
        });
      } else {

        results.push({
          service: 'Razorpay Payment Gateway',
          status: 'FAIL',
          details: `HTTP ${res.status}`
        });
      }
    } catch (e: unknown) {
      results.push({
        service: 'Razorpay Payment Gateway',
        status: 'FAIL',
        details: `Connection failed: ${errorMessage(e)}`
      });
    }
  } else {
    results.push({
      service: 'Razorpay Payment Gateway',
      status: 'WARN',
      details: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET missing.'
    });
  }

  // Read-only credential/scope check. Never send an email as an audit probe.
  if (env.RESEND_API_KEY) {
    try {
      const res = await request('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      });
      results.push({
        service: 'Resend Email Service',
        status: res.ok ? 'PASS' : res.status === 403 ? 'WARN' : 'FAIL',
        details: res.ok ? 'Domain read access verified; sending/delivery NOT tested.' : `Read-only credential check returned HTTP ${res.status}; send-only keys may lack this scope. Delivery remains unverified.`,
      });
    } catch (e: unknown) {
      results.push({ service: 'Resend Email Service', status: 'FAIL', details: `Connection error: ${errorMessage(e)}` });
    }
  } else {
    results.push({ service: 'Resend Email Service', status: 'WARN', details: 'RESEND_API_KEY is not set; delivery is unverified.' });
  }

  // 5. LocationIQ Token
  if (env.LOCATIONIQ_TOKEN) {
    try {
      const res = await request(`https://us1.locationiq.com/v1/search?key=${env.LOCATIONIQ_TOKEN}&q=Taj+Mahal+Agra&format=json&limit=1`);
      if (res.ok) {
        const data = await res.json() as Array<{ lat?: string; lon?: string }>;
        results.push({
          service: 'LocationIQ Geocoding API',
          status: 'PASS',
          details: `Token valid. Geocoded "Taj Mahal Agra" -> lat: ${data[0]?.lat}, lon: ${data[0]?.lon}`
        });
      } else {

        results.push({
          service: 'LocationIQ Geocoding API',
          status: 'FAIL',
          details: `HTTP ${res.status}`
        });
      }
    } catch (e: unknown) {
      results.push({
        service: 'LocationIQ Geocoding API',
        status: 'FAIL',
        details: `Connection error: ${errorMessage(e)}`
      });
    }
  } else {
    results.push({
      service: 'LocationIQ Geocoding API',
      status: 'INFO',
      details: 'LOCATIONIQ_TOKEN not set.'
    });
  }

  // 6. Cloudflare Deploy Hook
  const hookUrl = env.CLOUDFLARE_DEPLOY_HOOK_URL || env.PAGES_DEPLOY_HOOK_URL;
  if (hookUrl) {
    try {
      // Don't POST to avoid triggering unwanted production rebuilds; check URL structure & domain
      const parsed = new URL(hookUrl);
      results.push({
        service: 'Pages Deploy Hook URL',
        status: 'PASS',
        details: `Configured pointing to ${parsed.origin}${parsed.pathname.slice(0, 15)}... (valid URL format)`
      });
    } catch (e: unknown) {
      results.push({
        service: 'Pages Deploy Hook URL',
        status: 'WARN',
        details: `Invalid URL format: ${errorMessage(e)}`
      });
    }
  } else {
    results.push({
      service: 'Pages Deploy Hook URL',
      status: 'INFO',
      details: 'Not configured.'
    });
  }

  // 7. Cloudflare API Token & Account ID Analysis
  if (env.CLOUDFLARE_API_TOKEN) {
    const raw = env.CLOUDFLARE_API_TOKEN;
    try {
      const res = await request('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { Authorization: `Bearer ${raw}` }
      });
      const data = await res.json() as { success?: boolean; result?: { status?: string }; errors?: Array<{ code?: number }> };
      if (data.success) {
        results.push({
          service: 'Cloudflare API Token',
          status: 'PASS',
          details: `Valid Global/User API token (status: ${data.result?.status || 'active'}).`
        });
      } else {
        results.push({
          service: 'Cloudflare API Token',
          status: 'WARN',
          details: `Cloudflare token verification failed (code ${data.errors?.[0]?.code}); verify token type and scopes.`
        });
      }
    } catch (e: unknown) {
      results.push({
        service: 'Cloudflare API Token',
        status: 'FAIL',
        details: `Connection error: ${errorMessage(e)}`
      });
    }
  }

  // 8. Print Summary Table
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✔' : r.status === 'FAIL' ? '✖' : '⚠';
    logger.info(`[${icon} ${r.status}] ${r.service}`);
    logger.info(`     ${safeDetails(r.details)}\n`);
  }
  if (results.some(result => result.status === 'FAIL')) process.exitCode = 1;
}

runChecks().catch(() => { logger.error('Environment audit failed unexpectedly; no successful verification recorded.'); process.exitCode = 1; });
