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
