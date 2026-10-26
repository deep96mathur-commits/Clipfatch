import { validateAndClassifyUrl } from '../utils/ssrfGuard.js';
import { adapterRegistry } from './adapters/AdapterRegistry.js';
import { VideoInfoResult } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

export async function processVideoInfo(rawUrl: string): Promise<VideoInfoResult> {
  const validation = await validateAndClassifyUrl(rawUrl);

  if (!validation.safe) {
    throw new AppError(
      validation.error || 'The submitted URL is not supported or failed security validation',
      400,
      'INVALID_URL'
    );
  }

  const adapter = adapterRegistry.getAdapter(validation.parsedUrl);
  if (!adapter) {
    throw new AppError(
      `No adapter registered for platform: ${validation.platform}`,
      400,
      'UNSUPPORTED_PLATFORM'
    );
  }

  try {
    const info = await adapter.getVideoInfo(rawUrl, validation.parsedUrl);
    if (info && info.title && info.title.length > 190) {
      info.title = info.title.slice(0, 187) + '...';
    }
    return info;
  } catch (err) {
    throw new AppError(
      'Unable to retrieve video information. The video may be private, deleted, or require login.',
      422,
      'RETRIEVAL_FAILED'
    );
  }
}
