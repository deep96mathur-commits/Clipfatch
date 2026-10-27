import { z } from 'zod';

export const videoInfoSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'URL cannot be empty')
    .max(2048, 'URL exceeds maximum length of 2048 characters')
    .url('Must be a valid URL starting with http:// or https://'),
});

export const videoDownloadSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'URL cannot be empty')
    .max(2048, 'URL exceeds maximum length of 2048 characters')
    .url('Must be a valid URL'),
  formatId: z
    .string()
    .trim()
    .max(100)
    .optional(),
  format_id: z
    .string()
    .trim()
    .max(100)
    .optional(),
  targetMediaUrl: z
    .string()
    .trim()
    .url('Must be a valid media target URL')
    .max(4096)
    .optional(),
  title: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed.length > 200 ? trimmed.slice(0, 197) + '...' : trimmed;
      }
      return val === '' || val === null ? undefined : val;
    }, z.string().trim().max(200).optional()),
  mediaType: z
    .enum(['video', 'audio'])
    .optional(),
  type: z
    .enum(['video', 'audio'])
    .optional(),
  quality: z
    .string()
    .trim()
    .max(50)
    .optional(),
  audioBitrate: z
    .number()
    .int()
    .min(32)
    .max(500)
    .optional(),
  bitrate: z
    .number()
    .int()
    .min(32)
    .max(500)
    .optional(),
  resolution: z
    .string()
    .trim()
    .max(50)
    .optional(),
  container: z
    .string()
    .trim()
    .max(20)
    .optional(),
});

export type VideoInfoInput = z.infer<typeof videoInfoSchema>;
export type VideoDownloadInput = z.infer<typeof videoDownloadSchema>;

export const videoInfoQuerySchema = z.object({
  url: z
    .string({ message: 'The url query parameter must be a string' })
    .trim()
    .min(1, 'The url query parameter cannot be empty')
    .max(2048, 'URL exceeds maximum length of 2048 characters')
    .url('Must be a valid URL starting with http:// or https://'),
});

export const downloadQuerySchema = z.object({
  url: z
    .string({ message: 'The url query parameter must be a string' })
    .trim()
    .min(1, 'The url query parameter cannot be empty')
    .max(2048, 'URL exceeds maximum length of 2048 characters')
    .url('Must be a valid URL starting with http:// or https://'),
  type: z
    .enum(['video', 'audio'])
    .optional()
    .default('video'),
  quality: z
    .string()
    .trim()
    .max(50, 'Quality parameter exceeds maximum length of 50 characters')
    .optional()
    .default('best'),
  title: z
    .string()
    .trim()
    .max(200, 'Title exceeds maximum length of 200 characters')
    .optional(),
});

export const videoStreamQuerySchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, 'The url query parameter cannot be empty')
      .max(4096, 'URL exceeds maximum length of 4096 characters')
      .url('Must be a valid URL starting with http:// or https://')
      .optional(),
    pageUrl: z
      .string()
      .trim()
      .min(1, 'The pageUrl query parameter cannot be empty')
      .max(2048, 'pageUrl exceeds maximum length of 2048 characters')
      .url('Must be a valid URL starting with http:// or https://')
      .optional(),
    title: z
      .string()
      .trim()
      .max(200, 'Title exceeds maximum length of 200 characters')
      .optional(),
    formatId: z
      .string()
      .trim()
      .max(100, 'formatId exceeds maximum length of 100 characters')
      .optional(),
    mediaType: z
      .enum(['video', 'audio'])
      .optional(),
    audioBitrate: z
      .string()
      .trim()
      .regex(/^\d+$/, 'The audioBitrate query parameter must be an integer')
      .optional(),
  })
  .refine((data) => Boolean(data.url || data.pageUrl), {
    message: 'Either url or pageUrl query parameter is required for streaming',
    path: ['url'],
  });

export type VideoInfoQueryInput = z.infer<typeof videoInfoQuerySchema>;
export type DownloadQueryInput = z.infer<typeof downloadQuerySchema>;
export type VideoStreamQueryInput = z.infer<typeof videoStreamQuerySchema>;

