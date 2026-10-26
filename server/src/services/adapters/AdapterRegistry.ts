import { PlatformAdapter } from './PlatformAdapter.js';
import { FacebookAdapter } from './FacebookAdapter.js';
import { PlatformType } from '../../types/index.js';

export class AdapterRegistry {
  private adapters: PlatformAdapter[] = [];

  constructor() {
    this.adapters.push(new FacebookAdapter());
  }

  getAdapter(parsedUrl: URL): PlatformAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.supportsUrl(parsedUrl)) {
        return adapter;
      }
    }
    return null;
  }

  getAdapterByPlatform(platform: PlatformType): PlatformAdapter | null {
    return this.adapters.find((a) => a.platform === platform) || null;
  }
}

export const adapterRegistry = new AdapterRegistry();
