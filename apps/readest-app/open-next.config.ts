import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Ouiread: no incremental cache. The app uses no ISR / `revalidate` /
// `unstable_cache`, so it would be a no-op, and leaving it out means no extra
// R2 bucket to create for it.
const config = defineCloudflareConfig({});

config.dangerous = { ...config.dangerous, disableIncrementalCache: true };

export default config;
