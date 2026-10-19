import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';

export type Schedule = { timestamp: number; timezone: string };
export type Job = {
  id: string;
  imagePath: string;
  title: string;
  description: string;
  tags: string[];
  schedule: Schedule;
  price?: number;
  tiers?: string[];
  galleries?: string[];
};
export type FilePayload = { name: string; mimeType: string; buffer: string };
export type PreparedJob = Job & { file: FilePayload; fingerprint: string };
export type ScheduledResult = { id: string; status: 'scheduled'; url: string | null };
export type FailedResult = { id: string; status: 'failed' | 'unknown'; error: string };
export type Result = ScheduledResult | FailedResult;

const JOB_KEYS = new Set(['id', 'imagePath', 'title', 'description', 'tags', 'schedule', 'price', 'tiers', 'galleries']);
const REQUIRED_KEYS = ['id', 'imagePath', 'title', 'description', 'tags', 'schedule'];

function object(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} must be an object`);
  return value as Record<string, unknown>;
}

function nonblank(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${where} must be a nonblank string`);
  return value;
}

function stringList(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${where} must be a list of nonblank strings`);
  }
  return [...value] as string[];
}

export function scheduleParts(schedule: Schedule): { year: number; month: number; day: number; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: schedule.timezone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', hourCycle: 'h23',
    }).formatToParts(new Date(schedule.timestamp * 1000));
  } catch {
    throw new Error(`invalid timezone: ${schedule.timezone}`);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour') };
}

export function validateRequest(input: unknown): Job[] {
  const request = object(input, 'request');
  const unknownRequest = Object.keys(request).filter(key => key !== 'jobs');
  if (unknownRequest.length) throw new Error(`unknown request field: ${unknownRequest[0]}`);
  if (!Array.isArray(request.jobs)) throw new Error('jobs must be an array');
  const ids = new Set<string>();
  return request.jobs.map((raw, index) => {
    const value = object(raw, `jobs[${index}]`);
    const unknown = Object.keys(value).filter(key => !JOB_KEYS.has(key));
    if (unknown.length) throw new Error(`unknown jobs[${index}] field: ${unknown[0]}`);
    for (const key of REQUIRED_KEYS) if (!(key in value)) throw new Error(`jobs[${index}].${key} is required`);
    const id = nonblank(value.id, `jobs[${index}].id`);
    if (ids.has(id)) throw new Error(`duplicate job id: ${id}`);
    ids.add(id);
    const imagePath = nonblank(value.imagePath, `jobs[${index}].imagePath`);
    if (!isAbsolute(imagePath)) throw new Error(`jobs[${index}].imagePath must be absolute`);
    if (extname(imagePath).toLowerCase() === '.webp') throw new Error('WebP images are not supported');
    const title = nonblank(value.title, `jobs[${index}].title`);
    if (title.length > 50) throw new Error(`jobs[${index}].title exceeds DeviantArt's 50 character limit`);
    const description = nonblank(value.description, `jobs[${index}].description`);
    const tags = stringList(value.tags, `jobs[${index}].tags`);
    if (tags.length > 30) throw new Error(`jobs[${index}].tags exceeds DeviantArt's 30 tag limit`);
    const rawSchedule = object(value.schedule, `jobs[${index}].schedule`);
    if (Object.keys(rawSchedule).some(key => key !== 'timestamp' && key !== 'timezone')) throw new Error(`jobs[${index}].schedule has unknown fields`);
    if (!Number.isSafeInteger(rawSchedule.timestamp) || (rawSchedule.timestamp as number) < 0 || !Number.isFinite((rawSchedule.timestamp as number) * 1000)) {
      throw new Error(`jobs[${index}].schedule.timestamp must be a valid Unix timestamp`);
    }
    const schedule = { timestamp: rawSchedule.timestamp as number, timezone: nonblank(rawSchedule.timezone, `jobs[${index}].schedule.timezone`) };
    scheduleParts(schedule);
    const job: Job = { id, imagePath, title, description, tags, schedule };
    if ('price' in value) {
      if (typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price < 0) throw new Error(`jobs[${index}].price must be finite and nonnegative`);
      job.price = value.price;
    }
    if ('tiers' in value) job.tiers = stringList(value.tiers, `jobs[${index}].tiers`);
    if ('galleries' in value) job.galleries = stringList(value.galleries, `jobs[${index}].galleries`);
    return job;
  });
}

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
}

export async function prepareRequest(jobs: Job[]): Promise<PreparedJob[]> {
  return Promise.all(jobs.map(async job => {
    const info = await stat(job.imagePath).catch(() => undefined);
    if (!info?.isFile()) throw new Error(`${job.imagePath} is not a file`);
    const bytes = await readFile(job.imagePath);
    const mimeType = imageMime(bytes);
    if (!mimeType) throw new Error(`${job.imagePath} is not a supported PNG, JPEG, or GIF image`);
    const imageHash = createHash('sha256').update(bytes).digest('hex');
    const fingerprintInput = { ...job, imageHash };
    const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
    return { ...job, file: { name: basename(job.imagePath), mimeType, buffer: bytes.toString('base64') }, fingerprint };
  }));
}
